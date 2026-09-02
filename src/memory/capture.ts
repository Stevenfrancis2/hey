import { one, query } from "../db/index.js";

export type CaptureKind = "text" | "voice" | "photo" | "document" | "link" | "forward";

export type NewCapture = {
  telegramMessageId: number;
  chatId: number;
  kind: CaptureKind;
  rawText: string | null;
  mediaFileId?: string | null;
  mediaMime?: string | null;
  durationSeconds?: number | null;
  /** Who said it, when it was forwarded from someone else. */
  author?: string | null;
};

export type CaptureRow = {
  id: string;
  chat_id: string;
  telegram_message_id: string | null;
  kind: CaptureKind;
  raw_text: string | null;
  media_file_id: string | null;
  duration_s: number | null;
  author: string | null;
  status: string;
};

/** The write path. Deliberately one INSERT — nothing here may be slow. */
export async function recordCapture(input: NewCapture): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO captures
       (telegram_message_id, chat_id, kind, raw_text, media_file_id, media_mime, duration_s, author)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.telegramMessageId,
      input.chatId,
      input.kind,
      input.rawText,
      input.mediaFileId ?? null,
      input.mediaMime ?? null,
      input.durationSeconds ?? null,
      input.author ?? null,
    ],
  );
  if (!row) throw new Error("capture insert returned no row");
  return row.id;
}

export async function getCapture(id: string): Promise<CaptureRow | null> {
  return one<CaptureRow>(
    `SELECT id, chat_id, telegram_message_id, kind, raw_text, media_file_id, duration_s, author, status
     FROM captures WHERE id = $1`,
    [id],
  );
}

export async function setCaptureText(id: string, text: string): Promise<void> {
  await query(`UPDATE captures SET raw_text = $2 WHERE id = $1`, [id, text]);
}

export async function markEnriched(id: string): Promise<void> {
  await query(
    `UPDATE captures SET status = 'enriched', processed_at = now(), error = NULL WHERE id = $1`,
    [id],
  );
}

export async function markFailed(id: string, error: string): Promise<void> {
  await query(
    `UPDATE captures SET status = 'failed', processed_at = now(), error = $2 WHERE id = $1`,
    [id, error.slice(0, 2000)],
  );
}

export async function stats(): Promise<{
  captures: number;
  chunks: number;
  pending: number;
  voice: number;
  oldest: Date | null;
}> {
  const row = await one<{
    captures: string;
    chunks: string;
    pending: string;
    voice: string;
    oldest: Date | null;
  }>(
    `SELECT
       (SELECT count(*) FROM captures)                              AS captures,
       (SELECT count(*) FROM chunks)                                AS chunks,
       (SELECT count(*) FROM captures WHERE status = 'pending')     AS pending,
       (SELECT count(*) FROM captures WHERE kind = 'voice')         AS voice,
       (SELECT min(captured_at) FROM captures)                      AS oldest`,
  );
  return {
    captures: Number(row?.captures ?? 0),
    chunks: Number(row?.chunks ?? 0),
    pending: Number(row?.pending ?? 0),
    voice: Number(row?.voice ?? 0),
    oldest: row?.oldest ?? null,
  };
}
