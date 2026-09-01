const TARGET = 1200;
const OVERLAP = 150;

/**
 * Splits on paragraph then sentence boundaries, falling back to a hard cut.
 * Most captures are a single chunk; this only matters for long dictations.
 */
export function chunkText(input: string): string[] {
  const text = input.trim();
  if (text.length === 0) return [];
  if (text.length <= TARGET) return [text];

  const sentences = text.split(/(?<=[.!?…])\s+|\n{2,}/).filter((s) => s.trim().length > 0);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length > 0 && current.length + sentence.length + 1 > TARGET) {
      chunks.push(current.trim());
      current = current.slice(-OVERLAP);
    }
    current += (current.length > 0 ? " " : "") + sentence;
  }
  if (current.trim().length > 0) chunks.push(current.trim());

  // A single sentence longer than TARGET still needs splitting.
  return chunks.flatMap((chunk) =>
    chunk.length <= TARGET * 1.5
      ? [chunk]
      : (chunk.match(new RegExp(`.{1,${TARGET}}`, "gs")) ?? [chunk]),
  );
}
