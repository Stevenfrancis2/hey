import { config } from "./config.js";
import { log } from "./log.js";
import { pool } from "./db/index.js";
import { migrate } from "./db/migrate.js";
import { bot } from "./bot/index.js";
import { startJobs, stopJobs } from "./jobs/index.js";
import { startServer } from "./web/server.js";
import { seedProfile } from "./agent/prompt.js";

async function main(): Promise<void> {
  await migrate();
  await seedProfile();
  await startJobs(bot.api);

  // Bring the health endpoint up before touching Telegram: if Telegram is
  // briefly unreachable at boot, the platform health check must still pass
  // rather than restart-looping the machine.
  const app = await startServer();

  // Cosmetic. Never worth failing a boot over.
  await bot.api
    .setMyCommands([
      { command: "recall", description: "Search everything you've ever sent" },
      { command: "recent", description: "The last ten things" },
      { command: "stats", description: "What's in the brain" },
    ])
    .catch((err) => log.warn({ err }, "could not set command list"));

  if (config.publicUrl) {
    const url = `${config.publicUrl.replace(/\/$/, "")}/telegram`;
    await bot.api.setWebhook(url, {
      secret_token: config.telegram.webhookSecret,
      drop_pending_updates: false,
    });
    log.info({ url }, "webhook registered");
  } else {
    await bot.api.deleteWebhook();
    void bot.start({ onStart: (me) => log.info({ username: me.username }, "polling") });
  }

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, "shutting down");
    await bot.stop().catch(() => {});
    await stopJobs().catch(() => {});
    await app.close().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error({ err }, "failed to start");
  process.exit(1);
});
