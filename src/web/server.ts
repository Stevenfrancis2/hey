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
  passwordEnabled, checkPassword,
} from "./auth.js";
import { MANIFEST } from "./layout.js";
import { setGlobals as setFarmGlobals, saveProduct, deleteProduct, adjustSealed, openSpool,
         setOpenGrams } from "../memory/farm.js";
import {
  dashboard, tasksPage, projectsPage, roomsPage, roomPage,
  watchlistPage, searchPage, chatPage, loginPage, studyPage, moneyPage, deskPage, decisionsPage, bodyPage,
  farmPage, calendarPage, printersPage, pricingPage,
} from "./pages.js";
import { recordCapture } from "../memory/capture.js";
import { enqueueEnrich } from "../jobs/index.js";
import { respond } from "../agent/run.js";
import {
  consentUrl, exchangeCode, isConfigured as googleConfigured,
  connectedAccount, disconnect, redirectUri,
} from "../integrations/google.js";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { jarvisAudioBytes, isGreeting } from "../integrations/greeting.js";
import { coverBytes } from "../integrations/bambu.js";
import { transcribe } from "../integrations/transcribe.js";

// The Google callback carries no session cookie (Google redirects the browser
// there), so it is guarded by a one-time state value instead.
const OPEN_PATHS = new Set([
  "/health", "/login", "/telegram", "/manifest.webmanifest", "/icon.png", "/jarvis.mp3",
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

// Read from disk rather than inlined: the placeholder was a 1x1 teal pixel,
// which is invisible on a taskbar and looks broken as an installed app.
const ICON = await readFile(new URL("../../assets/icon.png", import.meta.url));
const ICON192 = await readFile(new URL("../../assets/icon-192.png", import.meta.url));

export async function startServer() {
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
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
  app.get("/icon.png", async (_req, reply) =>
    reply.type("image/png").header("cache-control", "public, max-age=86400").send(ICON));
  app.get("/icon-192.png", async (_req, reply) =>
    reply.type("image/png").header("cache-control", "public, max-age=86400").send(ICON192));

  // ── everything below the console needs a session ─────────
  app.addHook("onRequest", async (request, reply) => {
    if (OPEN_PATHS.has(request.url.split("?")[0] ?? "")) return;
    if (verifySession(request.cookies[SESSION_COOKIE])) return;
    reply.type("text/html").send(loginPage("Not signed in on this device yet."));
  });

  // Serving the asset rather than streaming bytes per request: 34 KB, cached
  // hard, and the console plays the same file Telegram sends.
  app.get("/jarvis.mp3", async (_r, reply) => {
    reply.type("audio/mpeg").header("cache-control", "public, max-age=31536000, immutable")
      .send(await jarvisAudioBytes());
  });

  app.post<{ Body: { password?: string } }>("/login", async (request, reply) => {
    if (passwordEnabled() && checkPassword(request.body.password ?? "")) {
      reply
        .setCookie(SESSION_COOKIE, makeSession(), {
          path: "/", httpOnly: true, sameSite: "lax",
          secure: isProduction, maxAge: SESSION_MAX_AGE,
        })
        .redirect("/");
      return;
    }
    reply.type("text/html").send(loginPage("Wrong password.", passwordEnabled()));
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
      loginPage(
        token ? "That link is used or expired — send /login again." : "Sign in to your console.",
        passwordEnabled(),
      ),
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
  app.get("/farm", async (_r, reply) => reply.type("text/html").send(await farmPage()));
  app.get("/printers", async (_r, reply) => reply.type("text/html").send(await printersPage()));
  app.get<{ Params: { id: string } }>("/cover/:id", async (request, reply) => {
    const img = await coverBytes(request.params.id);
    if (!img) { reply.code(404).send(); return; }
    reply.type(img.type).header("cache-control", "public, max-age=120").send(img.body);
  });
  app.get("/pricing", async (_r, reply) => reply.type("text/html").send(await pricingPage()));

  // The farm is his to manage, not the agent's. Plain form posts so it works
  // with no JavaScript and on a phone with one hand.
  app.post<{ Body: Record<string, string> }>("/pricing/globals", async (request, reply) => {
    const n = (k: string) => Number(request.body[k]);
    const patch: Record<string, number> = {};
    for (const k of ["filament_price", "electricity_price", "printer_power_kw", "h2c_multiplier",
                     "addon_part_cost", "packaging_cost", "fail_rate",
                     "low_markup", "mid_markup", "high_markup"]) {
      if (Number.isFinite(n(k))) patch[k] = n(k);
    }
    await setFarmGlobals(patch);
    reply.redirect("/pricing");
  });

  app.post<{ Body: Record<string, string> }>("/pricing/product", async (request, reply) => {
    const b = request.body;
    const n = (k: string) => (b[k] === undefined || b[k] === "" ? 0 : Number(b[k]));
    if ((b.name ?? "").trim()) {
      await saveProduct({
        name: (b.name ?? "").trim(), h2c: b.h2c === "on",
        filament_g: n("filament_g"), days: n("days"), hours: n("hours"),
        units_per_print: n("units_per_print"), addon_parts_per_unit: n("addon_parts_per_unit"),
        my_price: b.my_price ? Number(b.my_price) : null,
      });
    }
    reply.redirect("/pricing");
  });

  app.post<{ Params: { id: string } }>("/pricing/product/:id/delete", async (request, reply) => {
    await deleteProduct(request.params.id);
    reply.redirect("/pricing");
  });

  app.post<{ Params: { id: string }; Body: { delta?: string; grams?: string } }>(
    "/filament/:id", async (request, reply) => {
      const { delta, grams } = request.body;
      if (delta) await adjustSealed(request.params.id, Number(delta));
      if (grams !== undefined && grams !== "") await setOpenGrams(request.params.id, Number(grams));
      reply.redirect("/farm");
    });

  app.post<{ Params: { id: string } }>("/filament/:id/open", async (request, reply) => {
    await openSpool(request.params.id);
    reply.redirect("/farm");
  });
  app.get("/calendar", async (_r, reply) => reply.type("text/html").send(await calendarPage()));

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

  // The console gets the same microphone the phone has. Recording in the
  // browser and posting base64 keeps this to one route and no new dependency.
  app.post<{ Body: { audio?: string } }>("/chat/voice", async (request, reply) => {
    const b64 = request.body.audio ?? "";
    if (!b64) { reply.code(400).send({ error: "no audio" }); return; }
    try {
      const bytes = new Uint8Array(Buffer.from(b64, "base64"));
      const text = (await transcribe(bytes, "console.webm")).trim();
      if (!text) { reply.send({ text: "", reply: "I couldn't make that out." }); return; }
      const answer = await respond(config.telegram.ownerId, text);
      reply.send({ text, reply: answer, jarvis: isGreeting(text) });
    } catch (err) {
      log.error({ err }, "console voice failed");
      reply.code(500).send({ error: "transcription failed" });
    }
  });

  app.post<{ Body: { text?: string } }>("/chat", async (request, reply) => {
    const text = (request.body.text ?? "").trim();
    if (text) {
      await respond(config.telegram.ownerId, text).catch((err) =>
        log.error({ err }, "console chat failed"));
    }
    // The greeting clip lives in the Telegram enrichment path, which this route
    // does not go through — so a greeting typed here got nothing. The flag is
    // one-shot and the page strips it, so a refresh does not replay it.
    reply.redirect(isGreeting(text) ? "/chat?jarvis=1" : "/chat");
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  log.info({ port: config.port, production: isProduction }, "http server listening");
  return app;
}
