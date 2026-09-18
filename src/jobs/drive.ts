import { query, one } from "../db/index.js";
import { config } from "../config.js";
import { log } from "../log.js";
import { listDriveFiles, readDriveFile, isConfigured, findFolders, type DriveFile } from "../integrations/google.js";
import { recordCapture } from "../memory/capture.js";
import { indexCapture } from "../memory/index.js";

/**
 * Pulls new and changed Drive files into the same memory as everything else, so
 * a spec sheet dropped in a folder is findable from a voice note. Only does work
 * for files whose modifiedTime moved, so a nightly run is cheap.
 */
export async function syncDrive(limit = 40): Promise<{ scanned: number; indexed: number }> {
  if (!isConfigured()) return { scanned: 0, indexed: 0 };

  // Never his whole Drive — that is how Google's own applet_access_history.json
  // ended up in his second brain. Only folders he made for this: "Second Steven"
  // for anything, "BLF" for the bank project, which he shares with his partner
  // so either of them can drop something in and both can ask about it.
  let folders: Folder[];
  try {
    folders = await watchedFolders();
  } catch (err) {
    log.warn({ err }, "drive sync skipped");
    return { scanned: 0, indexed: 0 };
  }
  if (folders.length === 0) {
    log.info("drive sync skipped — no 'Second Steven' or 'BLF' folder in Drive yet");
    return { scanned: 0, indexed: 0 };
  }
  const roomOf = new Map(folders.map((f) => [f.id, f.room]));

  const watermark = await one<{ latest: Date | null }>(
    `SELECT max(modified_time) AS latest FROM drive_files`,
  );

  let files: (DriveFile & { parents?: string[] })[];
  try {
    files = await listDriveFiles({
      since: watermark?.latest ?? null,
      folderIds: folders.map((f) => f.id),
      limit,
    });
  } catch (err) {
    log.warn({ err }, "drive sync skipped");
    return { scanned: 0, indexed: 0 };
  }

  let indexed = 0;

  for (const file of files) {
    const existing = await one<{ modified_time: Date | null }>(
      `SELECT modified_time FROM drive_files WHERE id = $1`,
      [file.id],
    );
    if (existing?.modified_time &&
        new Date(existing.modified_time).getTime() >= new Date(file.modifiedTime).getTime()) {
      continue;
    }

    try {
      const text = await readDriveFile(file);

      // Even a file we cannot read as text gets a row, so its name and link are
      // searchable and it is not re-fetched on every run.
      if (text && text.trim().length > 0) {
        const captureId = await recordCapture({
          telegramMessageId: 0,
          chatId: config.telegram.ownerId,
          kind: "document",
          rawText: `${file.name}\n\n${text}`,
          author: "Google Drive",
        });
        await indexCapture(captureId, `${file.name}\n\n${text}`);
        await query(
          `UPDATE captures SET status = 'enriched', processed_at = now() WHERE id = $1`,
          [captureId],
        );
        const room = file.parents?.map((p) => roomOf.get(p)).find(Boolean) ?? null;
        if (room) {
          await query(
            `INSERT INTO capture_enrichment (capture_id, context_id, intent, summary, urgency, tags, model)
             VALUES ($1, (SELECT id FROM contexts WHERE key = $2), 'log', $3, 0, $4, 'drive')
             ON CONFLICT (capture_id) DO NOTHING`,
            [captureId, room, `Drive: ${file.name}`, ["drive"]],
          );
        }
        await query(
          `INSERT INTO drive_files (id, name, mime_type, modified_time, web_link, capture_id)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name, modified_time = EXCLUDED.modified_time,
             web_link = EXCLUDED.web_link, capture_id = EXCLUDED.capture_id,
             indexed_at = now(), error = NULL`,
          [file.id, file.name, file.mimeType, file.modifiedTime, file.webViewLink ?? null, captureId],
        );
        indexed += 1;
      } else {
        await query(
          `INSERT INTO drive_files (id, name, mime_type, modified_time, web_link)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name, modified_time = EXCLUDED.modified_time, indexed_at = now()`,
          [file.id, file.name, file.mimeType, file.modifiedTime, file.webViewLink ?? null],
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ err, file: file.name }, "drive file failed");
      await query(
        `INSERT INTO drive_files (id, name, mime_type, modified_time, error)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET error = EXCLUDED.error, indexed_at = now()`,
        [file.id, file.name, file.mimeType, file.modifiedTime, message.slice(0, 500)],
      );
    }
  }

  log.info({ scanned: files.length, indexed }, "drive sync");
  return { scanned: files.length, indexed };
}

type Folder = { id: string; room: string | null };

const FOLDER_ROOMS: [string, string | null][] = [
  ["Second Steven", null],
  ["BLF", "bank_ai"],
];

export async function watchedFolders(): Promise<Folder[]> {
  const out: Folder[] = [];
  if (config.google.driveFolderId) out.push({ id: config.google.driveFolderId, room: null });
  for (const [name, room] of FOLDER_ROOMS) {
    for (const f of await findFolders(name)) {
      if (!out.some((o) => o.id === f.id)) out.push({ id: f.id, room });
    }
  }
  return out;
}
