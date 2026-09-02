import { one, query } from "../db/index.js";
import { config } from "../config.js";
import { log } from "../log.js";

/**
 * Raw REST against Google's APIs rather than the googleapis package — that
 * dependency is ~50MB for the handful of calls used here, and these endpoints
 * are stable and simple.
 */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE = "https://www.googleapis.com/drive/v3";
const CALENDAR = "https://www.googleapis.com/calendar/v3";

export const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export function isConfigured(): boolean {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

export function redirectUri(): string {
  const base = (config.publicUrl ?? `http://localhost:${config.port}`).replace(/\/$/, "");
  return `${base}/auth/google/callback`;
}

/** The consent URL. `prompt=consent` forces a refresh token to be returned. */
export function consentUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await response.json()) as TokenResponse;
  if (!response.ok || json.error) {
    throw new Error(`Google token exchange failed: ${json.error_description ?? json.error ?? response.status}`);
  }
  return json;
}

export async function exchangeCode(code: string): Promise<void> {
  const token = await postToken({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  if (!token.refresh_token) {
    throw new Error(
      "Google returned no refresh token. Revoke access at myaccount.google.com/permissions and connect again.",
    );
  }

  let email: string | null = null;
  try {
    const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (me.ok) email = ((await me.json()) as { email?: string }).email ?? null;
  } catch {
    // Identifying the account is a nicety, not a requirement.
  }

  await query(
    `INSERT INTO oauth_tokens (provider, refresh_token, scope, account_email)
     VALUES ('google', $1, $2, $3)
     ON CONFLICT (provider) DO UPDATE SET
       refresh_token = EXCLUDED.refresh_token, scope = EXCLUDED.scope,
       account_email = EXCLUDED.account_email, updated_at = now()`,
    [token.refresh_token, token.scope ?? SCOPES, email],
  );
  log.info({ email }, "google connected");
}

export async function connectedAccount(): Promise<string | null> {
  const row = await one<{ account_email: string | null }>(
    `SELECT account_email FROM oauth_tokens WHERE provider = 'google'`,
  );
  return row ? (row.account_email ?? "connected") : null;
}

export async function disconnect(): Promise<void> {
  await query(`DELETE FROM oauth_tokens WHERE provider = 'google'`);
}

// Access tokens last an hour; cache in memory and refresh a minute early.
let cached: { token: string; expiresAt: number } | null = null;

export async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const row = await one<{ refresh_token: string }>(
    `SELECT refresh_token FROM oauth_tokens WHERE provider = 'google'`,
  );
  if (!row) throw new Error("Google is not connected. Send /connect in Telegram.");

  const token = await postToken({
    refresh_token: row.refresh_token,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    grant_type: "refresh_token",
  });
  cached = { token: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  return token.access_token;
}

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Google API ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

// ── Drive ──────────────────────────────────────────────────
export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
};

export async function listDriveFiles(opts: { since?: Date | null; folderId?: string | null; limit?: number } = {}):
  Promise<DriveFile[]> {
  const clauses = ["trashed = false"];
  if (opts.since) clauses.push(`modifiedTime > '${opts.since.toISOString()}'`);
  if (opts.folderId) clauses.push(`'${opts.folderId}' in parents`);

  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc",
    pageSize: String(opts.limit ?? 50),
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const body = await api<{ files: DriveFile[] }>(`${DRIVE}/files?${params.toString()}`);
  return body.files ?? [];
}

export async function searchDrive(text: string, limit = 15): Promise<DriveFile[]> {
  const escaped = text.replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `trashed = false and fullText contains '${escaped}'`,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    pageSize: String(limit),
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const body = await api<{ files: DriveFile[] }>(`${DRIVE}/files?${params.toString()}`);
  return body.files ?? [];
}

/** Google-native formats must be exported; everything else downloads directly. */
const EXPORTABLE: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

const READABLE = /^(text\/|application\/(json|xml|x-yaml|pdf))/;

export async function readDriveFile(file: DriveFile, maxChars = 40_000): Promise<string | null> {
  const token = await accessToken();
  const exportAs = EXPORTABLE[file.mimeType];

  let url: string;
  if (exportAs) {
    url = `${DRIVE}/files/${file.id}/export?mimeType=${encodeURIComponent(exportAs)}`;
  } else if (READABLE.test(file.mimeType)) {
    url = `${DRIVE}/files/${file.id}?alt=media&supportsAllDrives=true`;
  } else {
    return null; // images, video, binaries — nothing useful to index as text
  }

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Drive read ${response.status} for ${file.name}`);

  if (file.mimeType === "application/pdf") {
    // Text extraction from PDF is not attempted here; the name and link are
    // still indexed so it is findable, and he can open it.
    return null;
  }
  const text = await response.text();
  return text.slice(0, maxChars);
}

// ── Calendar ───────────────────────────────────────────────
export type CalEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  htmlLink?: string;
};

export async function listEvents(opts: { from?: Date; to?: Date; limit?: number } = {}): Promise<CalEvent[]> {
  const from = opts.from ?? new Date();
  const to = opts.to ?? new Date(Date.now() + 7 * 864e5);
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(opts.limit ?? 25),
  });
  const body = await api<{ items: CalEvent[] }>(
    `${CALENDAR}/calendars/primary/events?${params.toString()}`,
  );
  return body.items ?? [];
}

export async function createEvent(input: {
  summary: string; start: Date; end: Date; description?: string | null; location?: string | null;
}): Promise<CalEvent> {
  return api<CalEvent>(`${CALENDAR}/calendars/primary/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description ?? undefined,
      location: input.location ?? undefined,
      start: { dateTime: input.start.toISOString(), timeZone: config.timezone },
      end: { dateTime: input.end.toISOString(), timeZone: config.timezone },
    }),
  });
}

/**
 * Free slots of at least `minutes`, inside working hours, over the next `days`.
 * Pure function over the event list so it is testable without the network.
 */
export function freeSlots(
  events: CalEvent[],
  opts: { minutes: number; days?: number; dayStartHour?: number; dayEndHour?: number; from?: Date },
): { start: Date; end: Date }[] {
  const days = opts.days ?? 5;
  const startHour = opts.dayStartHour ?? 9;
  const endHour = opts.dayEndHour ?? 20;
  const now = opts.from ?? new Date();

  const busy = events
    .filter((e) => e.start.dateTime && e.end.dateTime)
    .map((e) => ({ start: new Date(e.start.dateTime!), end: new Date(e.end.dateTime!) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slots: { start: Date; end: Date }[] = [];

  for (let d = 0; d < days; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);

    let cursor = new Date(day);
    cursor.setHours(startHour, 0, 0, 0);
    if (d === 0 && cursor < now) cursor = new Date(Math.ceil(now.getTime() / 9e5) * 9e5); // next 15 min

    const dayEnd = new Date(day);
    dayEnd.setHours(endHour, 0, 0, 0);

    for (const block of busy) {
      if (block.end <= cursor || block.start >= dayEnd) continue;
      if (block.start.getTime() - cursor.getTime() >= opts.minutes * 60_000) {
        slots.push({ start: new Date(cursor), end: new Date(block.start) });
      }
      if (block.end > cursor) cursor = new Date(block.end);
    }
    if (dayEnd.getTime() - cursor.getTime() >= opts.minutes * 60_000) {
      slots.push({ start: new Date(cursor), end: dayEnd });
    }
  }
  return slots;
}
