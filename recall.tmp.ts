/**
 * Throwaway behaviour test: recall must survive the embedding provider being
 * unavailable. Run: npx tsx recall.tmp.ts
 * VOYAGE_API_KEY is a placeholder in .env, so embed() genuinely fails here —
 * this exercises the real degraded path, not a mock.
 */
import { pool, query } from "./src/db/index.js";
import { indexCapture } from "./src/memory/index.js";
import { recall } from "./src/memory/recall.js";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n      expected ${expected}, got ${actual}`);
}

async function main() {
  await query("DELETE FROM chunks");
  await query("DELETE FROM capture_enrichment");
  await query("DELETE FROM captures");

  const cap = await query<{ id: string }>(
    `INSERT INTO captures (chat_id, kind, raw_text, status)
     VALUES (7569157465,'text','the 0.4 hardened nozzle for the H2C is clogged again','enriched')
     RETURNING id`,
  );
  const other = await query<{ id: string }>(
    `INSERT INTO captures (chat_id, kind, raw_text, status)
     VALUES (7569157465,'text','dough hydration at 65 percent overnight cold ferment','enriched')
     RETURNING id`,
  );

  const id = cap[0]!.id;
  const n = await indexCapture(id, "the 0.4 hardened nozzle for the H2C is clogged again");
  const m = await indexCapture(other[0]!.id, "dough hydration at 65 percent overnight cold ferment");
  check("chunks written despite no embedding provider", n >= 1, true);
  check("second capture chunked too", m >= 1, true);

  const stored = await query<{ n: string; embedded: string }>(
    `SELECT count(*) AS n, count(embedding) AS embedded FROM chunks`,
  );
  check("chunk text persisted", Number(stored[0]?.n), 2);
  // The whole point: text survived, embeddings did not.
  check("embeddings are null, awaiting backfill", Number(stored[0]?.embedded), 0);

  // Full-text half must still answer.
  const hits = await recall("nozzle clogged", 5);
  check("lexical recall returns the right capture", hits.length >= 1, true);
  check(
    "top hit is the nozzle note, not the dough note",
    hits[0]?.text.includes("nozzle"),
    true,
  );

  const dough = await recall("hydration ferment", 5);
  check("a different query finds the other capture", dough[0]?.text.includes("hydration"), true);

  // A query matching nothing must return empty, not throw.
  const none = await recall("kangaroo", 5);
  check("no match returns empty cleanly", none.length, 0);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
