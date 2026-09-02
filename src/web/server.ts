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
import {
  consentUrl, exchangeCode, isConfigured as googleConfigured,
  connectedAccount, disconnect, redirectUri,
} from "../integrations/google.js";
import { randomBytes } from "node:crypto";

// The Google callback carries no session cookie (Google redirects the browser
// there), so it is guarded by a one-time state value instead.
const OPEN_PATHS = new Set([
  "/health", "/login", "/telegram", "/manifest.webmanifest", "/icon.png",
  "/auth/google/callback",
]);

const googleStates = new Map<string, number>();

export function issueGoogleState(): string {
  const state = randomBytes(24).toString("base64url");
  googleStates.set(state, Date.now() + 10 * 60_000);
  for (const [key, expiry] of googleStates) if (expiry < Date.now()) googleStates.delete(key);
  return state;
}

function redeemGoogleState(state: string | undefined): boolean {
  if (!state) return false;
  const expiry = googleStates.get(state);
  if (expiry === undefined) return false;
  googleStates.delete(state);
  return expiry > Date.now();
}

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

  // ── Google connect ──────────────────────────────────────
  app.get("/auth/google", async (_req, reply) => {
    if (!googleConfigured()) {
      reply.type("text/html").send(
        loginPage("Google is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first."),
      );
      return;
    }
    reply.redirect(consentUrl(issueGoogleState()));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/google/callback",
    async (request, reply) => {
      const { code, state, error } = request.query;
      if (error) {
        reply.type("text/html").send(loginPage(`Google returned: ${error}`));
        return;
      }
      if (!redeemGoogleState(state)) {
        reply.type("text/html").send(loginPage("That connect link is used or expired. Send /connect again."));
        return;
      }
      if (!code) {
        reply.type("text/html").send(loginPage("Google returned no authorisation code."));
        return;
      }
      try {
        await exchangeCode(code);
        reply.type("text/html").send(
          loginPage("Google connected. Drive and Calendar are live — you can close this tab."),
        );
      } catch (err) {
        log.error({ err }, "google callback failed");
        reply.type("text/html").send(
          loginPage(err instanceof Error ? err.message : "Google connection failed."),
        );
      }
    },
  );

  app.get("/auth/google/disconnect", async (_r, reply) => {
    await disconnect();
    reply.redirect("/");
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
