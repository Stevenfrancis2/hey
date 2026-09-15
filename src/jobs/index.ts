import PgBoss from "pg-boss";
import type { Api } from "grammy";
import { log } from "../log.js";
import { query } from "../db/index.js";
import { enrichCapture } from "./enrich.js";
import { fireDueReminders, sendBrief } from "./brief.js";
import { runArchive } from "./archive.js";
import { runResearch, runScout } from "./research.js";
import { syncDrive } from "./drive.js";
import { config } from "../config.js";

export const ENRICH_QUEUE = "capture.enrich";
const TICK_QUEUE = "reminders.tick";
const MORNING_QUEUE = "brief.morning";
const WEEKLY_QUEUE = "brief.weekly";
const ARCHIVE_QUEUE = "archive.nightly";
const SWEEP_QUEUE = "capture.sweep";
const DESK_DAILY_QUEUE = "research.daily";
const DESK_WEEKLY_QUEUE = "research.weekly";
const SCOUT_QUEUE = "automation.scout";
const DRIVE_QUEUE = "drive.sync";

export type EnrichJob = { captureId: string };

let boss: PgBoss | null = null;

export async function startJobs(api: Api): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing DATABASE_URL");

  const instance = new PgBoss({ connectionString, schema: "pgboss" });
  instance.on("error", (err) => log.error({ err }, "pg-boss error"));

  await instance.start();
  await instance.createQueue(ENRICH_QUEUE);

  await instance.work<EnrichJob>(
    ENRICH_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: 1 },
    async (jobs) => {
      // pg-boss v10 hands the worker an array.
      for (const job of Array.isArray(jobs) ? jobs : [jobs]) {
        await enrichCapture(api, job.data.captureId);
      }
    },
  );

  // ── scheduled work ──────────────────────────────────────
  const chatId = config.telegram.ownerId;

  for (const name of [TICK_QUEUE, MORNING_QUEUE, WEEKLY_QUEUE, ARCHIVE_QUEUE, SWEEP_QUEUE,
                      DESK_DAILY_QUEUE, DESK_WEEKLY_QUEUE, SCOUT_QUEUE, DRIVE_QUEUE]) {
    await instance.createQueue(name);
  }

  await instance.work(TICK_QUEUE, { batchSize: 1 }, async () => {
    const fired = await fireDueReminders(api, chatId);
    if (fired > 0) log.info({ fired }, "reminders fired");
  });
  await instance.work(MORNING_QUEUE, { batchSize: 1 }, async () => {
    await sendBrief(api, chatId, "morning");
  });
  await instance.work(WEEKLY_QUEUE, { batchSize: 1 }, async () => {
    await sendBrief(api, chatId, "weekly");
  });
  await instance.work(ARCHIVE_QUEUE, { batchSize: 1 }, async () => {
    await runArchive(api, chatId, false);
  });
  await instance.work(DESK_DAILY_QUEUE, { batchSize: 1 }, async () => {
    await runResearch(api, chatId, "daily");
  });
  await instance.work(DESK_WEEKLY_QUEUE, { batchSize: 1 }, async () => {
    await runResearch(api, chatId, "weekly");
  });
  await instance.work(SCOUT_QUEUE, { batchSize: 1 }, async () => {
    await runScout(api, chatId);
  });
  await instance.work(DRIVE_QUEUE, { batchSize: 1 }, async () => {
    await syncDrive();
  });

  // A capture is written before it is enqueued. If the process dies in between,
  // or the queue is briefly unavailable, the row would sit pending forever —
  // and a lost thought is the one failure this system cannot have.
  await instance.work(SWEEP_QUEUE, { batchSize: 1 }, async () => {
    const stuck = await query<{ id: string }>(
      `SELECT id FROM captures
       WHERE status = 'pending' AND captured_at < now() - interval '5 minutes'
       ORDER BY captured_at LIMIT 25`,
    );
    for (const row of stuck) await enqueueEnrich(row.id);
    if (stuck.length > 0) log.warn({ recovered: stuck.length }, "swept stranded captures");
  });

  // Cron is evaluated in the timezone we pass, so DST is handled for us.
  //
  // Every time below is pinned to his actual day, not a 9-to-5 he does not work:
  // he wakes at 10:00, runs CliGli and the side projects until 16:00, then works
  // a Chicago shift 16:00-00:00. Anything that pings him between 16:00 and
  // midnight interrupts paid work, and anything before 10:00 arrives while he is
  // asleep. The original 06:30 brief and 03:00 archive did both.
  const tz = { tz: config.timezone };
  await instance.schedule(TICK_QUEUE, "* * * * *", {}, tz);
  await instance.schedule(MORNING_QUEUE, "0 10 * * *", {}, tz);       // as he wakes
  await instance.schedule(WEEKLY_QUEUE, "0 11 * * 0", {}, tz);        // Sunday, off shift
  await instance.schedule(ARCHIVE_QUEUE, "30 9 * * *", {}, tz);       // waiting for him, not a 03:00 notification
  await instance.schedule(SWEEP_QUEUE, "*/10 * * * *", {}, tz);
  // The desk is the one real cost driver, so it runs once a day, not hourly.
  await instance.schedule(DESK_DAILY_QUEUE, "0 14 * * *", {}, tz);    // mid own-business block
  await instance.schedule(DESK_WEEKLY_QUEUE, "0 11 * * 6", {}, tz);   // Saturday, off shift
  await instance.schedule(SCOUT_QUEUE, "0 11 1 * *", {}, tz);
  // Drive stays overnight: it is a silent sync, it never messages him.
  await instance.schedule(DRIVE_QUEUE, "0 2 * * *", {}, tz);

  boss = instance;
  log.info({ timezone: config.timezone }, "job runner started");
  return instance;
}

export async function enqueueEnrich(captureId: string): Promise<void> {
  if (!boss) throw new Error("job runner not started");
  await boss.send(ENRICH_QUEUE, { captureId } satisfies EnrichJob, {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
  });
}

export async function stopJobs(): Promise<void> {
  await boss?.stop({ graceful: true });
  boss = null;
}
