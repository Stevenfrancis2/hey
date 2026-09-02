import { one, query } from "../db/index.js";

export type Gear = {
  id: string;
  kind: string;
  brand: string | null;
  model: string;
  nickname: string | null;
  quantity: number;
  status: string;
  specs: Record<string, unknown>;
  notes: string | null;
};

export async function listGear(kind?: string | null): Promise<Gear[]> {
  return query<Gear>(
    `SELECT id, kind, brand, model, nickname, quantity, status, specs, notes
     FROM gear
     WHERE status <> 'retired' AND ($1::text IS NULL OR kind = $1)
     ORDER BY kind, brand, model`,
    [kind ?? null],
  );
}

export async function addGear(input: {
  kind: string;
  model: string;
  brand?: string | null;
  quantity?: number;
  specs?: Record<string, unknown>;
  notes?: string | null;
}): Promise<Gear> {
  const row = await one<Gear>(
    `INSERT INTO gear (kind, brand, model, quantity, specs, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (kind, model) DO UPDATE SET
       brand    = coalesce(EXCLUDED.brand, gear.brand),
       quantity = EXCLUDED.quantity,
       specs    = gear.specs || EXCLUDED.specs,
       notes    = coalesce(EXCLUDED.notes, gear.notes),
       status   = 'active'
     RETURNING id, kind, brand, model, nickname, quantity, status, specs, notes`,
    [
      input.kind,
      input.brand ?? null,
      input.model,
      input.quantity ?? 1,
      JSON.stringify(input.specs ?? {}),
      input.notes ?? null,
    ],
  );
  if (!row) throw new Error("gear insert returned no row");
  return row;
}

export async function setGearStatus(modelFragment: string, status: string): Promise<Gear | null> {
  return one<Gear>(
    `UPDATE gear SET status = $2
     WHERE id = (SELECT id FROM gear WHERE model ILIKE '%' || $1 || '%'
                 ORDER BY similarity(model, $1) DESC LIMIT 1)
     RETURNING id, kind, brand, model, nickname, quantity, status, specs, notes`,
    [modelFragment, status],
  );
}
