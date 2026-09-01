import pg from "pg";

// Read the URL directly rather than through config, so `npm run migrate`
// works without every other credential being present.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Missing required environment variable: DATABASE_URL");

export const pool = new pg.Pool({
  connectionString,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** pgvector accepts a bracketed literal; the column cast happens in the SQL. */
export function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}
