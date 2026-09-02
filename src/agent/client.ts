import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { query } from "../db/index.js";
import { log } from "../log.js";

export const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

/** Per-million-token rates, so /costs reports real money rather than tokens. */
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

/**
 * The three input counters are disjoint, not nested: `input_tokens` already
 * excludes anything served from or written to cache. Subtracting the cache read
 * from it — which this used to do — double-counted the discount and reported a
 * bill smaller than the real one. Total input = input + cache_read + cache_write.
 */
export async function recordUsage(
  route: string,
  model: string,
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
  latencyMs: number,
): Promise<void> {
  const rate = PRICING[model] ?? { in: 5, out: 25 };
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const fresh = usage.input_tokens ?? 0;

  // Cache reads bill at a tenth of the input rate; writes at 1.25x.
  const cost =
    (fresh * rate.in +
      cacheRead * rate.in * 0.1 +
      cacheWrite * rate.in * 1.25 +
      (usage.output_tokens ?? 0) * rate.out) /
    1_000_000;

  await query(
    `INSERT INTO llm_calls (route, model, tokens_in, tokens_out, cache_read, cache_write, cost_usd, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [route, model, fresh, usage.output_tokens ?? 0, cacheRead, cacheWrite, cost, latencyMs],
  ).catch((err) => log.warn({ err }, "could not record usage"));
}

export async function costSummary(): Promise<{
  today: number;
  month: number;
  calls: number;
  cacheRead: number;
  cacheWrite: number;
  freshIn: number;
}> {
  const rows = await query<{
    today: string;
    month: string;
    calls: string;
    cache_read: string;
    cache_write: string;
    fresh_in: string;
  }>(
    `SELECT
       coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0)   AS today,
       coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS month,
       count(*) FILTER (WHERE created_at >= date_trunc('day', now()))                     AS calls,
       coalesce(sum(cache_read)  FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS cache_read,
       coalesce(sum(cache_write) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS cache_write,
       coalesce(sum(tokens_in)   FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS fresh_in
     FROM llm_calls`,
  );
  const row = rows[0];
  return {
    today: Number(row?.today ?? 0),
    month: Number(row?.month ?? 0),
    calls: Number(row?.calls ?? 0),
    cacheRead: Number(row?.cache_read ?? 0),
    cacheWrite: Number(row?.cache_write ?? 0),
    freshIn: Number(row?.fresh_in ?? 0),
  };
}
