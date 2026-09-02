import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { webhookCallback } from "grammy";
import { config, isProduction } from "../config.js";
import { bot } from "../bot/index.js";
import { log } from "../log.js";
import { pool } from "../db/index.js";
import {
  SESSION_COOKIE, SESSION_MAX_AGE, makeSession, redeemLoginToken, verifySession,
} from "./auth.js";
import { MANIFEST } from "./layout.js";
import {
  dashboard, tasksPage, projectsPage, roomsPage, roomPage,
  watchlistPage, searchPage, chatPage, loginPage, studyPage, moneyPage, deskPage, decisionsPage, bodyPage,
} from "./pages.js";
import { recordCapture } from "../memory/capture.js";
import { enqueueEnrich } from "../jobs/index.js";
import { respond } from "../agent/run.js";

const OPEN_PATHS = new Set(["/health", "/login", "/telegram", "/manifest.webmanifest", "/icon.png"]);

// A flat teal square. Inlined so there is no asset pipeline for one icon.
const ICON = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export async function startServer() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(formbody);

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

  app.get("/manifest.webmanifest", async (_req, reply) =>
    reply.type("application/manifest+json").send(MANIFEST));
  app.get("/icon.png", async (_req, reply) => reply.type("image/png").send(ICON));

  // ── everything below the console needs a session ─────────
  app.addHook("onRequest", async (request, reply) => {
    if (OPEN_PATHS.has(request.url.split("?")[0] ?? "")) return;
    if (verifySession(request.cookies[SESSION_COOKIE])) return;
    reply.type("text/html").send(loginPage("Not signed in on this device yet."));
  });

  app.get<{ Querystring: { t?: string } }>("/login", async (request, reply) => {
    const token = request.query.t;
    if (token && redeemLoginToken(token)) {
      reply
        .setCookie(SESSION_COOKIE, makeSession(), {
          path: "/", httpOnly: true, sameSite: "lax",
          secure: isProduction, maxAge: SESSION_MAX_AGE,
        })
        .redirect("/");
      return;
    }
    reply.type("text/html").send(
      loginPage(token ? "That link is used or expired — send /login again." : "Send /login to the bot."),
    );
  });

  app.get("/", async (_r, reply) => reply.type("text/html").send(await dashboard()));
  app.get("/tasks", async (_r, reply) => reply.type("text/html").send(await tasksPage()));
  app.get("/projects", async (_r, reply) => reply.type("text/html").send(await projectsPage()));
  app.get("/rooms", async (_r, reply) => reply.type("text/html").send(await roomsPage()));
  app.get<{ Params: { key: string } }>("/room/:key", async (request, reply) =>
    reply.type("text/html").send(await roomPage(request.params.key)));
  app.get("/decisions", async (_r, reply) => reply.type("text/html").send(await decisionsPage()));
  app.get("/body", async (_r, reply) => reply.type("text/html").send(await bodyPage()));
  app.get("/desk", async (_r, reply) => reply.type("text/html").send(await deskPage()));
  app.get("/money", async (_r, reply) => reply.type("text/html").send(await moneyPage()));
  app.get("/study", async (_r, reply) => reply.type("text/html").send(await studyPage()));
  app.get("/watchlist", async (_r, reply) => reply.type("text/html").send(await watchlistPage()));
  app.get<{ Querystring: { q?: string } }>("/search", async (request, reply) =>
    reply.type("text/html").send(await searchPage(request.query.q)));
  app.get("/chat", async (_r, reply) =>
    reply.type("text/html").send(await chatPage(config.telegram.ownerId)));

  // Capture from the desktop, through exactly the same path as Telegram.
  app.post<{ Body: { text?: string } }>("/capture", async (request, reply) => {
    const text = (request.body.text ?? "").trim();
    if (text) {
      const id = await recordCapture({
        telegramMessageId: 0,
        chatId: config.telegram.ownerId,
        kind: "text",
        rawText: text,
      });
      void enqueueEnrich(id).catch((err) => log.error({ err, id }, "enqueue failed"));
    }
    reply.redirect("/");
  });

  app.post<{ Body: { text?: string } }>("/chat", async (request, reply) => {
    const text = (request.body.text ?? "").trim();
    if (text) {
      await respond(config.telegram.ownerId, text).catch((err) =>
        log.error({ err }, "console chat failed"));
    }
    reply.redirect("/chat");
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  log.info({ port: config.port, production: isProduction }, "http server listening");
  return app;
}
