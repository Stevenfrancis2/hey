import { one, query } from "../db/index.js";

export type Reminder = { id: string; text: string; fire_at: Date | null; status: string };

export async function createReminder(text: string, fireAt: Date): Promise<Reminder> {
  const row = await one<Reminder>(
    `INSERT INTO reminders (text, fire_at) VALUES ($1, $2)
     RETURNING id, text, fire_at, status`,
    [text, fireAt],
  );
  if (!row) throw new Error("reminder insert returned no row");
  return row;
}

/**
 * A repeating reminder, expanded into one row per occurrence at creation time.
 *
 * Not an rrule evaluated at fire time, deliberately: rows he can see, count and
 * cancel individually beat a rule he cannot inspect. It also means one tool call
 * covers "every day until next Wednesday" — before this, eight days meant eight
 * separate calls, which is how the agent ran out of room and started describing
 * work instead of doing it.
 */
export async function createRepeating(
  text: string,
  first: Date,
  every: "day" | "week",
  until: Date,
): Promise<Reminder[]> {
  const out: Reminder[] = [];
  const step = every === "day" ? 1 : 7;
  const cap = every === "day" ? 90 : 52;

  for (let i = 0, at = new Date(first); i < cap && at <= until; i++) {
    if (at.getTime() > Date.now() - 60_000) out.push(await createReminder(text, new Date(at)));
    at = new Date(at.getTime() + step * 864e5);
  }
  return out;
}

/** Cancels every scheduled reminder whose text matches, not just the first. */
export async function cancelAllMatching(fragment: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE reminders SET status = 'cancelled'
     WHERE status = 'scheduled' AND text ILIKE '%' || $1 || '%' RETURNING id`,
    [fragment],
  );
  return rows.length;
}

export async function listReminders(): Promise<Reminder[]> {
  return query<Reminder>(
    `SELECT id, text, fire_at, status FROM reminders
     WHERE status = 'scheduled' ORDER BY fire_at ASC LIMIT 50`,
  );
}

export async function cancelReminder(textFragment: string): Promise<Reminder | null> {
  return one<Reminder>(
    `UPDATE reminders SET status = 'cancelled'
     WHERE id = (
       SELECT id FROM reminders
       WHERE status = 'scheduled' AND text ILIKE '%' || $1 || '%'
       ORDER BY fire_at ASC LIMIT 1
     )
     RETURNING id, text, fire_at, status`,
    [textFragment],
  );
}

/** Claims everything due, atomically, so a restart mid-send cannot double-fire. */
export async function claimDueReminders(): Promise<Reminder[]> {
  return query<Reminder>(
    `UPDATE reminders SET status = 'fired', fired_at = now()
     WHERE id IN (
       SELECT id FROM reminders
       WHERE status = 'scheduled' AND fire_at IS NOT NULL AND fire_at <= now()
       ORDER BY fire_at
       FOR UPDATE SKIP LOCKED
       LIMIT 20
     )
     RETURNING id, text, fire_at, status`,
  );
}

// ── Editing from the console ──────────────────────────────
export async function cancelById(id: string): Promise<void> {
  await query(`UPDATE reminders SET status = 'cancelled' WHERE id = $1`, [id]);
}

export async function shiftById(id: string, hours: number): Promise<void> {
  await query(
    `UPDATE reminders SET fire_at = fire_at + make_interval(hours => $2::int)
     WHERE id = $1 AND status = 'scheduled'`, [id, hours]);
}

export async function editReminder(id: string, text: string, at: Date | null): Promise<void> {
  await query(
    `UPDATE reminders SET text = coalesce(nullif($2,''), text),
                          fire_at = coalesce($3::timestamptz, fire_at)
     WHERE id = $1`, [id, text, at]);
}
