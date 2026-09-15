import { query, one } from "../db/index.js";

/**
 * The print farm, imported from the Raspberry Pi manager.
 *
 * The Pi could say what ran and what is on the shelf. It could never say
 * whether a job made money, because it did not know what he charged or what he
 * actually paid for filament. Both of those live here, so this is where the
 * costing question finally gets an answer.
 *
 * Every number he set on the Pi is an ESTIMATE he typed. Every number in
 * farm_jobs actually happened. Keeping that distinction visible is the whole
 * value — an answer that blends them silently is worse than no answer.
 */

export type Globals = {
  filament_price: number;      // $/kg, a flat assumption across every material
  printer_power_kw: number;
  electricity_price: number;   // $/kWh — Lebanon generator pricing, so this bites
  h2c_multiplier: number;      // the H2C runs on solar, so it costs less to run
  addon_part_cost: number;
  packaging_cost: number;
  fail_rate: number;
  low_markup: number;
  mid_markup: number;
  high_markup: number;
};

export async function globals(): Promise<Globals> {
  const row = await one<{ values: Globals }>(`SELECT values FROM farm_globals WHERE id`);
  if (!row) throw new Error("farm globals missing — run the farm import");
  return row.values;
}

const n = (v: unknown): number => (v == null ? 0 : Number(v));

// ── Filament ──────────────────────────────────────────────
export type Line = {
  id: string; brand: string | null; material: string; color: string | null;
  color_hex: string | null;
  sealed: number; open_g: number; total_g: number; threshold_g: number;
};

export async function filament(): Promise<Line[]> {
  const rows = await query<any>(
    `SELECT id, brand, material, color, color_hex, quantity, spool_weight_g, threshold_g,
            coalesce((SELECT sum(x::numeric) FROM jsonb_array_elements_text(open_spools) x), 0) AS open_g
     FROM farm_filament ORDER BY material, color`);
  return rows.map((r) => ({
    id: r.id, brand: r.brand, material: r.material, color: r.color, color_hex: r.color_hex,
    sealed: n(r.quantity),
    open_g: n(r.open_g),
    total_g: n(r.quantity) * n(r.spool_weight_g) + n(r.open_g),
    threshold_g: n(r.threshold_g),
  }));
}

/**
 * Most lines have threshold_g = 0 because he never set one, so a pure threshold
 * check would report nothing is ever low. A line with no sealed spools is the
 * real signal: whatever is open is all that is left.
 */
export function low(lines: Line[], floorG = 400): Line[] {
  return lines
    .filter((l) => (l.threshold_g > 0 ? l.total_g <= l.threshold_g : l.sealed === 0 && l.total_g < floorG))
    .sort((a, b) => a.total_g - b.total_g);
}

// ── What actually ran ─────────────────────────────────────
export async function farmStatus(days = 30) {
  const totals = await one<any>(
    `SELECT count(*)::int AS jobs,
            count(*) FILTER (WHERE outcome='FAILED')::int AS failed,
            round(avg(percent_at_end) FILTER (WHERE outcome='FAILED'), 1) AS died_at_pct,
            round(avg(duration_s) FILTER (WHERE outcome='FINISH') / 3600.0, 2) AS avg_hours,
            max(end_ts) AS last_job
     FROM farm_jobs WHERE end_ts > now() - make_interval(days => $1::int)`, [days]);
  const printers = await query<any>(
    `SELECT printer_name,
            count(*)::int AS jobs,
            count(*) FILTER (WHERE outcome='FAILED')::int AS failed,
            round(avg(duration_s) FILTER (WHERE outcome='FINISH') / 3600.0, 2) AS avg_hours
     FROM farm_jobs WHERE end_ts > now() - make_interval(days => $1::int)
     GROUP BY printer_name ORDER BY failed DESC, printer_name`, [days]);
  return { totals, printers };
}

