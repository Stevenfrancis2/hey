import "dotenv/config";

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
  timezone: optional("TZ", "Europe/Paris"),

  /** Set in production. Its presence switches the bot from polling to webhooks. */
  publicUrl: process.env.PUBLIC_URL || null,

  telegram: {
    token: required("TELEGRAM_BOT_TOKEN"),
    ownerId: Number(required("TELEGRAM_OWNER_ID")),
    webhookSecret: optional("TELEGRAM_WEBHOOK_SECRET", "sven-local-secret"),
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
