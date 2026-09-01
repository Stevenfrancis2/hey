import Fastify from "fastify";
import { webhookCallback } from "grammy";
import { config, isProduction } from "../config.js";
import { bot } from "../bot/index.js";
import { log } from "../log.js";
import { pool } from "../db/index.js";

export async function startServer() {
  const app = Fastify({ logger: false });

  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { ok: true, mode: config.publicUrl ? "webhook" : "polling" };
  });

  if (config.publicUrl) {
    app.post(
      "/telegram",
      webhookCallback(bot, "fastify", { secretToken: config.telegram.webhookSecret }),
    );
  }

  await app.listen({ port: config.port, host: "0.0.0.0" });
  log.info({ port: config.port, production: isProduction }, "http server listening");
  return app;
}
