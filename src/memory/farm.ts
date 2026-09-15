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
  sealed: number; open_g: number; total_g: number; threshold_g: number;
};

export async function filament(): Promise<Line[]> {
  const rows = await query<any>(
    `SELECT id, brand, material, color, quantity, spool_weight_g, threshold_g,
            coalesce((SELECT sum(x::numeric) FROM jsonb_array_elements_text(open_spools) x), 0) AS open_g
     FROM farm_filament ORDER BY material, color`);
  return rows.map((r) => ({
    id: r.id, brand: r.brand, material: r.material, color: r.color,
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
export type Costing = {
  product: string; my_price: number;
  est_hours: number; actual_hours: number | null; matched_jobs: number;
  units: number;
  filament_cost: number; power_cost_est: number; power_cost_actual: number | null;
  addon_cost: number; packaging_cost: number;
  unit_cost_est: number; unit_cost_actual: number | null;
  margin_est: number; margin_actual: number | null;
  wasted_pct: number;
};

export async function costing(name: string): Promise<Costing | null> {
  const g = await globals();
  const p = await one<any>(
    `SELECT * FROM farm_products WHERE name ILIKE '%' || $1 || '%'
     ORDER BY similarity(name, $1) DESC LIMIT 1`, [name]);
  if (!p) return null;

  const units = n(p.units_per_print) || 1;
  const estHours = n(p.days) * 24 + n(p.hours);

  // Most job names are the Bambu Studio *profile* ("0.2mm layer, 2 walls, 15%
  // infill"), not the model — his two vocabularies barely overlap. Excluding
  // the profile strings stops a product matching every job on the farm, and
  // matching in both directions catches "corn clicker" vs "Corn Clicker v2".
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
  const powerRate = g.printer_power_kw * g.electricity_price * (p.h2c ? g.h2c_multiplier : 1);
  const filament = (n(p.filament_g) / 1000) * g.filament_price;
  const addons = n(p.addon_parts_per_unit) * units * g.addon_part_cost;
  const packaging = units * g.packaging_cost;

  const build = (hours: number, failUplift: number) =>
    (filament + hours * powerRate + addons + packaging) * (1 + failUplift) / units;

  const unitEst = build(estHours, g.fail_rate);
  const unitAct = actualHours == null ? null : build(actualHours, f.wasted);

  return {
    product: p.name, my_price: n(p.my_price),
    est_hours: estHours, actual_hours: actualHours, matched_jobs: matched, units,
    filament_cost: filament,
    power_cost_est: estHours * powerRate,
    power_cost_actual: actualHours == null ? null : actualHours * powerRate,
    addon_cost: addons, packaging_cost: packaging,
    unit_cost_est: unitEst, unit_cost_actual: unitAct,
    margin_est: n(p.my_price) - unitEst,
    margin_actual: unitAct == null ? null : n(p.my_price) - unitAct,
    wasted_pct: f.wasted * 100,
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
