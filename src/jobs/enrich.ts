import type { Api } from "grammy";
import { log } from "../log.js";
import { getCapture, markEnriched, markFailed, setCaptureText } from "../memory/capture.js";
import { indexCapture } from "../memory/index.js";
import { transcribe } from "../integrations/transcribe.js";
import { downloadFile } from "../integrations/telegram-files.js";
import { classify, saveClassification } from "../agent/classify.js";
import { respond } from "../agent/run.js";

/** Intents where he is talking *to* the assistant rather than *at* it. */
const WANTS_A_REPLY = new Set(["question", "request"]);

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

    const chunks = await indexCapture(captureId, text);

    const classification = await classify(text);
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
    if (classification && WANTS_A_REPLY.has(classification.intent)) {
      await api.sendChatAction(chatId, "typing").catch(() => {});
      const reply = await respond(chatId, text);
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
    throw err; // let pg-boss retry
  }
}
