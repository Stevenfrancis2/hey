import { anthropic, recordUsage } from "../agent/client.js";
import { config } from "../config.js";
import { log } from "../log.js";

/**
 * Turns a photo or a PDF into text, so everything else in the system — recall,
 * embeddings, the classifier, the archive — works on it unchanged.
 *
 * Nothing here interprets on his behalf. It reads what is actually in the
 * image: the numbers on the label, the error on the screen, the words on the
 * quote. A summary would lose exactly the detail he photographed it for.
 */

const READ_IMAGE = `Read this image for Steven and write down what is actually in it.

Rules:
- Transcribe every piece of text you can see — labels, prices, part numbers, error
  codes, handwriting, screen readouts. Exact characters, do not tidy them up.
- Then one or two lines on what the picture shows, so it can be found later by
  someone searching in words.
- If it is a screenshot, say what application it is and what state it is in.
- No preamble, no "this image shows". Just the content.
- If the image is unreadable, say so in one line rather than guessing.`;

const READ_PDF = `Read this document for Steven and write down what it contains.

Rules:
- Every number that matters: prices, quantities, dates, totals, part numbers.
- Who it is from and what it is for, if the document says.
- Keep his own vocabulary where the document uses it.
- Dense and factual. This is going into a searchable memory, not a summary for a
  human to read over coffee.
- No preamble.`;

const MIME_IMAGE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export function canRead(mime: string | null | undefined): boolean {
  if (!mime) return false;
  return MIME_IMAGE.has(mime) || mime === "application/pdf";
}

/**
 * Runs on the fast model by default. A supplier's price list and a failed print
 * do not need Opus to be read accurately, and this runs on every photo he
 * sends — the cost difference is the whole reason he can send them freely.
 */
export async function readMedia(
  bytes: Uint8Array,
  mime: string,
  caption?: string | null,
): Promise<string | null> {
  const isPdf = mime === "application/pdf";
  if (!isPdf && !MIME_IMAGE.has(mime)) return null;

  const data = Buffer.from(bytes).toString("base64");
  const started = Date.now();

  const block = isPdf
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: mime as "image/jpeg", data } };

  const instruction = (isPdf ? READ_PDF : READ_IMAGE) +
    (caption ? `\n\nHe sent it with this note, which is context, not instruction: "${caption}"` : "");

  try {
    const response = await anthropic.messages.create({
      model: config.anthropic.fastModel,
      max_tokens: 2048,
      messages: [{ role: "user", content: [block, { type: "text", text: instruction }] }],
    });

    await recordUsage("distill", config.anthropic.fastModel, response.usage, Date.now() - started);

    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n")
      .trim();
    log.info({ mime, chars: text.length, ms: Date.now() - started }, "media read");
    return text || null;
  } catch (err) {
    // A photo that cannot be read is still a capture. It keeps its file id and
    // its caption, and he can ask about it later — losing the row would be worse.
    log.warn({ err, mime }, "media read failed");
    return null;
  }
}
