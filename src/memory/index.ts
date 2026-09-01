import { query, toVector } from "../db/index.js";
import { chunkText } from "./chunk.js";
import { embed } from "./embed.js";

/** Replaces a capture's chunks with a freshly embedded set. */
export async function indexCapture(captureId: string, text: string): Promise<number> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return 0;

  const vectors = await embed(chunks, "document");

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
