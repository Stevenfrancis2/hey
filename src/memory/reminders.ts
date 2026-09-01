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
