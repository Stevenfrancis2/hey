import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const SECRET = config.sessionSecret;
const SESSION_DAYS = 90;

/**
 * Login by one-time link sent over Telegram. No passwords to forget, no email
 * to configure, and it works on every device — you tap the link on the iPad and
 * the iPad is logged in.
 */
const pending = new Map<string, number>();

export function issueLoginToken(): string {
  const token = randomBytes(24).toString("base64url");
  pending.set(token, Date.now() + 10 * 60_000);
  // Opportunistic sweep; this map never holds more than a handful of entries.
  for (const [key, expiry] of pending) if (expiry < Date.now()) pending.delete(key);
  return token;
}

export function redeemLoginToken(token: string): boolean {
  const expiry = pending.get(token);
  if (expiry === undefined) return false;
  pending.delete(token);
  return expiry > Date.now();
}

function sign(value: string): string {
  return createHmac("sha256", SECRET).update(value).digest("base64url");
}

export function makeSession(): string {
  const expiry = String(Date.now() + SESSION_DAYS * 864e5);
  return `${expiry}.${sign(expiry)}`;
}

export function verifySession(cookie: string | undefined): boolean {
  if (!cookie) return false;
  const [expiry, signature] = cookie.split(".");
  if (!expiry || !signature) return false;
  if (Number(expiry) < Date.now()) return false;

  const expected = Buffer.from(sign(expiry));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * A password is the second way in, because the magic link needs Telegram and he
 * is not always willing to open it. Optional: unset CONSOLE_PASSWORD and the
 * form does not render, so nothing is weakened by default.
 *
 * Compared in constant time and only at full length, so the endpoint leaks
 * neither the password nor its length to someone guessing.
 */
export function passwordEnabled(): boolean {
  return (config.consolePassword ?? "").length > 0;
}

export function checkPassword(given: string): boolean {
  const secret = config.consolePassword ?? "";
  if (secret.length === 0) return false;
  const a = createHmac("sha256", SECRET).update(given).digest();
  const b = createHmac("sha256", SECRET).update(secret).digest();
  return timingSafeEqual(a, b);
}

export const SESSION_COOKIE = "sven_session";
export const SESSION_MAX_AGE = SESSION_DAYS * 86400;
