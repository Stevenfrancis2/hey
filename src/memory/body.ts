import { query, one } from "../db/index.js";

export async function logBody(input: {
  kind: "workout" | "weight" | "meal" | "note";
  detail?: string | null;
  calories?: number | null;
  proteinG?: number | null;
  weightKg?: number | null;
  minutes?: number | null;
  on?: Date | null;
}): Promise<void> {
  await query(
    `INSERT INTO body_log (kind, detail, calories, protein_g, weight_kg, minutes, happened_on)
     VALUES ($1,$2,$3,$4,$5,$6,coalesce($7, current_date))`,
    [input.kind, input.detail ?? null, input.calories ?? null, input.proteinG ?? null,
     input.weightKg ?? null, input.minutes ?? null, input.on ?? null],
  );
}

export async function today(): Promise<{
  calories: number; protein: number; workouts: number; minutes: number;
}> {
  const row = await one<{ cal: string; pro: string; n: string; mins: string }>(
    `SELECT coalesce(sum(calories),0) cal, coalesce(sum(protein_g),0) pro,
            count(*) FILTER (WHERE kind='workout') n, coalesce(sum(minutes),0) mins
     FROM body_log WHERE happened_on = current_date`,
  );
  return {
    calories: Number(row?.cal ?? 0), protein: Number(row?.pro ?? 0),
    workouts: Number(row?.n ?? 0), minutes: Number(row?.mins ?? 0),
  };
}

export async function week(): Promise<{
  workouts: number; minutes: number; avgCalories: number; latestWeight: number | null;
}> {
  const row = await one<{ n: string; mins: string; avg: string; w: string | null }>(
    `SELECT count(*) FILTER (WHERE kind='workout') n,
            coalesce(sum(minutes),0) mins,
            coalesce(round(avg(daily.cal)),0) avg,
            (SELECT weight_kg FROM body_log WHERE weight_kg IS NOT NULL
             ORDER BY happened_on DESC LIMIT 1) w
     FROM body_log
     LEFT JOIN LATERAL (
       SELECT sum(calories) cal FROM body_log b2
       WHERE b2.happened_on = body_log.happened_on GROUP BY b2.happened_on
     ) daily ON true
     WHERE happened_on > current_date - 7`,
  );
  return {
    workouts: Number(row?.n ?? 0), minutes: Number(row?.mins ?? 0),
    avgCalories: Number(row?.avg ?? 0), latestWeight: row?.w ? Number(row.w) : null,
  };
}

export async function recentBody(limit = 20): Promise<
  { kind: string; happened_on: Date; detail: string | null; calories: number | null;
    protein_g: number | null; weight_kg: string | null; minutes: number | null }[]
> {
  return query(
    `SELECT kind, happened_on, detail, calories, protein_g, weight_kg, minutes
     FROM body_log ORDER BY happened_on DESC, created_at DESC LIMIT $1`,
    [limit],
  );
}
