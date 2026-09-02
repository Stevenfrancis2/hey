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
  const tz = { tz: config.timezone };
  await instance.schedule(TICK_QUEUE, "* * * * *", {}, tz);
  await instance.schedule(MORNING_QUEUE, "30 6 * * *", {}, tz);
  await instance.schedule(WEEKLY_QUEUE, "0 18 * * 0", {}, tz);
  await instance.schedule(ARCHIVE_QUEUE, "0 3 * * *", {}, tz);
  await instance.schedule(SWEEP_QUEUE, "*/10 * * * *", {}, tz);
  // The desk is the one real cost driver, so it runs once a day, not hourly.
  await instance.schedule(DESK_DAILY_QUEUE, "0 8 * * *", {}, tz);
  await instance.schedule(DESK_WEEKLY_QUEUE, "0 17 * * 6", {}, tz);
  await instance.schedule(SCOUT_QUEUE, "0 19 1 * *", {}, tz);
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
