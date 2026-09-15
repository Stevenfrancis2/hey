import type { Api } from "grammy";
import { log } from "../log.js";
import { getCapture, markEnriched, markFailed, setCaptureText } from "../memory/capture.js";
import { indexCapture } from "../memory/index.js";
import { transcribe } from "../integrations/transcribe.js";
import { downloadFile } from "../integrations/telegram-files.js";
import { classify, saveClassification } from "../agent/classify.js";
import { respond } from "../agent/run.js";
import { isProviderError, notifyOutage } from "../integrations/provider-errors.js";

/**
 * Intents where he is talking *to* the assistant rather than *at* it, so the
 * agent runs and answers.
 *
 * `reminder` and `task` belong here even though they read like statements.
 * Classifying alone only labels the capture — nothing schedules it. Without the
 * agent and its tools, "remind me tomorrow at 1am" was stored, labelled
 * `reminder`, and then never fired, which is the worst possible outcome: he
 * believes it is set. The reply doubles as the confirmation that the time was
 * parsed the way he meant, the same reason a transcript is echoed back.
 */
const NEEDS_THE_AGENT = new Set(["question", "request", "reminder", "task"]);

/**
 * Everything expensive happens here, off the message path: transcribe, index,
 * classify, and — only when he actually asked something — answer.
 */
export async function enrichCapture(api: Api, captureId: string): Promise<void> {
  const capture = await getCapture(captureId);
  if (!capture) {
    log.warn({ captureId }, "enrich: capture vanished");
    return;
  }

  const chatId = Number(capture.chat_id);
  const replyTo = capture.telegram_message_id ? Number(capture.telegram_message_id) : null;

  try {
    let text = capture.raw_text ?? "";

    if (capture.kind === "voice" && capture.media_file_id) {
      const started = Date.now();
      const audio = await downloadFile(api, capture.media_file_id);
      const transcript = await transcribe(audio);
      log.info({ captureId, ms: Date.now() - started, chars: transcript.length }, "transcribed");

      text = text.length > 0 ? `${text}\n\n${transcript}` : transcript;
      await setCaptureText(captureId, text);

      // Show the transcript back so a misheard word is obvious immediately.
      if (transcript.length > 0) {
        await api.sendMessage(
          chatId,
          `🎙 ${transcript}`,
          replyTo
            ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }
            : {},
        );
      }
    }

    if (text.trim().length === 0) {
      await markEnriched(captureId);
      return;
    }

    // Index the attribution with the words, so "what did my father say about the
    // oven" can find it later.
    const indexed = capture.author ? `${capture.author} said: ${text}` : text;
    const chunks = await indexCapture(captureId, indexed);

    const classification = await classify(indexed);
    if (classification) {
      await saveClassification(captureId, classification);
      log.info(
        { captureId, room: classification.context, intent: classification.intent, chunks },
        "classified",
      );
    }

    await markEnriched(captureId);

    // He never has to choose between noting something and asking something.
    // Everything is stored; a reply happens only when he actually asked.
    if (classification && NEEDS_THE_AGENT.has(classification.intent)) {
      await api.sendChatAction(chatId, "typing").catch(() => {});
      const reply = await respond(chatId, indexed);
      if (reply.trim().length > 0) {
        await api.sendMessage(
          chatId,
          reply,
          replyTo
            ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }
            : {},
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, captureId }, "enrich failed");
    await markFailed(captureId, message);

    // The capture is safe either way, but silence is indistinguishable from the
    // bot being broken. Tell him which provider stopped and what it costs him.
    if (isProviderError(err)) await notifyOutage(api, chatId, err);

    throw err; // let pg-boss retry
  }
}
