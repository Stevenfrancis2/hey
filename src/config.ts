import "dotenv/config";
import { randomBytes } from "node:crypto";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export const config = {
  env: optional("NODE_ENV", "development"),
  port: Number(optional("PORT", "8080")),
  logLevel: optional("LOG_LEVEL", "info"),
  timezone: optional("TZ", "Asia/Beirut"),

  /** Set in production. Its presence switches the bot from polling to webhooks. */
  publicUrl: process.env.PUBLIC_URL || null,

  telegram: {
    token: required("TELEGRAM_BOT_TOKEN"),
    ownerId: Number(required("TELEGRAM_OWNER_ID")),
    webhookSecret: optional("TELEGRAM_WEBHOOK_SECRET", "sven-local-secret"),
  },

  /**
   * Signs console session cookies. Deliberately NOT the Telegram webhook secret:
   * that one is handed to Telegram, so anyone holding it could mint sessions and
   * read the finance room. Different trust domain, different key.
   *
   * In production it must be set explicitly — a default would let anyone who has
   * read this repository forge a session. In development a random per-boot value
   * is fine; it just means a restart signs you out.
   */
  sessionSecret: (() => {
    const provided = process.env.SESSION_SECRET;
    if (provided && provided.length >= 16) return provided;
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SESSION_SECRET must be set to at least 16 characters in production. " +
          "Generate one with: openssl rand -hex 32",
      );
    }
    return randomBytes(32).toString("hex");
  })(),

  /** Google Drive and Calendar. Optional — everything else works without them. */
  google: {
    clientId: optional("GOOGLE_CLIENT_ID", ""),
    clientSecret: optional("GOOGLE_CLIENT_SECRET", ""),
    driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || null,
  },

  /** Open-Meteo needs coordinates. Defaults to Beirut. */
  location: {
    latitude: Number(optional("LATITUDE", "33.8938")),
    longitude: Number(optional("LONGITUDE", "35.5018")),
    name: optional("LOCATION_NAME", "Beirut, Lebanon"),
  },

  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
    model: optional("ANTHROPIC_MODEL", "claude-opus-5"),
    fastModel: optional("ANTHROPIC_FAST_MODEL", "claude-haiku-4-5"),
  },

  voyage: {
    apiKey: required("VOYAGE_API_KEY"),
    model: optional("VOYAGE_MODEL", "voyage-3.5-lite"),
    dimensions: 1024,
  },

  groq: {
    apiKey: required("GROQ_API_KEY"),
    model: optional("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo"),
  },
} as const;

export const isProduction = config.env === "production";
