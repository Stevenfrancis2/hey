import type { Api } from "grammy";
import { query, one } from "../db/index.js";
import { log } from "../log.js";
import { snapshots, isConfigured as bambuConfigured } from "../integrations/bambu.js";
import { filament, low as lowFilament } from "../memory/farm.js";

/**
 * The part that speaks first.
 *
 * Everything else here waits to be asked. This looks at what it already knows
 * every couple of hours and says something only when something is actually
 * wrong — a printer that failed twice, filament that will not cover tomorrow,
 * a deadline that has quietly become overdue.
 *
 * The checks are plain SQL and arithmetic, not a model deciding what "wrong"
 * means. A model asked "is anything wrong?" will always find something, and a
 * watchdog that cries every two hours gets muted inside a week. The model is
 * only used to phrase what the checks already found, and only when they found
 * something.
 */

export type Concern = { kind: string; detail: string; severity: 1 | 2 | 3 };

const QUIET_START = 0;   // he works until midnight
const QUIET_END = 10;    // and wakes at ten

function isQuietHour(now = new Date()): boolean {
  const hour = Number(now.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Beirut" }));
  return hour >= QUIET_START && hour < QUIET_END;
}

export async function findConcerns(): Promise<Concern[]> {
  const out: Concern[] = [];

  // ── the farm ────────────────────────────────────────────
  if (bambuConfigured()) {
    for (const p of snapshots()) {
      if (p.hms.length > 0) {
        const worst = p.hms.find((h) => h.severity === "fatal" || h.severity === "serious") ?? p.hms[0]!;
        out.push({
          kind: "printer_error",
          detail: `${p.name}: ${worst.text}`,
          severity: worst.severity === "fatal" ? 3 : 2,
        });
      }
      // A printer that was mid-job and has gone quiet is either finished and
      // unreported, or unplugged. Both are worth a look before he drives there.
      if (p.stale && p.state === "RUNNING") {
        out.push({ kind: "printer_stale", detail: `${p.name} stopped reporting mid-print`, severity: 2 });
      }
    }
  }

  const failures = await query<{ printer_name: string; n: number }>(
    `SELECT printer_name, count(*)::int AS n FROM farm_jobs
     WHERE outcome = 'FAILED' AND end_ts > now() - interval '24 hours'
     GROUP BY printer_name HAVING count(*) >= 2`);
  for (const f of failures) {
    out.push({
      kind: "repeat_failure",
      detail: `${f.printer_name} has failed ${f.n} prints in 24 hours`,
      severity: 3,
    });
  }

  // ── filament ────────────────────────────────────────────
  const lines = await filament();
  const short = lowFilament(lines).filter((l) => l.total_g > 0);
  if (short.length >= 3) {
    out.push({
      kind: "filament_low",
      detail: `${short.length} colours nearly out: ${short.slice(0, 4).map((l) => `${l.material} ${l.color}`).join(", ")}`,
      severity: 1,
    });
  }

  // ── things he said he would do ──────────────────────────
  const overdue = await query<{ title: string; days: number }>(
    `SELECT t.title, extract(day from now() - t.due_at)::int AS days
     FROM tasks t WHERE t.status IN ('open','doing') AND t.due_at < now() - interval '1 day'
     ORDER BY t.due_at LIMIT 5`);
  for (const t of overdue) {
    out.push({ kind: "overdue_task", detail: `"${t.title}" is ${t.days} days past its date`, severity: 2 });
  }

  const deadlines = await query<{ name: string; days: number }>(
    `SELECT p.name, extract(day from p.deadline - now())::int AS days
     FROM projects p WHERE p.status = 'active' AND p.deadline IS NOT NULL
       AND p.deadline BETWEEN now() AND now() + interval '4 days'
     ORDER BY p.deadline`);
  for (const p of deadlines) {
    out.push({ kind: "deadline", detail: `${p.name} is due in ${p.days} days`, severity: 3 });
  }

  // No study check. He decides when to study; a watchdog nagging about a plan
  // the bot drew up for him was the thing he complained about most.

  // ── money someone owes him ──────────────────────────────
  const owed = await one<{ n: number; total: string }>(
    `SELECT count(*)::int AS n, coalesce(sum(amount_minor),0)::text AS total
     FROM ledger WHERE settled = false AND direction = 'in'
       AND occurred_on < current_date - 14`);
  if (owed && owed.n > 0) {
    out.push({
      kind: "unpaid",
      detail: `${owed.n} invoice${owed.n === 1 ? "" : "s"} unpaid for over two weeks, $${(Number(owed.total) / 100).toFixed(0)} total`,
      severity: 2,
    });
  }

  return out.sort((a, b) => b.severity - a.severity);
}

/** Stops it saying the same thing every two hours for a week. */
async function alreadySaid(concerns: Concern[]): Promise<boolean> {
  const fingerprint = concerns.map((c) => `${c.kind}:${c.detail}`).sort().join("|");
  const row = await one<{ value: string; updated_at: Date }>(
    `SELECT value, updated_at FROM app_settings WHERE key = 'watchdog_last'`);
  if (row?.value === fingerprint && Date.now() - new Date(row.updated_at).getTime() < 12 * 3600_000) {
    return true;
  }
  await query(
    `INSERT INTO app_settings (key, value) VALUES ('watchdog_last', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [fingerprint]);
  return false;
}

export async function runWatchdog(api: Api, chatId: number): Promise<void> {
  if (isQuietHour()) return;

  const concerns = await findConcerns();
  if (concerns.length === 0) {
    log.info("watchdog: nothing wrong");
    return;
  }
  // Severity 1 on its own is not worth interrupting him for.
  if (!concerns.some((c) => c.severity >= 2)) return;
  if (await alreadySaid(concerns)) {
    log.info({ n: concerns.length }, "watchdog: same as last time, staying quiet");
    return;
  }

  // Plain text, no model. The checks already say exactly what is wrong; paying
  // Sonnet with the whole tool belt to rephrase three lines cost more than the
  // checks were worth, and it stopped every time the account did.
  const ordered = [...concerns].sort((x, y) => y.severity - x.severity);
  const body = ordered.map((c) => `• ${c.detail}`).join("\n");
  await api.sendMessage(chatId, body).catch((err) => log.error({ err }, "watchdog send failed"));
  log.info({ concerns: concerns.length }, "watchdog spoke");
}
