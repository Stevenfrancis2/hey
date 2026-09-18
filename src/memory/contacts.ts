import { one, query } from "../db/index.js";

export type Contact = {
  id: string;
  kind: string;
  name: string;
  room: string | null;
  offers: string | null;
  location: string | null;
  url: string | null;
  phone: string | null;
  notes: string | null;
  status: string;
};

const COLS = `id, kind, name, room, offers, location, url, phone, notes, status`;

/** Upsert by kind and name, so telling it twice about the same shop updates it. */
export async function saveContact(input: Partial<Contact> & { kind: string; name: string }): Promise<Contact> {
  const row = await one<Contact>(
    `INSERT INTO contacts (kind, name, room, offers, location, url, phone, notes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,'new'))
     ON CONFLICT (kind, name) DO UPDATE SET
       room = coalesce(EXCLUDED.room, contacts.room),
       offers = coalesce(EXCLUDED.offers, contacts.offers),
       location = coalesce(EXCLUDED.location, contacts.location),
       url = coalesce(EXCLUDED.url, contacts.url),
       phone = coalesce(EXCLUDED.phone, contacts.phone),
       notes = coalesce(EXCLUDED.notes, contacts.notes),
       status = coalesce($9, contacts.status),
       updated_at = now()
     RETURNING ${COLS}`,
    [input.kind, input.name, input.room ?? null, input.offers ?? null, input.location ?? null,
     input.url ?? null, input.phone ?? null, input.notes ?? null, input.status ?? null],
  );
  if (!row) throw new Error("contact upsert returned no row");
  return row;
}

export async function listContacts(opts: { kind?: string; text?: string } = {}): Promise<Contact[]> {
  return query<Contact>(
    `SELECT ${COLS} FROM contacts
     WHERE ($1::text IS NULL OR kind = $1)
       AND ($2::text IS NULL OR (name || ' ' || coalesce(offers,'') || ' ' || coalesce(notes,'') || ' ' || coalesce(location,'')) ILIKE '%' || $2 || '%')
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'contacted' THEN 1 WHEN 'new' THEN 2 ELSE 3 END, kind, name`,
    [opts.kind ?? null, opts.text ?? null],
  );
}

export async function setContactStatus(id: string, status: string): Promise<void> {
  await query(`UPDATE contacts SET status = $2, updated_at = now() WHERE id = $1`, [id, status]);
}