export async function failures(days = 30) {
  const g = await globals();
  const t = await one<any>(
    `SELECT count(*)::int AS jobs, count(*) FILTER (WHERE outcome='FAILED')::int AS failed,
            round(avg(percent_at_end) FILTER (WHERE outcome='FAILED'), 1) AS died_at_pct
     FROM farm_jobs WHERE end_ts > now() - make_interval(days => $1::int)`, [days]);
  const jobs = n(t?.jobs), failed = n(t?.failed), diedAt = n(t?.died_at_pct);
  const rate = jobs ? failed / jobs : 0;
  // A failed print does not waste a whole spool — it wastes whatever had been
  // laid down when it died. That is the number his pricing should carry.
  const wasted = rate * (diedAt / 100);
  const worst = await query<any>(
    `SELECT printer_name, count(*) FILTER (WHERE outcome='FAILED')::int AS failed, count(*)::int AS jobs
     FROM farm_jobs WHERE end_ts > now() - make_interval(days => $1::int)
     GROUP BY printer_name HAVING count(*) FILTER (WHERE outcome='FAILED') > 0
     ORDER BY 2 DESC LIMIT 3`, [days]);
  return { jobs, failed, rate, diedAt, wasted, assumed: g.fail_rate, worst };
}

// ── The crossing: estimate vs what happened ───────────────
export type Computed = {
  filament_cost: number; electricity_cost: number;
  base_cost_unit: number; total_cost_unit: number;
  price_2x: number; price_3x: number; price_4x: number;
  my_markup: number | null; profit_unit: number | null;
};

export type ProductInput = {
  name: string; h2c?: boolean; filament_g: number; days?: number; hours?: number;
  units_per_print: number; addon_parts_per_unit?: number; my_price?: number | null;
};

/**
 * His formula from pricing.py, deliberately unchanged — including that
 * packaging is added AFTER the failure uplift rather than inside it. It is his
 * business maths and the numbers on his price list came out of it; "improving"
 * it silently would make every figure disagree with the ones he has quoted.
 */
export function compute(p: ProductInput, g: Globals): Computed | null {
  const units = n(p.units_per_print);
  if (!units || p.filament_g == null) return null;

  const printHours = n(p.days) * 24 + n(p.hours);
  const filament = (n(p.filament_g) / 1000) * g.filament_price;
  const electricity =
    printHours * g.printer_power_kw * g.electricity_price * (p.h2c ? g.h2c_multiplier : 1);
  const base = (filament + electricity) / units + n(p.addon_parts_per_unit) * g.addon_part_cost;
  const total = base * (1 + g.fail_rate) + g.packaging_cost;
  const price = p.my_price == null ? 0 : n(p.my_price);

  return {
    filament_cost: filament, electricity_cost: electricity,
    base_cost_unit: base, total_cost_unit: total,
    price_2x: total * g.low_markup, price_3x: total * g.mid_markup, price_4x: total * g.high_markup,
    my_markup: price && total ? price / total : null,
    profit_unit: price ? price - total : null,
  };
}

export type Costing = {
  product: string; my_price: number; units: number;
  est_hours: number; actual_hours: number | null; matched_jobs: number;
  est: Computed; actual: Computed | null;
  wasted_pct: number; assumed_pct: number;
};

export async function costing(name: string): Promise<Costing | null> {
  const g = await globals();
  const p = await one<any>(
    `SELECT * FROM farm_products WHERE name ILIKE '%' || $1 || '%'
     ORDER BY similarity(name, $1) DESC LIMIT 1`, [name]);
  if (!p) return null;

  const input: ProductInput = {
    name: p.name, h2c: p.h2c, filament_g: n(p.filament_g), days: n(p.days), hours: n(p.hours),
    units_per_print: n(p.units_per_print), addon_parts_per_unit: n(p.addon_parts_per_unit),
    my_price: n(p.my_price),
  };
  const est = compute(input, g);
  if (!est) return null;

  // Most job names are the Bambu Studio *profile* ("0.2mm layer, 2 walls, 15%
  // infill"), not the model — his two vocabularies barely overlap. Excluding
  // the profile strings stops a product matching every job on the farm.
  const act = await one<any>(
    `SELECT count(*)::int AS matched, round(avg(duration_s)/3600.0, 2) AS hours
     FROM farm_jobs
     WHERE outcome='FINISH'
       AND job_name !~* '(layer|walls|infill|profile|plates|colors?)'
       AND (job_name ILIKE '%' || $1 || '%' OR $1 ILIKE '%' || job_name || '%'
            OR similarity(job_name, $1) > 0.45)`, [p.name]);
  const matched = n(act?.matched);
  const actualHours = matched > 0 ? n(act?.hours) : null;

  const f = await failures(3650);
  // The actual column swaps his two estimates for what the farm really did:
  // measured print time, and the failure waste the jobs table implies.
  const actual = actualHours == null
    ? null
    : compute({ ...input, days: 0, hours: actualHours }, { ...g, fail_rate: f.wasted });

  return {
    product: p.name, my_price: n(p.my_price), units: n(p.units_per_print),
    est_hours: n(p.days) * 24 + n(p.hours), actual_hours: actualHours, matched_jobs: matched,
    est, actual, wasted_pct: f.wasted * 100, assumed_pct: g.fail_rate * 100,
  };
}

