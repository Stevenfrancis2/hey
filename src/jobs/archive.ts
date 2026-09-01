import type { Api } from "grammy";
import { InputFile } from "grammy";
import { buildMarkdown, buildJson } from "../archive/build.js";
import { query, one } from "../db/index.js";
import { log } from "../log.js";

/**
 * Delivers the archive over Telegram. No extra credentials, no bucket to
 * configure, and the files land somewhere he already has on every device.
 */
export async function runArchive(api: Api, chatId: number, announce = true): Promise<void> {
  const started = Date.now();
  const [markdown, json] = await Promise.all([buildMarkdown(), buildJson()]);

  const date = new Date().toISOString().slice(0, 10);
  const mdBytes = Buffer.from(markdown, "utf8");
  const jsonBytes = Buffer.from(json, "utf8");

  const counted = await one<{ n: string }>(`SELECT count(*) AS n FROM captures`);
  const captures = Number(counted?.n ?? 0);

  let delivered = false;
  try {
    await api.sendDocument(chatId, new InputFile(mdBytes, `second-steven-${date}.md`), {
      caption: announce
        ? `📦 Archive · ${captures} captures · ${(mdBytes.length / 1024).toFixed(0)} KB\n` +
          `Everything you've told me, in plain text. Opens anywhere, needs nothing.`
        : undefined,
    });
    await api.sendDocument(chatId, new InputFile(jsonBytes, `second-steven-${date}.json`), {
      caption: announce ? "Same data, machine-readable — for rebuilding from scratch." : undefined,
    });
    delivered = true;
  } catch (err) {
    log.error({ err }, "archive delivery failed");
  }

  await query(
    `INSERT INTO archive_runs (captures, bytes_md, bytes_json, delivered)
     VALUES ($1,$2,$3,$4)`,
    [captures, mdBytes.length, jsonBytes.length, delivered],
  );

  log.info(
    { captures, md: mdBytes.length, json: jsonBytes.length, delivered, ms: Date.now() - started },
    "archive run",
  );
}
