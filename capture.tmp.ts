/**
 * Throwaway behaviour test of the write path. Run: npx tsx capture.tmp.ts
 * Drives synthetic Telegram updates through the real grammY handler chain and
 * asserts on what actually landed in Postgres.
 */
import type { Update } from "grammy/types";
import { pool, query } from "./src/db/index.js";
import { bot } from "./src/bot/index.js";

const OWNER = 7569157465;
const STRANGER = 111222333;

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n      expected ${expected}, got ${actual}`);
}

let updateId = 900000;
function textUpdate(fromId: number, text: string, extra: Record<string, unknown> = {}): Update {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: fromId, type: "private", first_name: "Steven" },
      from: { id: fromId, is_bot: false, first_name: "Steven" },
      text,
      ...extra,
    },
  } as unknown as Update;
}

async function main() {
  await query("DELETE FROM capture_enrichment");
  await query("DELETE FROM chunks");
  await query("DELETE FROM captures");

  await bot.init();

  // ── The owner's message is captured ──────────────────────
  await bot.handleUpdate(textUpdate(OWNER, "H2C jammed mid-print on the bee batch"));
  const mine = await query<{ kind: string; raw_text: string; status: string; chat_id: string }>(
    "SELECT kind, raw_text, status, chat_id FROM captures ORDER BY captured_at DESC",
  );
  check("owner message stored", mine.length, 1);
  check("text preserved verbatim", mine[0]?.raw_text, "H2C jammed mid-print on the bee batch");
  check("kind is text", mine[0]?.kind, "text");
  check("starts pending, for the worker", mine[0]?.status, "pending");
  check("chat id recorded", Number(mine[0]?.chat_id), OWNER);

  // ── Everyone else is silently ignored ────────────────────
  // This is the privacy guarantee: the finance room must not be reachable by
  // anyone who merely finds the bot's username.
  await bot.handleUpdate(textUpdate(STRANGER, "who are you"));
  const afterStranger = await query<{ n: string }>("SELECT count(*) AS n FROM captures");
  check("stranger's message not stored", Number(afterStranger[0]?.n), 1);

  // ── A forward is attributed to whoever said it ───────────
  await bot.handleUpdate(
    textUpdate(OWNER, "use 65 percent hydration and cold ferment it overnight", {
      forward_origin: {
        type: "user",
        date: Math.floor(Date.now() / 1000),
        sender_user: { id: 5, is_bot: false, first_name: "Papa" },
      },
    }),
  );
  const fwd = await query<{ author: string; kind: string }>(
    "SELECT author, kind FROM captures WHERE author IS NOT NULL",
  );
  check("forward attributed to the speaker", fwd[0]?.author, "Papa");
  check("forward recorded as a forward", fwd[0]?.kind, "forward");

  // ── A voice note captures its file id and duration ───────
  await bot.handleUpdate({
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: OWNER, type: "private", first_name: "Steven" },
      from: { id: OWNER, is_bot: false, first_name: "Steven" },
      voice: { file_id: "FAKE_VOICE_FILE_ID", file_unique_id: "u1", duration: 7, mime_type: "audio/ogg" },
    },
  } as unknown as Update);
  const voice = await query<{ media_file_id: string; duration_s: number; kind: string }>(
    "SELECT media_file_id, duration_s, kind FROM captures WHERE kind = 'voice'",
  );
  check("voice file id stored for later download", voice[0]?.media_file_id, "FAKE_VOICE_FILE_ID");
  check("voice duration stored", Number(voice[0]?.duration_s), 7);

  const total = await query<{ n: string }>("SELECT count(*) AS n FROM captures");
  check("three owner captures, zero stranger captures", Number(total[0]?.n), 3);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
