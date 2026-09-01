import type { Api } from "grammy";
import { log } from "../log.js";
import { getCapture, markEnriched, markFailed, setCaptureText } from "../memory/capture.js";
import { indexCapture } from "../memory/index.js";
import { transcribe } from "../integrations/transcribe.js";
import { downloadFile } from "../integrations/telegram-files.js";

/**
 * Everything expensive happens here, off the message path: transcribe if it
 * was spoken, then chunk and embed so it is findable.
 */
export async function enrichCapture(api: Api, captureId: string): Promise<void> {
  const capture = await getCapture(captureId);
  if (!capture) {
    log.warn({ captureId }, "enrich: capture vanished");
    return;
  }

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
        const replyTo = capture.telegram_message_id ? Number(capture.telegram_message_id) : null;
        await api.sendMessage(
          Number(capture.chat_id),
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
    await markEnriched(captureId);
    log.info({ captureId, chunks }, "indexed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, captureId }, "enrich failed");
    await markFailed(captureId, message);
    throw err; // let pg-boss retry
  }
}
