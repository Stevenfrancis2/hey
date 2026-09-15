/**
 * Throwaway behaviour test: reminders must fire exactly once even with two
 * workers racing, and tasks must close by loose title match.
 * Run: npx tsx tasks-reminders.tmp.ts
 */
import { pool, query } from "./src/db/index.js";
import { createReminder, claimDueReminders, listReminders, cancelReminder } from "./src/memory/reminders.js";
import { createTask, listTasks, completeTask, snoozeTask } from "./src/memory/tasks.js";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n      expected ${expected}, got ${actual}`);
}

async function main() {
  await query("DELETE FROM reminders");
  await query("DELETE FROM tasks");

  // ── Reminders: due vs not due ────────────────────────────
  // Times are taken from the DATABASE clock, not this process's. The two differ
  // here by ~143s (Docker Desktop VM drift), and "due" is decided in Postgres.
  const [{ past, future }] = await query<{ past: Date; future: Date }>(
    "SELECT now() - interval '5 minutes' AS past, now() + interval '1 hour' AS future",
  );
  await createReminder("take the H2C plate out", past);
  await createReminder("call the filament supplier", past);
  await createReminder("gym at six", future);

  check("three reminders scheduled", (await listReminders()).length, 3);

  // Two workers claim simultaneously. FOR UPDATE SKIP LOCKED must give each
  // reminder to exactly one of them — a restart mid-send must not double-fire.
  const [a, b] = await Promise.all([claimDueReminders(), claimDueReminders()]);
  const claimedIds = [...a, ...b].map((r) => r.id);
  const uniqueIds = new Set(claimedIds);
  check("two due reminders claimed in total", claimedIds.length, 2);
  check("no reminder claimed twice", uniqueIds.size, 2);
  check("the future one was not claimed", claimedIds.length, uniqueIds.size);

  // A third pass finds nothing left to fire.
  const third = await claimDueReminders();
  check("nothing left to claim", third.length, 0);

  const statuses = await query<{ status: string; n: string }>(
    "SELECT status, count(*) AS n FROM reminders GROUP BY status ORDER BY status",
  );
  check("two fired, one still scheduled", JSON.stringify(statuses), '[{"status":"fired","n":"2"},{"status":"scheduled","n":"1"}]');

  // Cancelling by fragment.
  const cancelled = await cancelReminder("gym");
  check("cancelled by loose fragment", cancelled?.text, "gym at six");

  // ── Tasks ────────────────────────────────────────────────
  await createTask({ title: "order 0.4 hardened nozzles for the H2C", contextKey: "cligli" });
  await createTask({ title: "deploy NeMo container on the GPU box", contextKey: "bank_ai" });
  await createTask({ title: "buy dough flour", contextKey: "royal_pizza" });

  const open = await listTasks({});
  check("three open tasks", open.length, 3);

  // He will not type the title exactly. Closing must work from a fragment.
  const done = await completeTask("hardened nozzles");
  check("closed by fragment", done?.title, "order 0.4 hardened nozzles for the H2C");
  check("two open tasks remain", (await listTasks({})).length, 2);

  // Room filtering keeps the rooms separate.
  const bank = await listTasks({ contextKey: "bank_ai" });
  check("bank room has exactly its own task", bank.length, 1);
  check("and it is the right one", bank[0]?.title, "deploy NeMo container on the GPU box");

  // Snooze hides a task until its time, without closing it. Disappearing from
  // the list is the whole point — it is still open underneath.
  const [{ tomorrow }] = await query<{ tomorrow: Date }>("SELECT now() + interval '1 day' AS tomorrow");
  const snoozed = await snoozeTask("dough flour", tomorrow);
  check("snoozed task still open, not closed", snoozed?.status, "open");
  check("snoozed task hidden from the list", (await listTasks({})).length, 1);
  const stillThere = await query<{ n: string }>(
    "SELECT count(*) AS n FROM tasks WHERE status = 'open' AND snoozed_until IS NOT NULL",
  );
  check("but still open in the table", Number(stillThere[0]?.n), 1);

  // A fragment matching nothing must return null, not throw or close the wrong one.
  const miss = await completeTask("something he never said");
  check("no match closes nothing", miss, null);
  check("nothing else was closed", (await listTasks({})).length, 1);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
