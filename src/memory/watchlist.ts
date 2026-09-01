import { one, query } from "../db/index.js";

export type WatchItem = {
  id: string;
  kind: string;
  symbol: string | null;
  name: string;
  thesis: string | null;
};

export async function addToWatchlist(input: {
  kind: "stock" | "crypto" | "theme";
  name: string;
  symbol?: string | null;
  thesis?: string | null;
}): Promise<WatchItem> {
  const row = await one<WatchItem>(
    `INSERT INTO watchlist (kind, name, symbol, thesis)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (kind, name) DO UPDATE SET
       symbol = coalesce(EXCLUDED.symbol, watchlist.symbol),
       thesis = coalesce(EXCLUDED.thesis, watchlist.thesis),
       active = true
     RETURNING id, kind, symbol, name, thesis`,
    [input.kind, input.name, input.symbol ?? null, input.thesis ?? null],
  );
  if (!row) throw new Error("watchlist insert returned no row");
  return row;
}

export async function listWatchlist(): Promise<WatchItem[]> {
  return query<WatchItem>(
    `SELECT id, kind, symbol, name, thesis FROM watchlist
     WHERE active ORDER BY kind, name`,
  );
}

export async function removeFromWatchlist(nameFragment: string): Promise<WatchItem | null> {
  return one<WatchItem>(
    `UPDATE watchlist SET active = false
     WHERE id = (
       SELECT id FROM watchlist
       WHERE active AND (name ILIKE '%' || $1 || '%' OR symbol ILIKE '%' || $1 || '%')
       ORDER BY similarity(name, $1) DESC LIMIT 1
     )
     RETURNING id, kind, symbol, name, thesis`,
    [nameFragment],
  );
}