/**
 * Job names that look like real models rather than slicer profiles. He has to
 * map these to products by hand once — nothing in the data connects them.
 */
export async function unmappedJobs(limit = 12) {
  return query<any>(
    `SELECT job_name, count(*)::int AS jobs, round(avg(duration_s)/3600.0, 2) AS avg_hours
     FROM farm_jobs
     WHERE outcome='FINISH' AND job_name IS NOT NULL
       AND job_name !~* '(layer|walls|infill|profile|plates|colors?)'
     GROUP BY job_name ORDER BY jobs DESC LIMIT $1`, [limit]);
}

export async function products(limit = 60) {
  return query<any>(
    `SELECT name, my_price, filament_g, units_per_print, h2c,
            (coalesce(days,0)*24 + coalesce(hours,0)) AS est_hours
     FROM farm_products ORDER BY name LIMIT $1`, [limit]);
}

// ── Mutations: he manages the farm, not the agent ─────────
export async function adjustSealed(id: string, delta: number): Promise<number> {
  const r = await one<{ quantity: number }>(
    `UPDATE farm_filament SET quantity = greatest(0, quantity + $2), updated_at = now()
     WHERE id = $1 RETURNING quantity`, [id, delta]);
  return r?.quantity ?? 0;
}

/** Opening a spool moves one sealed unit into the open list at full weight. */
export async function openSpool(id: string): Promise<void> {
  await query(
    `UPDATE farm_filament
     SET quantity = greatest(0, quantity - 1),
         open_spools = open_spools || to_jsonb(spool_weight_g),
         updated_at = now()
     WHERE id = $1 AND quantity > 0`, [id]);
}

export async function setOpenGrams(id: string, grams: number): Promise<void> {
  // One open spool per line is how he actually works; the array is kept for the
  // rare case he has two of the same colour on the go.
  await query(
    `UPDATE farm_filament
     SET open_spools = CASE WHEN $2::numeric <= 0 THEN '[]'::jsonb ELSE to_jsonb(ARRAY[$2::numeric]) END,
         updated_at = now()
     WHERE id = $1`, [id, grams]);
}

export async function setGlobals(patch: Partial<Globals>): Promise<Globals> {
  const g = await globals();
  const merged = { ...g, ...patch };
  await query(`UPDATE farm_globals SET values = $1 WHERE id`, [JSON.stringify(merged)]);
  return merged;
}

export async function saveProduct(p: ProductInput & { id?: string }): Promise<string> {
  const id = p.id ?? Math.random().toString(16).slice(2, 14);
  await query(
    `INSERT INTO farm_products (id, name, h2c, filament_g, days, hours, units_per_print,
                                addon_parts_per_unit, my_price)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, h2c=EXCLUDED.h2c,
       filament_g=EXCLUDED.filament_g, days=EXCLUDED.days, hours=EXCLUDED.hours,
       units_per_print=EXCLUDED.units_per_print,
       addon_parts_per_unit=EXCLUDED.addon_parts_per_unit, my_price=EXCLUDED.my_price,
       updated_at=now()`,
    [id, p.name, !!p.h2c, p.filament_g, p.days ?? 0, p.hours ?? 0, p.units_per_print,
     p.addon_parts_per_unit ?? 0, p.my_price ?? null]);
  return id;
}

export async function deleteProduct(id: string): Promise<void> {
  await query(`DELETE FROM farm_products WHERE id = $1`, [id]);
}

/** Every product with his formula already applied, for the price list. */
export async function priceList() {
  const g = await globals();
  const rows = await query<any>(`SELECT * FROM farm_products ORDER BY name`);
  return rows.map((p) => ({
    ...p,
    computed: compute({
      name: p.name, h2c: p.h2c, filament_g: n(p.filament_g), days: n(p.days), hours: n(p.hours),
      units_per_print: n(p.units_per_print), addon_parts_per_unit: n(p.addon_parts_per_unit),
      my_price: p.my_price == null ? null : n(p.my_price),
    }, g),
  }));
}
