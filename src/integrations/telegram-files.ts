import type { Api } from "grammy";
import { config } from "../config.js";

/** Resolves a Telegram file id and downloads the bytes. */
export async function downloadFile(api: Api, fileId: string): Promise<Uint8Array> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error(`Telegram returned no file_path for ${fileId}`);

  const url = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Telegram file download failed (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
