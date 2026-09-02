import { one, query } from "../db/index.js";
import { toMinor, money } from "./money.js";

export type Decision = {
  id: string; name: string; question: string; status: string; chosen: string | null;
};

export type Option = {
  id: string; name: string; summary: string | null; upside: string | null;
  downside: string | null; cost_minor: string | null; return_minor: string | null;
  currency: string; confidence: number | null;
};

export type Assumption = {
  id: string; claim: string; basis: string | null; confidence: number | null; checked_on: Date | null;
};

export async function findDecision(fragment?: string | null): Promise<Decision | null> {
  if (!fragment) {
    return one<Decision>(
      `SELECT id, name, question, status, chosen FROM decisions
       WHERE status = 'open' ORDER BY created_at LIMIT 1`,
    );
  }
  return one<Decision>(
    `SELECT id, name, question, status, chosen FROM decisions
     WHERE name ILIKE '%' || $1 || '%' ORDER BY similarity(name, $1) DESC LIMIT 1`,
    [fragment],
  );
}

export async function createDecision(input: {
  name: string; question: string; contextKey?: string | null;
}): Promise<Decision> {
  const row = await one<Decision>(
    `INSERT INTO decisions (name, question, context_id)
     VALUES ($1,$2,(SELECT id FROM contexts WHERE key = $3))
     ON CONFLICT (name) DO UPDATE SET question = EXCLUDED.question
     RETURNING id, name, question, status, chosen`,
    [input.name, input.question, input.contextKey ?? null],
  );
  if (!row) throw new Error("decision insert returned no row");
  return row;
}

export async function upsertOption(decisionId: string, input: {
  name: string; summary?: string | null; upside?: string | null; downside?: string | null;
  cost?: number | null; annualReturn?: number | null; currency?: string; confidence?: number | null;
}): Promise<void> {
  await query(
    `INSERT INTO decision_options
       (decision_id, name, summary, upside, downside, cost_minor, return_minor, currency, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (decision_id, name) DO UPDATE SET
       summary = coalesce(EXCLUDED.summary, decision_options.summary),
       upside = coalesce(EXCLUDED.upside, decision_options.upside),
       downside = coalesce(EXCLUDED.downside, decision_options.downside),
       cost_minor = coalesce(EXCLUDED.cost_minor, decision_options.cost_minor),
       return_minor = coalesce(EXCLUDED.return_minor, decision_options.return_minor),
       confidence = coalesce(EXCLUDED.confidence, decision_options.confidence)`,
    [decisionId, input.name, input.summary ?? null, input.upside ?? null, input.downside ?? null,
     input.cost != null ? toMinor(input.cost) : null,
     input.annualReturn != null ? toMinor(input.annualReturn) : null,
     input.currency ?? "USD", input.confidence ?? null],
  );
}

export async function addAssumption(decisionId: string, input: {
  claim: string; basis?: string | null; confidence?: number | null;
}): Promise<void> {
  await query(
    `INSERT INTO decision_assumptions (decision_id, claim, basis, confidence, checked_on)
     VALUES ($1,$2,$3,$4,current_date)
     ON CONFLICT (decision_id, claim) DO UPDATE SET
       basis = coalesce(EXCLUDED.basis, decision_assumptions.basis),
       confidence = coalesce(EXCLUDED.confidence, decision_assumptions.confidence),
       checked_on = current_date`,
    [decisionId, input.claim, input.basis ?? null, input.confidence ?? null],
  );
}

export async function listOptions(decisionId: string): Promise<Option[]> {
  return query<Option>(
    `SELECT id, name, summary, upside, downside, cost_minor, return_minor, currency, confidence
     FROM decision_options WHERE decision_id = $1 ORDER BY name`,
    [decisionId],
  );
}

export async function listAssumptions(decisionId: string): Promise<Assumption[]> {
  return query<Assumption>(
    `SELECT id, claim, basis, confidence, checked_on FROM decision_assumptions
     WHERE decision_id = $1 ORDER BY confidence NULLS FIRST, claim`,
    [decisionId],
  );
}

export async function listDecisions(): Promise<Decision[]> {
  return query<Decision>(
    `SELECT id, name, question, status, chosen FROM decisions
     ORDER BY (status = 'open') DESC, created_at DESC`,
  );
}

export async function decide(fragment: string, chosen: string): Promise<Decision | null> {
  return one<Decision>(
    `UPDATE decisions SET status = 'decided', chosen = $2, decided_on = current_date
     WHERE id = (SELECT id FROM decisions WHERE name ILIKE '%' || $1 || '%'
                 ORDER BY similarity(name, $1) DESC LIMIT 1)
     RETURNING id, name, question, status, chosen`,
    [fragment, chosen],
  );
}

/** Payback in years, only where both numbers exist. Never guesses one. */
export function payback(option: Option): string {
  if (!option.cost_minor || !option.return_minor || Number(option.return_minor) <= 0) {
    return "—";
  }
  const years = Number(option.cost_minor) / Number(option.return_minor);
  return `${years.toFixed(1)}y payback`;
}

export function optionLine(option: Option): string {
  const cost = option.cost_minor ? money(option.cost_minor, option.currency) : "cost unknown";
  const ret = option.return_minor ? `${money(option.return_minor, option.currency)}/yr` : "return unknown";
  return `${option.name}: ${cost} → ${ret} · ${payback(option)}` +
    `${option.confidence ? ` · confidence ${option.confidence}/5` : ""}`;
}
