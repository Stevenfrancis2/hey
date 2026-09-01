import PgBoss from "pg-boss";
import type { Api } from "grammy";
import { log } from "../log.js";
import { enrichCapture } from "./enrich.js";

export const ENRICH_QUEUE = "capture.enrich";

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

  boss = instance;
  log.info("job runner started");
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
