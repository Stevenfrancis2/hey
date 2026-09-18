/**
 * Two phrasings of the same thing. The model rewords on every re-ask — "Start
 * the girl statue print on the H2C" then "start girl statue print (H2C)" — so
 * exact-text matching let five copies of one reminder through.
 */
const STOP = new Set(["the", "a", "an", "to", "on", "in", "at", "for", "of", "and", "my", "me", "with", "it"]);

export function words(text: string): Set<string> {
  return new Set(
    text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** Share of the smaller phrasing's words that appear in the other. */
export function overlap(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

export const SAME_THING = 0.75;
