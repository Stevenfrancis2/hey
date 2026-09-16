import type { Api } from "grammy";
import { InputFile } from "grammy";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { query, one } from "../db/index.js";
import { log } from "../log.js";

/**
 * He named this thing Jarvis, so a greeting gets Jarvis's voice back.
 *
 * The file is uploaded to Telegram exactly once. Telegram then hands back a
 * file_id that can be re-sent forever, which is why this costs nothing on every
 * greeting after the first — no generation, no re-upload, no bandwidth.
 */

const FILE = new URL("../../assets/jarvis.mp3", import.meta.url);
// grammY's InputFile treats a URL as something to fetch over the network, and a
// file:// URL is "not an absolute URL" to it. It wants a filesystem path.
const PATH = fileURLToPath(FILE);
const KEY = "jarvis_voice_file_id";

/**
 * Deliberately narrow. This fires on him opening a conversation and nothing
 * else — "hey, did the red PLA arrive" is a question with an answer, and
 * playing a sound over it would be noise. Anchored, few words, no question mark.
 */
const GREETING =
  /^\s*(hey|hi|hello|yo|hola|sup|wassup|what'?s up|good (morning|evening|afternoon)|salut|marhaba|ahlan)\b[\s,!.]*(jarvis|sven|second steven|mate|bro|man)?[\s,!.?]*$/i;

export function isGreeting(text: string): boolean {
  return text.trim().length <= 40 && GREETING.test(text);
}

async function cachedFileId(): Promise<string | null> {
  const row = await one<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [KEY]);
  return row?.value ?? null;
}

export async function sendJarvisVoice(api: Api, chatId: number): Promise<void> {
  try {
    const cached = await cachedFileId();
    const sent = await api.sendVoice(chatId, cached ?? new InputFile(PATH));

    // Only the first send produces a new file_id worth keeping.
    const id = sent.voice?.file_id;
    if (!cached && id) {
      await query(
        `INSERT INTO app_settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [KEY, id],
      );
      log.info({ fileId: id }, "jarvis voice uploaded and cached");
    }
  } catch (err) {
    // A greeting that does not play is a disappointment, not a failure. The
    // text reply still has to go out.
    log.warn({ err }, "jarvis voice failed");
  }
}

export async function jarvisAudioBytes(): Promise<Buffer> {
  return readFile(FILE);
}
