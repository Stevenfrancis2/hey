import type { Api } from "grammy";
import { log } from "../log.js";

export type Provider = "anthropic" | "voyage" | "groq";

/**
 * `credit` and `auth` need him to go and do something; `rate_limit` and
 * `unavailable` fix themselves. `bad_request` is a bug in here — telling him the
 * provider is down when the fault is ours sends him to check a status page over
 * a line of our own code. The distinction decides what he is told.
 */
export type OutageKind = "credit" | "limit" | "auth" | "rate_limit" | "unavailable" | "bad_request";

const WHERE_TO_TOP_UP: Record<Provider, string> = {
  anthropic: "console.anthropic.com/settings/billing",
  voyage: "dashboard.voyageai.com",
  groq: "console.groq.com/settings/billing",
};

/**
 * What breaks for him when each provider stops, in his terms. Never mentions a
 * status code — he is holding a phone, not a log viewer.
 */
const CONSEQUENCE: Record<Provider, string> = {
  anthropic: "I can't answer or sort anything until it's back. Everything you send is still saved.",
  voyage: "Search still works, on exact words instead of meaning. Everything is still saved.",
  groq: "Voice notes won't be transcribed. The audio is saved and I'll transcribe it once it's back.",
};

export class ProviderError extends Error {
  constructor(
    readonly provider: Provider,
    readonly kind: OutageKind,
    readonly status: number | null,
    readonly detail: string,
  ) {
    super(`${provider} ${kind}${status ? ` (${status})` : ""}: ${detail}`);
    this.name = "ProviderError";
  }

  /** True when topping up or fixing a key is the only way out. */
  get needsHim(): boolean {
    return this.kind === "credit" || this.kind === "limit" || this.kind === "auth";
  }

  /** Plain text for Telegram: no markdown, short lines, says what to do. */
  get forTelegram(): string {
    const name = this.provider === "anthropic" ? "Anthropic" : this.provider === "voyage" ? "Voyage" : "Groq";
    const consequence = CONSEQUENCE[this.provider];

    switch (this.kind) {
      case "credit":
        return `${name} is out of credit.\n\n${consequence}\n\nTop up at ${WHERE_TO_TOP_UP[this.provider]}, then send it again.`;
      case "limit": {
        // The monthly cap he set on the Anthropic console. Not empty credit — topping
        // up does nothing; the cap has to be raised, or it waits for the reset date.
        const until = /regain access on ([0-9-]+)/i.exec(this.detail)?.[1];
        return `You hit the monthly spend limit set on your Anthropic account.

${consequence}

` +
          `Raise it at console.anthropic.com/settings/limits` +
          (until ? `, or it switches back on by itself on ${until}.` : ".");
      }
      case "auth":
        return `${name} rejected the API key.\n\n${consequence}\n\nCheck the key at ${WHERE_TO_TOP_UP[this.provider]} — it may have been revoked or rotated.`;
      case "rate_limit":
        return `${name} is rate limiting me. ${consequence}\n\nThis clears on its own — I'll retry.`;
      case "unavailable":
        return `${name} is down or unreachable. ${consequence}\n\nI'll retry.`;
      case "bad_request":
        return `I sent ${name} something it rejected. That's a bug in me — not an outage, ` +
          `not your credit.\n\n${consequence}\n\nI'll retry, and it's worth mentioning.`;
    }
  }
}

export function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}

/**
 * Out of credit is a 400 on every one of these three, not a dedicated status, so
 * the body text is the only thing that separates it from a malformed request.
 *
 * Matching the bare word "billing" is tempting and wrong: Groq's free-tier 429
 * advertises its billing page inside the rate-limit message, which would report
 * a five-second throttle as an empty account.
 */
const CREDIT_SIGNALS = [
  "credit balance is too low",
  "insufficient credit",
  "insufficient_quota",
  "exceeded your current quota",
  "quota exceeded",
  "billing_hard_limit_reached",
  "payment required",
  "out of credits",
  "add a payment method",
  "no active subscription",
];

/**
 * A console spend cap arrives as a 400 invalid_request_error, the same shape as a
 * malformed request. It was being reported as "a bug in me" while the account was
 * simply capped for the rest of the month — and because a bad request is not
 * something he can fix, the classifier swallowed it and his questions were filed
 * as notes with no reply at all.
 */
const LIMIT_SIGNALS = ["specified api usage limits", "usage limit", "regain access on"];

const RATE_LIMIT_SIGNALS = ["rate limit", "rate_limit", "too many requests"];

function has(body: string, signals: string[]): boolean {
  const t = body.toLowerCase();
  return signals.some((s) => t.includes(s));
}

function kindFor(status: number, body: string): OutageKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "credit";

  // Credit wins over rate limit when both are named: a 429 that says the balance
  // is empty is not going to clear on its own.
  if (has(body, CREDIT_SIGNALS)) return "credit";
  if (has(body, LIMIT_SIGNALS)) return "limit";
  if (status === 429 || has(body, RATE_LIMIT_SIGNALS)) return "rate_limit";
  if (status >= 500) return "unavailable";

  // A 400 is us sending something the model does not accept — a parameter the
  // tier does not support, a malformed request. Calling that "the provider is
  // down" sent him to check Anthropic's status page over a bug in this repo.
  if (status === 400) return "bad_request";
  return "unavailable";
}

/** For the raw-fetch integrations: Voyage and Groq. */
export function httpOutage(provider: Provider, status: number, body: string): ProviderError {
  return new ProviderError(provider, kindFor(status, body), status, body.slice(0, 400));
}

type SdkError = { status?: number; message?: string; error?: unknown };

/**
 * The Anthropic SDK throws its own error classes. Reading `status` and the
 * message off them structurally avoids importing error classes whose names have
 * changed between SDK majors before.
 */
export function asProviderError(provider: Provider, err: unknown): ProviderError | null {
  if (isProviderError(err)) return err;
  if (typeof err !== "object" || err === null) return null;

  const e = err as SdkError;
  const status = typeof e.status === "number" ? e.status : null;
  const body = `${e.message ?? ""} ${e.error ? JSON.stringify(e.error) : ""}`;

  if (status !== null) return new ProviderError(provider, kindFor(status, body), status, body.slice(0, 400));

  // No status means it never reached them — DNS, TLS, a dropped connection.
  const message = String(e.message ?? "");
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)) {
    return new ProviderError(provider, "unavailable", null, message.slice(0, 400));
  }
  return null;
}

/**
 * Telling him the same thing on every pg-boss retry would be worse than silence,
 * so each provider-and-kind is announced at most once an hour. In memory on
 * purpose: a restart re-announcing a still-broken provider is the harmless
 * direction to be wrong in.
 */
const ANNOUNCE_EVERY_MS = 60 * 60 * 1000;
const lastAnnounced = new Map<string, number>();

export async function notifyOutage(api: Api, chatId: number, err: unknown): Promise<boolean> {
  const outage = isProviderError(err) ? err : null;
  if (!outage) return false;

  const key = `${outage.provider}:${outage.kind}`;
  const last = lastAnnounced.get(key) ?? 0;
  if (Date.now() - last < ANNOUNCE_EVERY_MS) return false;
  lastAnnounced.set(key, Date.now());

  try {
    await api.sendMessage(chatId, outage.forTelegram, { link_preview_options: { is_disabled: true } });
    log.warn({ provider: outage.provider, kind: outage.kind }, "told him about the outage");
    return true;
  } catch (sendErr) {
    log.error({ err: sendErr }, "could not warn about provider outage");
    return false;
  }
}

/** Only for tests. */
export function resetOutageNotices(): void {
  lastAnnounced.clear();
}
