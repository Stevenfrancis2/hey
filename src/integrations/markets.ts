import { log } from "../log.js";

/**
 * Price data and indicators computed from it.
 *
 * Deliberately not "read this chart screenshot". A model looking at a picture
 * of a chart invents levels that are not there; arithmetic on real candles
 * cannot. The model's job here is to interpret numbers it did not make up, and
 * to say what would change the picture — never what to buy.
 *
 * Binance's public REST endpoint needs no key and no account.
 */

const BINANCE = "https://api.binance.com/api/v3/klines";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export async function candles(symbol: string, interval: string, limit = 250): Promise<Candle[]> {
  const url = `${BINANCE}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status} for ${symbol} ${interval}`);
  const rows = (await res.json()) as (string | number)[][];
  return rows.map((r) => ({
    t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]),
    c: Number(r[4]), v: Number(r[5]),
  }));
}

const sma = (xs: number[], n: number): number | null =>
  xs.length < n ? null : xs.slice(-n).reduce((a, b) => a + b, 0) / n;

function ema(xs: number[], n: number): number | null {
  if (xs.length < n) return null;
  const k = 2 / (n + 1);
  let e = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (const x of xs.slice(n)) e = x * k + e * (1 - k);
  return e;
}

/** Wilder's RSI — the smoothing matters; a plain average gives a different number. */
function rsi(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Average true range, Wilder-smoothed. The volatility number that sizes a stop. */
function atr(cs: Candle[], n = 14): number | null {
  if (cs.length < n + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < cs.length; i++) {
    const p = cs[i - 1]!.c, c = cs[i]!;
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p), Math.abs(c.l - p)));
  }
  let a = trs.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (const tr of trs.slice(n)) a = (a * (n - 1) + tr) / n;
  return a;
}

export type Read = {
  symbol: string; interval: string;
  price: number; changePct: number;
  sma20: number | null; sma50: number | null; sma200: number | null;
  ema12: number | null; ema26: number | null;
  rsi14: number | null; atr14: number | null; atrPct: number | null;
  high: number; low: number; highDate: string; lowDate: string;
  aboveSma200: boolean | null; aboveSma50: boolean | null;
  volumeVsAvg: number | null;
  candles: number;
};

export async function read(symbol: string, interval: string, limit = 250): Promise<Read> {
  const cs = await candles(symbol, interval, limit);
  const closes = cs.map((c) => c.c);
  const price = closes.at(-1)!;
  const prev = closes.at(-2) ?? price;

  let hi = cs[0]!, lo = cs[0]!;
  for (const c of cs) { if (c.h > hi.h) hi = c; if (c.l < lo.l) lo = c; }

  const a = atr(cs);
  const recentVol = cs.slice(-1)[0]!.v;
  const avgVol = cs.slice(-30).reduce((x, c) => x + c.v, 0) / Math.min(30, cs.length);

  return {
    symbol, interval, price,
    changePct: ((price - prev) / prev) * 100,
    sma20: sma(closes, 20), sma50: sma(closes, 50), sma200: sma(closes, 200),
    ema12: ema(closes, 12), ema26: ema(closes, 26),
    rsi14: rsi(closes), atr14: a, atrPct: a == null ? null : (a / price) * 100,
    high: hi.h, low: lo.l,
    highDate: new Date(hi.t).toISOString().slice(0, 10),
    lowDate: new Date(lo.t).toISOString().slice(0, 10),
    aboveSma200: sma(closes, 200) == null ? null : price > sma(closes, 200)!,
    aboveSma50: sma(closes, 50) == null ? null : price > sma(closes, 50)!,
    volumeVsAvg: avgVol ? recentVol / avgVol : null,
    candles: cs.length,
  };
}

const n0 = (v: number | null, d = 0) => (v == null ? "—" : v.toFixed(d));

export function format(r: Read): string {
  const money = (v: number | null) => (v == null ? "—" : `$${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`);
  return [
    `${r.symbol} ${r.interval} — ${money(r.price)} (${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}% last candle)`,
    `Range over ${r.candles} candles: ${money(r.low)} (${r.lowDate}) to ${money(r.high)} (${r.highDate})`,
    `SMA20 ${money(r.sma20)} · SMA50 ${money(r.sma50)} · SMA200 ${money(r.sma200)}`,
    `Price is ${r.aboveSma50 ? "above" : "below"} the 50 and ${r.aboveSma200 ? "above" : "below"} the 200.`,
    `RSI14 ${n0(r.rsi14, 1)} · ATR14 ${money(r.atr14)} (${n0(r.atrPct, 2)}% of price)`,
    r.volumeVsAvg == null ? "" : `Last candle volume is ${r.volumeVsAvg.toFixed(2)}x the 30-candle average.`,
  ].filter(Boolean).join("\n");
}

export async function safeRead(symbol: string, interval: string, limit = 250): Promise<Read | null> {
  try {
    return await read(symbol, interval, limit);
  } catch (err) {
    log.warn({ err, symbol, interval }, "market read failed");
    return null;
  }
}
