import { query, one } from "../db/index.js";
import { toMinor, fromMinor } from "./money.js";
import { safeRead } from "../integrations/markets.js";
import { log } from "../log.js";

/**
 * What he owns, and what it is worth right now.
 *
 * The ledger already answers "what moved". This answers "what do I have", which
 * is the question he actually asks, and the one the console had no way to show.
 *
 * Crypto and stocks store a quantity, never a value. A dollar figure he typed
 * last month is simply wrong by this month, and a net worth built out of stale
 * numbers is worse than no net worth — he would make decisions on it.
 */

export type Holding = {
  id: string; kind: string; name: string; symbol: string | null;
  quantity: string | null; amount_minor: string | null; currency: string;
  note: string | null; updated_at: Date;
};

export type Valued = Holding & {
  /** USD value if it could be priced, else null. */
  usd: number | null;
  /** Live unit price used, for crypto and stocks. */
  price: number | null;
  stale: boolean;
};

export async function list(): Promise<Holding[]> {
  return query<Holding>(`SELECT * FROM holdings ORDER BY kind, name`);
}

export async function upsert(input: {
  kind: string; name: string; symbol?: string | null;
  quantity?: number | null; amount?: number | null; currency?: string;
  note?: string | null; contextKey?: string | null;
}): Promise<Holding> {
  const row = await one<Holding>(
    `INSERT INTO holdings (kind, name, symbol, quantity, amount_minor, currency, note, context_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT id FROM contexts WHERE key = $8))
     ON CONFLICT (kind, name) DO UPDATE SET
       symbol = COALESCE(EXCLUDED.symbol, holdings.symbol),
       quantity = COALESCE(EXCLUDED.quantity, holdings.quantity),
       amount_minor = COALESCE(EXCLUDED.amount_minor, holdings.amount_minor),
       currency = EXCLUDED.currency,
       note = COALESCE(EXCLUDED.note, holdings.note),
       context_id = COALESCE(EXCLUDED.context_id, holdings.context_id),
       updated_at = now()
     RETURNING *`,
    [input.kind, input.name, input.symbol ?? null,
     input.quantity ?? null,
     input.amount == null ? null : toMinor(input.amount),
     input.currency ?? "USD", input.note ?? null, input.contextKey ?? null]);
  return row!;
}

export async function remove(name: string): Promise<boolean> {
  const r = await query(`DELETE FROM holdings WHERE name ILIKE '%' || $1 || '%' RETURNING id`, [name]);
  return r.length > 0;
}

/** Anything he has not touched in a month is probably out of date. */
const STALE_DAYS = 30;

export async function valued(): Promise<Valued[]> {
  const rows = await list();
  const symbols = [...new Set(rows.filter((r) => r.symbol).map((r) => r.symbol!.toUpperCase()))];

  const prices = new Map<string, number>();
  await Promise.all(symbols.map(async (sym) => {
    // USDT and USDC are dollars; asking Binance for USDTUSDT returns nothing.
    if (["USDT", "USDC", "USD", "DAI"].includes(sym)) { prices.set(sym, 1); return; }
    const r = await safeRead(`${sym}USDT`, "1d", 2);
    if (r) prices.set(sym, r.price);
    else log.warn({ sym }, "no price for holding");
  }));

  return rows.map((h) => {
    const ageDays = (Date.now() - new Date(h.updated_at).getTime()) / 864e5;
    const stale = ageDays > STALE_DAYS;

    if (h.symbol && h.quantity != null) {
      const p = prices.get(h.symbol.toUpperCase()) ?? null;
      return { ...h, price: p, usd: p == null ? null : Number(h.quantity) * p, stale };
    }
    if (h.amount_minor != null) {
      // Only dollars are summed. Converting Lebanese pounds at a rate nobody
      // agrees on would produce a confident, wrong number.
      const v = fromMinor(h.amount_minor);
      return { ...h, price: null, usd: h.currency === "USD" ? v : null, stale };
    }
    return { ...h, price: null, usd: null, stale };
  });
}

export type NetWorth = {
  totalUsd: number;
  byKind: { kind: string; usd: number }[];
  other: { currency: string; amount: number }[];
  unpriced: string[];
  stale: string[];
  holdings: Valued[];
};

export async function netWorth(): Promise<NetWorth> {
  const hs = await valued();

  let total = 0;
  const kinds = new Map<string, number>();
  const others = new Map<string, number>();
  const unpriced: string[] = [];
  const stale: string[] = [];

  for (const h of hs) {
    if (h.stale) stale.push(h.name);
    if (h.usd != null) {
      total += h.usd;
      kinds.set(h.kind, (kinds.get(h.kind) ?? 0) + h.usd);
    } else if (h.amount_minor != null) {
      others.set(h.currency, (others.get(h.currency) ?? 0) + fromMinor(h.amount_minor));
    } else {
      unpriced.push(h.name);
    }
  }

  return {
    totalUsd: total,
    byKind: [...kinds.entries()].map(([kind, usd]) => ({ kind, usd })).sort((a, b) => b.usd - a.usd),
    other: [...others.entries()].map(([currency, amount]) => ({ currency, amount })),
    unpriced, stale, holdings: hs,
  };
}
