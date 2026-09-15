/**
 * Throwaway behaviour test for the archive. Run: npx tsx archive.tmp.ts
 * The archive is the guarantee nothing is trapped, so this asserts on the
 * actual contents rather than on it merely producing output.
 */
import { pool, query } from "./src/db/index.js";
import { migrate } from "./src/db/migrate.js";
import { buildMarkdown, buildJson } from "./src/archive/build.js";
import { record } from "./src/memory/money.js";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n      expected ${expected}, got ${actual}`);
}

async function main() {
  await migrate();
  await query("DELETE FROM capture_enrichment");
  await query("DELETE FROM chunks");
  await query("DELETE FROM captures");
  await query("DELETE FROM ledger");

  // A normal typed capture.
  await query(
    `INSERT INTO captures (chat_id, kind, raw_text, status)
     VALUES (7569157465, 'text', 'H2C nozzle clogged on the bee batch', 'enriched')`,
  );
  // A voice note whose transcription failed: no text at all. This used to be
  // filtered out of the readable archive entirely.
  await query(
    `INSERT INTO captures (chat_id, kind, raw_text, status, error)
     VALUES (7569157465, 'voice', NULL, 'failed', 'groq timeout')`,
  );
  // A ledger entry — the table that was missing from the JSON dump completely.
  await record({
    direction: "in",
    amount: 4000,
    counterparty: "retail store",
    contextKey: "cligli",
    note: "wholesale order",
  });

  // ── JSON: completeness ───────────────────────────────────
  const json = JSON.parse(await buildJson()) as Record<string, unknown>;

  const publicTables = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'`,
  );
  const NEVER = new Set(["oauth_tokens", "llm_calls", "archive_runs"]);
  const expectedTables = publicTables.map((r) => r.table_name).filter((t) => !NEVER.has(t));

  const missing = expectedTables.filter((t) => !(t in json));
  check("every archivable table is in the JSON", missing.join(",") || "none", "none");
  // 36 tables in the schema, 3 deliberately held back.
  check("table count", Number(json.tables), expectedTables.length);
  check("36 tables total in schema", publicTables.length, 36);

  // The specific regression: the ledger used to be absent.
  const ledger = json.ledger as unknown[];
  check("ledger is archived", Array.isArray(ledger) && ledger.length, 1);
  // to_jsonb renders bigint as a JSON number. Safe below 2^53 — $90bn in cents.
  check("ledger amount survives as minor units", Number((ledger[0] as { amount_minor: unknown }).amount_minor), 400000);

  // Tables that were missing before this fix, spot-checked by name.
  for (const t of ["bills", "gear", "decisions", "study_goals", "body_log", "dough_batches", "repairs"]) {
    check(`${t} present`, t in json, true);
  }

  // Credentials must never be written into a file delivered over Telegram.
  check("oauth_tokens withheld", "oauth_tokens" in json, false);

  // ── Markdown: nothing silently omitted ───────────────────
  const md = await buildMarkdown();
  check("typed capture in markdown", md.includes("H2C nozzle clogged on the bee batch"), true);
  check("failed voice note is reported, not dropped", md.includes("[voice with no text: groq timeout]"), true);
  check("markdown has the ledger-bearing room", md.includes("cligli"), true);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
