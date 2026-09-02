import { query, toVector } from "../db/index.js";
import { chunkText } from "./chunk.js";
import { embed } from "./embed.js";
import { log } from "./../log.js";

/** Replaces a capture's chunks with a freshly embedded set. */
export async function indexCapture(captureId: string, text: string): Promise<number> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return 0;

  // Losing the embedding costs him semantic search until it is backfilled.
  // Losing the chunk costs him the thought. The text goes in either way, and
  // stays findable by full text in the meantime.
  let vectors: number[][] = [];
  try {
    vectors = await embed(chunks, "document");
  } catch (err) {
    log.warn({ err, captureId }, "embedding failed; storing chunks unembedded");
  }

  await query(`DELETE FROM chunks WHERE capture_id = $1`, [captureId]);
  for (const [i, chunk] of chunks.entries()) {
    const vector = vectors[i];
    await query(
      `INSERT INTO chunks (capture_id, text, embedding) VALUES ($1, $2, $3::vector)`,
      [captureId, chunk, vector ? toVector(vector) : null],
    );
  }
  return chunks.length;
}
