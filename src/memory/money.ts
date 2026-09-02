import { one, query } from "../db/index.js";

/**
 * Money is stored in minor units as bigint. Floating point must never touch it:
 * 0.1 + 0.2 is not 0.3, and a rounding error in a ledger is a bug you find months
 * later when nothing reconciles.
 */
export function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

export function fromMinor(minor: number | string): number {
  return Number(minor) / 100;
}

export function money(minor: number | string, currency = "USD"): string {
  const value = fromMinor(minor);
  const formatted = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? "-" : ""}${currency === "USD" ? "$" : ""}${formatted}${
    currency === "USD" ? "" : ` ${currency}`
  }`;
}

export type Entry = {
  id: string;
  direction: "in" | "out";
  amount_minor: string;
  currency: string;
  counterparty: string | null;
  category: string | null;
  note: string | null;
  occurred_on: Date;
  settled: boolean;
  due_on: Date | null;
  context_key: string | null;
};

export async function record(input: {
  direction: "in" | "out";
  amount: number;
  currency?: string;
  contextKey?: string | null;
  counterparty?: string | null;
  category?: string | null;
  note?: string | null;
  occurredOn?: Date | null;
  settled?: boolean;
  dueOn?: Date | null;
  captureId?: string | null;
}): Promise<Entry> {
  const row = await one<Entry>(
    `INSERT INTO ledger
       (direction, amount_minor, currency, context_id, counterparty, category, note,
        occurred_on, settled, due_on, capture_id)
     VALUES ($1,$2,$3,(SELECT id FROM contexts WHERE key = $4),$5,$6,$7,
             coalesce($8, current_date),$9,$10,$11)
     RETURNING id, direction, amount_minor, currency, counterparty, category, note,
               occurred_on, settled, due_on,
               (SELECT key FROM contexts WHERE id = context_id) AS context_key`,
    [
      input.direction,
      toMinor(input.amount),
      input.currency ?? "USD",
      input.contextKey ?? null,
      input.counterparty ?? null,
      input.category ?? null,
      input.note ?? null,
      input.occurredOn ?? null,
      input.settled ?? true,
      input.dueOn ?? null,
      input.captureId ?? null,
    ],
  );
  if (!row) throw new Error("ledger insert returned no row");
  return row;
}

export type Summary = {
  context_key: string | null;
  currency: string;
  in_minor: string;
  out_minor: string;
  net_minor: string;
};

/** Never sums across currencies — that would silently invent a number. */
export async function summary(opts: { days?: number; contextKey?: string | null } = {}): Promise<Summary[]> {
  return query<Summary>(
    `SELECT c.key AS context_key, l.currency,
            coalesce(sum(l.amount_minor) FILTER (WHERE l.direction = 'in'), 0)  AS in_minor,
            coalesce(sum(l.amount_minor) FILTER (WHERE l.direction = 'out'), 0) AS out_minor,
            coalesce(sum(l.amount_minor) FILTER (WHERE l.direction = 'in'), 0)
              - coalesce(sum(l.amount_minor) FILTER (WHERE l.direction = 'out'), 0) AS net_minor
     FROM ledger l LEFT JOIN contexts c ON c.id = l.context_id
     WHERE l.settled
       AND ($1::int IS NULL OR l.occurred_on >= current_date - make_interval(days => $1::int))
       AND ($2::text IS NULL OR c.key = $2)
     GROUP BY c.key, l.currency
     ORDER BY net_minor DESC`,
    [opts.days ?? null, opts.contextKey ?? null],
  );
}

export async function outstanding(): Promise<Entry[]> {
  return query<Entry>(
    `SELECT l.id, l.direction, l.amount_minor, l.currency, l.counterparty, l.category,
            l.note, l.occurred_on, l.settled, l.due_on, c.key AS context_key
     FROM ledger l LEFT JOIN contexts c ON c.id = l.context_id
     WHERE NOT l.settled ORDER BY l.due_on NULLS LAST, l.occurred_on`,
  );
}

export async function settle(fragment: string): Promise<Entry | null> {
  return one<Entry>(
    `UPDATE ledger SET settled = true
     WHERE id = (
       SELECT id FROM ledger
       WHERE NOT settled AND (counterparty ILIKE '%' || $1 || '%' OR note ILIKE '%' || $1 || '%')
       ORDER BY due_on NULLS LAST LIMIT 1
     )
     RETURNING id, direction, amount_minor, currency, counterparty, category, note,
               occurred_on, settled, due_on,
               (SELECT key FROM contexts WHERE id = context_id) AS context_key`,
    [fragment],
  );
}

export async function recentEntries(limit = 20): Promise<Entry[]> {
  return query<Entry>(
    `SELECT l.id, l.direction, l.amount_minor, l.currency, l.counterparty, l.category,
            l.note, l.occurred_on, l.settled, l.due_on, c.key AS context_key
     FROM ledger l LEFT JOIN contexts c ON c.id = l.context_id
     ORDER BY l.occurred_on DESC, l.created_at DESC LIMIT $1`,
    [limit],
  );
}

export async function addBill(input: {
  name: string; amount: number; currency?: string; dayOfMonth?: number; contextKey?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO bills (name, amount_minor, currency, day_of_month, context_id)
     VALUES ($1,$2,$3,$4,(SELECT id FROM contexts WHERE key = $5))
     ON CONFLICT (name) DO UPDATE SET
       amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency,
       day_of_month = EXCLUDED.day_of_month, active = true`,
    [input.name, toMinor(input.amount), input.currency ?? "USD", input.dayOfMonth ?? 1, input.contextKey ?? null],
  );
}

export async function listBills(): Promise<
  { name: string; amount_minor: string; currency: string; day_of_month: number }[]
> {
  return query(`SELECT name, amount_minor, currency, day_of_month FROM bills WHERE active ORDER BY day_of_month`);
}

/**
 * Answers "can I buy this?" against real numbers rather than a feeling:
 * settled cash, minus what is committed out, plus only what is actually owed to him.
 */
export async function affordability(currency = "USD"): Promise<{
  cashMinor: number;
  owedToHimMinor: number;
  owedByHimMinor: number;
  monthlyBillsMinor: number;
  freeMinor: number;
}> {
  const row = await one<{
    cash: string; owed_in: string; owed_out: string; bills: string;
  }>(
    `SELECT
      (SELECT coalesce(sum(CASE WHEN direction='in' THEN amount_minor ELSE -amount_minor END),0)
       FROM ledger WHERE settled AND currency = $1)                                   AS cash,
      (SELECT coalesce(sum(amount_minor),0) FROM ledger
       WHERE NOT settled AND direction='in'  AND currency = $1)                        AS owed_in,
      (SELECT coalesce(sum(amount_minor),0) FROM ledger
       WHERE NOT settled AND direction='out' AND currency = $1)                        AS owed_out,
      (SELECT coalesce(sum(amount_minor),0) FROM bills WHERE active AND currency = $1) AS bills`,
    [currency],
  );

  const cash = Number(row?.cash ?? 0);
  const owedToHim = Number(row?.owed_in ?? 0);
  const owedByHim = Number(row?.owed_out ?? 0);
  const bills = Number(row?.bills ?? 0);

  return {
    cashMinor: cash,
    owedToHimMinor: owedToHim,
    owedByHimMinor: owedByHim,
    monthlyBillsMinor: bills,
    // Deliberately excludes money owed to him: it is not his until it lands.
    freeMinor: cash - owedByHim - bills,
  };
}
