import { createHash } from "node:crypto";
import { query, one } from "../db/index.js";
import { log } from "../log.js";
import { parseIcs, type IcsEvent } from "../integrations/ics.js";
import { ensureCalendar, putEvent, deleteEventIn, isConfigured } from "../integrations/google.js";

/**
 * His Teams work calendar, mirrored one way into Google.
 *
 * Read side: a published Outlook ICS link, so his employer's IT never has to
 * approve an app. Write side: a dedicated "Work (Teams)" calendar in Google, so
 * nothing the bot or he creates in Google can ever travel back to work — there
 * is no code path that writes to Outlook at all.
 *
 * Edited single occurrences of a recurring meeting (RECURRENCE-ID) are skipped:
 * the series still shows, one moved instance may show at its old time.
 */
const URL_KEY = "teams_ics_url";
const CALENDAR_NAME = "Work (Teams)";

export async function setTeamsUrl(url: string): Promise<void> {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [URL_KEY, url],
  );
}

function hashOf(e: IcsEvent): string {
  return createHash("sha1").update(JSON.stringify([e.summary, e.location, e.start, e.end, e.recurrence])).digest("hex");
}

export async function mirrorTeams(): Promise<{ added: number; updated: number; removed: number } | null> {
  const row = await one<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [URL_KEY]);
  if (!row?.value || !isConfigured()) return null;

  const res = await fetch(row.value.replace(/^webcal:/i, "https:"));
  if (!res.ok) throw new Error(`Teams calendar feed ${res.status}`);
  const events = parseIcs(await res.text()).filter((e) => !e.recurrenceId && !e.cancelled);

  const calendarId = await ensureCalendar(CALENDAR_NAME);
  const known = new Map(
    (await query<{ uid: string; google_id: string; hash: string }>(`SELECT uid, google_id, hash FROM calendar_mirror`))
      .map((r) => [r.uid, r]),
  );

  let added = 0, updated = 0, removed = 0;
  const seen = new Set<string>();

  for (const e of events) {
    seen.add(e.uid);
    const hash = hashOf(e);
    const prior = known.get(e.uid);
    if (prior?.hash === hash) continue;

    const body = {
      summary: e.summary,
      location: e.location ?? undefined,
      start: e.start,
      end: e.end,
      recurrence: e.recurrence.length ? e.recurrence : undefined,
      // Visible as work in his combined view, and never reminds him on top of Teams.
      reminders: { useDefault: false, overrides: [] },
    };
    try {
      const googleId = await putEvent(calendarId, prior?.google_id ?? null, body);
      await query(
        `INSERT INTO calendar_mirror (uid, google_id, hash) VALUES ($1,$2,$3)
         ON CONFLICT (uid) DO UPDATE SET google_id = EXCLUDED.google_id, hash = EXCLUDED.hash, synced_at = now()`,
        [e.uid, googleId, hash],
      );
      prior ? updated++ : added++;
    } catch (err) {
      log.warn({ err, uid: e.uid }, "teams mirror: event failed");
    }
  }

  // Gone from the feed means cancelled or deleted at work: remove it here too.
  for (const [uid, r] of known) {
    if (seen.has(uid)) continue;
    await deleteEventIn(calendarId, r.google_id).catch((err) => log.warn({ err, uid }, "teams mirror: delete failed"));
    await query(`DELETE FROM calendar_mirror WHERE uid = $1`, [uid]);
    removed++;
  }

  log.info({ added, updated, removed, total: events.length }, "teams mirror");
  return { added, updated, removed };
}
