import type { Api } from "grammy";
import { query, one } from "../db/index.js";
import { log } from "../log.js";

/**
 * A spend guard built on what the app already records.
 *
 * His Anthropic account runs on prepaid credits with auto-reload off, so
 * running out is a hard stop: no classification, no replies, no reminders
 * firing with a sentence attached. Silently, mid-day. A provider-side cap would
 * do the same thing — which is why this warns instead of capping, and only ever
 * stops the research desk.
 *
 * The desk is the one real cost driver: ten topics a day, each with web search.
 * Capture, classification and replies are fractions of a cent and must keep
 * working even at the ceiling, because those are the parts he relies on.
 */

const KEY = "monthly_budget_usd";
const NOTIFIED = "budget_notified";
const DEFAULT_BUDGET = 25;

export async function budget(): Promise<number> {
  const row = await one<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [KEY]);
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BUDGET;
}

export async function setBudget(usd: number): Promise<void> {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, String(usd)]);
}

export async function spentThisMonth(): Promise<number> {
  const row = await one<{ total: string }>(
    `SELECT coalesce(sum(cost_usd), 0) AS total FROM llm_calls
     WHERE created_at >= date_trunc('month', now())`);
  return Number(row?.total ?? 0);
}

export type Status = { spent: number; budget: number; pct: number; overBudget: boolean };

export async function status(): Promise<Status> {
  const [spent, cap] = await Promise.all([spentThisMonth(), budget()]);
  return { spent, budget: cap, pct: cap ? (spent / cap) * 100 : 0, overBudget: spent >= cap };
}

/**
 * Warns once per threshold per month. Warning him five times about 80% is how a
 * warning becomes noise and then gets ignored at 100%.
 */
export async function warnIfNeeded(api: Api, chatId: number): Promise<void> {
  const s = await status();
  const crossed = s.pct >= 100 ? 100 : s.pct >= 80 ? 80 : s.pct >= 50 ? 50 : 0;
  if (crossed === 0) return;

  const month = new Date().toISOString().slice(0, 7);
  const mark = `${month}:${crossed}`;
  const seen = await one<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [NOTIFIED]);
  if (seen?.value === mark) return;

  await query(
    `INSERT INTO app_settings (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [NOTIFIED, mark]);

  const money = (v: number) => `$${v.toFixed(2)}`;
  const text = crossed === 100
    ? `You've used ${money(s.spent)} of your ${money(s.budget)} monthly budget.\n\n` +
      `I've paused the research desk — it's the expensive part. Capture, replies and ` +
      `reminders keep working; those cost fractions of a cent.\n\n` +
      `Say "raise my budget to 50" to carry on.`
    : `Heads up: ${money(s.spent)} of ${money(s.budget)} this month (${Math.round(s.pct)}%).`;

  await api.sendMessage(chatId, text).catch((err) => log.warn({ err }, "budget warning failed"));
}
