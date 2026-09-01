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

export async function recordUsage(
  route: string,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null },
  latencyMs: number,
): Promise<void> {
  const rate = PRICING[model] ?? { in: 5, out: 25 };
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const fresh = Math.max(0, (usage.input_tokens ?? 0) - cacheRead);
  // Cache reads bill at roughly a tenth of the input rate.
  const cost = (fresh * rate.in + cacheRead * rate.in * 0.1 + (usage.output_tokens ?? 0) * rate.out) / 1_000_000;

  await query(
    `INSERT INTO llm_calls (route, model, tokens_in, tokens_out, cache_read, cost_usd, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [route, model, usage.input_tokens ?? 0, usage.output_tokens ?? 0, cacheRead, cost, latencyMs],
  ).catch((err) => log.warn({ err }, "could not record usage"));
}

export async function costSummary(): Promise<{ today: number; month: number; calls: number }> {
  const rows = await query<{ today: string; month: string; calls: string }>(
    `SELECT
       coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('day', now())), 0)   AS today,
       coalesce(sum(cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS month,
       count(*) FILTER (WHERE created_at >= date_trunc('day', now()))                     AS calls
     FROM llm_calls`,
  );
  const row = rows[0];
  return {
    today: Number(row?.today ?? 0),
    month: Number(row?.month ?? 0),
    calls: Number(row?.calls ?? 0),
  };
}
