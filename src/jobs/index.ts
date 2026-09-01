import PgBoss from "pg-boss";
import type { Api } from "grammy";
import { log } from "../log.js";
import { enrichCapture } from "./enrich.js";
import { fireDueReminders, sendBrief } from "./brief.js";
import { config } from "../config.js";

export const ENRICH_QUEUE = "capture.enrich";
const TICK_QUEUE = "reminders.tick";
const MORNING_QUEUE = "brief.morning";
const WEEKLY_QUEUE = "brief.weekly";

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

  for (const name of [TICK_QUEUE, MORNING_QUEUE, WEEKLY_QUEUE]) {
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

  // Cron is evaluated in the timezone we pass, so DST is handled for us.
  const tz = { tz: config.timezone };
  await instance.schedule(TICK_QUEUE, "* * * * *", {}, tz);
  await instance.schedule(MORNING_QUEUE, "30 6 * * *", {}, tz);
  await instance.schedule(WEEKLY_QUEUE, "0 18 * * 0", {}, tz);

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
