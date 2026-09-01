import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pool } from "./index.js";
import { log } from "../log.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Applies db/schema.sql. Every statement is idempotent, so this runs on
 * every boot — a single-user project does not need migration bookkeeping.
 */
export async function migrate(): Promise<void> {
  // dist/db/migrate.js and src/db/migrate.ts both sit two levels under the root.
  const schemaPath = resolve(here, "../../db/schema.sql");
  const sql = await readFile(schemaPath, "utf8");
  await pool.query(sql);
  log.info("schema applied");
}
