/**
 * Throwaway behaviour test. Run: npx tsx money-cost.tmp.ts
 * Every expected number below is computed by hand in the comment above it.
 */
import { pool, query } from "./src/db/index.js";
import { migrate } from "./src/db/migrate.js";
import { record, affordability, summary, addBill, toMinor, money } from "./src/memory/money.js";
import { recordUsage, costSummary } from "./src/agent/client.js";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n      expected ${expected}, got ${actual}`);
}

async function main() {
  await migrate();

  // Clean slate for the tables under test.
  await query("DELETE FROM ledger");
  await query("DELETE FROM bills");
  await query("DELETE FROM llm_calls");

  // ── Money: minor units ───────────────────────────────────
  // 19.99 dollars is 1999 cents. Never 1998.99999.
  check("toMinor(19.99)", toMinor(19.99), 1999);
  check("toMinor(0.1+0.2 worth)", toMinor(0.3), 30);
  check("money(-45050)", money(-45050), "-$450.50");

  // ── Affordability ────────────────────────────────────────
  // Settled in 1000, settled out 250  -> cash = 75000 minor
  await record({ direction: "in", amount: 1000, contextKey: "cligli", settled: true });
  await record({ direction: "out", amount: 250, contextKey: "cligli", settled: true });
  // A receivable: 4000 owed TO him, unsettled. Must NOT count as spendable.
  await record({ direction: "in", amount: 4000, counterparty: "retail store", settled: false });
  // A payable: 500 he owes, unsettled.
  await record({ direction: "out", amount: 500, counterparty: "filament supplier", settled: false });
  // A recurring bill of 100/month.
  await addBill({ name: "hosting", amount: 100 });

  const aff = await affordability("USD");
  // cash    = 100000 - 25000            = 75000
  check("cash", aff.cashMinor, 75000);
  // owed to him = 400000 (excluded from free)
  check("owedToHim", aff.owedToHimMinor, 400000);
  // owed by him = 50000
  check("owedByHim", aff.owedByHimMinor, 50000);
  // bills   = 10000
  check("bills", aff.monthlyBillsMinor, 10000);
  // free    = 75000 - 50000 - 10000     = 15000  ($150.00)
  check("free EXCLUDES the 4k receivable", aff.freeMinor, 15000);
  // The bug this guards: if receivables leaked in, free would be 415000.
  check("free is not the leaked figure", aff.freeMinor === 415000, false);

  // ── Currency isolation ───────────────────────────────────
  // 5,000,000 LBP in. Must appear as its own row, never folded into USD.
  await record({ direction: "in", amount: 5_000_000, currency: "LBP", contextKey: "royal_pizza" });
  const rows = await summary({});
  const currencies = [...new Set(rows.map((r) => r.currency))].sort();
  check("summary groups by currency", currencies.join(","), "LBP,USD");
  const usdNet = rows.filter((r) => r.currency === "USD").reduce((s, r) => s + Number(r.net_minor), 0);
  // Only settled USD counts: 100000 in - 25000 out = 75000
  check("USD net unaffected by LBP row", usdNet, 75000);

  // ── Cost accounting ──────────────────────────────────────
  // Opus 5: $5/Mtok in, $25/Mtok out. Cache read 0.1x, cache write 1.25x.
  // input 1000 fresh, 20000 cache read, 5000 cache write, 500 out:
  //   fresh  1000  * 5.00 = 5000
  //   read  20000  * 0.50 = 10000
  //   write  5000  * 6.25 = 31250
  //   out     500  * 25.0 = 12500
  //   total = 58750 / 1e6 = $0.058750
  await recordUsage(
    "chat",
    "claude-opus-5",
    {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 20000,
      cache_creation_input_tokens: 5000,
    },
    1234,
  );
  const costRow = await query<{ cost_usd: string; cache_write: number }>(
    "SELECT cost_usd, cache_write FROM llm_calls ORDER BY id DESC LIMIT 1",
  );
  check("cost is the hand-computed figure", Number(costRow[0]?.cost_usd), 0.05875);
  check("cache_write persisted", Number(costRow[0]?.cache_write), 5000);

  // The old formula did fresh = max(0, input - cacheRead) = 0 and ignored writes:
  //   (0 + 10000 + 12500)/1e6 = $0.022500  -> understated by 2.61x
  const oldFormula = (0 * 5 + 20000 * 0.5 + 500 * 25) / 1_000_000;
  check("old formula was wrong", oldFormula === 0.05875, false);
  console.log(`      old would have reported $${oldFormula.toFixed(6)} — understated ${(0.05875 / oldFormula).toFixed(2)}x`);

  const costs = await costSummary();
  // totalIn = 1000 fresh + 20000 read + 5000 write = 26000; read share = 20000/26000 = 76.9% -> 77
  const totalIn = costs.freshIn + costs.cacheRead + costs.cacheWrite;
  check("cache hit rate maths", Math.round((costs.cacheRead / totalIn) * 100), 77);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
