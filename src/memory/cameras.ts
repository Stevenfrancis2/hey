import { query, one } from "../db/index.js";

/**
 * Sixteen channels on a TVT NVR in Batroun, watched by something on his LAN
 * that pushes events here.
 *
 * Frankfurt cannot reach 192.168.100.239 and never will, so the direction is
 * fixed by the network rather than by preference: detection happens at home and
 * talks outwards. Nothing in this system dials into his house.
 */

export type Camera = {
  channel: number; name: string; notify: boolean;
  quiet_from: number | null; quiet_to: number | null; last_seen: Date | null;
};

export type Event = {
  id: string; channel: number; label: string; confidence: number | null;
  notified: boolean; at: Date; name?: string;
};

export async function listCameras(): Promise<Camera[]> {
  return query<Camera>(`SELECT * FROM cameras ORDER BY channel`);
}

export async function upsertCamera(channel: number, name: string): Promise<void> {
  await query(
    `INSERT INTO cameras (channel, name) VALUES ($1, $2)
     ON CONFLICT (channel) DO UPDATE SET name = EXCLUDED.name`,
    [channel, name]);
}

export async function setCamera(channel: number, patch: {
  name?: string; notify?: boolean; quietFrom?: number | null; quietTo?: number | null;
}): Promise<void> {
  await query(
    `UPDATE cameras SET
       name       = coalesce(nullif($2,''), name),
       notify     = coalesce($3::boolean, notify),
       quiet_from = CASE WHEN $4::text = 'set' THEN $5::smallint ELSE quiet_from END,
       quiet_to   = CASE WHEN $4::text = 'set' THEN $6::smallint ELSE quiet_to END
     WHERE channel = $1`,
    [channel, patch.name ?? "", patch.notify ?? null,
     patch.quietFrom === undefined ? "" : "set", patch.quietFrom ?? null, patch.quietTo ?? null]);
}

/** Hours are local to Batroun; a window that wraps midnight is normal. */
function inQuietWindow(cam: Camera, now = new Date()): boolean {
  if (cam.quiet_from === null || cam.quiet_to === null) return false;
  const hour = Number(now.toLocaleString("en-GB",
    { hour: "2-digit", hour12: false, timeZone: "Asia/Beirut" }));
  return cam.quiet_from <= cam.quiet_to
    ? hour >= cam.quiet_from && hour < cam.quiet_to
    : hour >= cam.quiet_from || hour < cam.quiet_to;
}

/**
 * One notification per camera per label per cooldown. A person walking up the
 * drive trips the detector twenty times in ten seconds; twenty photos is not an
 * alert, it is a reason to mute the bot.
 */
const COOLDOWN_MS = 3 * 60_000;

export async function record(input: {
  channel: number; label: string; confidence?: number | null; snapshot?: Buffer | null;
}): Promise<{ id: string; notify: boolean; camera: Camera | null }> {
  const cam = await one<Camera>(`SELECT * FROM cameras WHERE channel = $1`, [input.channel]);

  const row = await one<{ id: string }>(
    `INSERT INTO camera_events (channel, label, confidence, snapshot)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [input.channel, input.label, input.confidence ?? null, input.snapshot ?? null]);

  await query(
    `INSERT INTO cameras (channel, name, last_seen) VALUES ($1, $2, now())
     ON CONFLICT (channel) DO UPDATE SET last_seen = now()`,
    [input.channel, `Channel ${input.channel}`]);

  const recent = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM camera_events
     WHERE channel = $1 AND label = $2 AND notified = true
       AND at > now() - make_interval(secs => $3::int)`,
    [input.channel, input.label, COOLDOWN_MS / 1000]);

  const notify =
    (cam?.notify ?? true) &&
    !(cam && inQuietWindow(cam)) &&
    (recent?.n ?? 0) === 0;

  if (notify) await query(`UPDATE camera_events SET notified = true WHERE id = $1`, [row!.id]);
  return { id: row!.id, notify, camera: cam };
}

export async function snapshotOf(id: string): Promise<Buffer | null> {
  const row = await one<{ snapshot: Buffer | null }>(
    `SELECT snapshot FROM camera_events WHERE id = $1`, [id]);
  return row?.snapshot ?? null;
}

export async function recentEvents(limit = 40): Promise<Event[]> {
  return query<Event>(
    `SELECT e.id, e.channel, e.label, e.confidence, e.notified, e.at, c.name
     FROM camera_events e LEFT JOIN cameras c ON c.channel = e.channel
     ORDER BY e.at DESC LIMIT $1`, [limit]);
}

/** Keeps the table from growing without bound; the images are the bulk. */
export async function prune(days = 14): Promise<number> {
  const r = await query(
    `DELETE FROM camera_events WHERE at < now() - make_interval(days => $1::int) RETURNING id`,
    [days]);
  return r.length;
}
