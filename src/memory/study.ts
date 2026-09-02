import { one, query } from "../db/index.js";

export type Goal = {
  id: string;
  name: string;
  deadline: Date | null;
  hours_per_day: string;
  status: string;
};

export type Topic = {
  id: string;
  name: string;
  detail: string | null;
  position: number;
  est_hours: string;
  status: string;
  confidence: number | null;
};

export type Card = {
  id: string;
  question: string;
  answer: string;
  ease: string;
  interval_days: number;
  reps: number;
  topic_name?: string | null;
};

export async function createGoal(input: {
  name: string;
  deadline?: Date | null;
  hoursPerDay?: number;
  contextKey?: string | null;
}): Promise<Goal> {
  const row = await one<Goal>(
    `INSERT INTO study_goals (name, deadline, hours_per_day, context_id)
     VALUES ($1,$2,$3,(SELECT id FROM contexts WHERE key = $4))
     ON CONFLICT (name) DO UPDATE SET
       deadline = coalesce(EXCLUDED.deadline, study_goals.deadline),
       hours_per_day = EXCLUDED.hours_per_day, status = 'active'
     RETURNING id, name, deadline, hours_per_day, status`,
    [input.name, input.deadline ?? null, input.hoursPerDay ?? 2, input.contextKey ?? null],
  );
  if (!row) throw new Error("goal insert returned no row");
  return row;
}

export async function findGoal(fragment?: string | null): Promise<Goal | null> {
  if (!fragment) {
    return one<Goal>(
      `SELECT id, name, deadline, hours_per_day, status FROM study_goals
       WHERE status = 'active' ORDER BY deadline NULLS LAST, created_at LIMIT 1`,
    );
  }
  return one<Goal>(
    `SELECT id, name, deadline, hours_per_day, status FROM study_goals
     WHERE name ILIKE '%' || $1 || '%'
     ORDER BY similarity(name, $1) DESC LIMIT 1`,
    [fragment],
  );
}

/** Replaces the topic list wholesale — a re-plan should not leave orphans behind. */
export async function setTopics(
  goalId: string,
  topics: { name: string; detail?: string; est_hours?: number }[],
): Promise<number> {
  await query(`DELETE FROM study_topics WHERE goal_id = $1 AND status = 'todo'`, [goalId]);
  let position = 0;
  for (const topic of topics) {
    position += 1;
    await query(
      `INSERT INTO study_topics (goal_id, name, detail, position, est_hours)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (goal_id, name) DO UPDATE SET
         detail = coalesce(EXCLUDED.detail, study_topics.detail),
         position = EXCLUDED.position, est_hours = EXCLUDED.est_hours`,
      [goalId, topic.name, topic.detail ?? null, position, topic.est_hours ?? 1],
    );
  }
  return position;
}

export async function listTopics(goalId: string): Promise<Topic[]> {
  return query<Topic>(
    `SELECT id, name, detail, position, est_hours, status, confidence
     FROM study_topics WHERE goal_id = $1 ORDER BY position`,
    [goalId],
  );
}

export async function completeTopic(
  goalId: string,
  fragment: string,
  confidence?: number,
): Promise<Topic | null> {
  return one<Topic>(
    `UPDATE study_topics SET status = 'done', done_at = now(), confidence = coalesce($3, confidence)
     WHERE id = (SELECT id FROM study_topics WHERE goal_id = $1 AND name ILIKE '%' || $2 || '%'
                 ORDER BY similarity(name, $2) DESC LIMIT 1)
     RETURNING id, name, detail, position, est_hours, status, confidence`,
    [goalId, fragment, confidence ?? null],
  );
}

export async function addMaterial(input: {
  goalId: string;
  kind: string;
  title: string;
  url?: string | null;
  notes?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO study_materials (goal_id, kind, title, url, notes) VALUES ($1,$2,$3,$4,$5)`,
    [input.goalId, input.kind, input.title, input.url ?? null, input.notes ?? null],
  );
}

export async function listMaterials(goalId: string): Promise<
  { kind: string; title: string; url: string | null }[]
> {
  return query(`SELECT kind, title, url FROM study_materials WHERE goal_id = $1 ORDER BY added_at`, [goalId]);
}

export async function logSession(input: {
  goalId: string;
  topicFragment?: string | null;
  minutes: number;
  confidence?: number | null;
  notes?: string | null;
}): Promise<void> {
  const topic = input.topicFragment
    ? await one<{ id: string }>(
        `SELECT id FROM study_topics WHERE goal_id = $1 AND name ILIKE '%' || $2 || '%'
         ORDER BY similarity(name, $2) DESC LIMIT 1`,
        [input.goalId, input.topicFragment],
      )
    : null;
  await query(
    `INSERT INTO study_sessions (goal_id, topic_id, minutes, confidence, notes)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.goalId, topic?.id ?? null, input.minutes, input.confidence ?? null, input.notes ?? null],
  );
}

/** Hours actually studied in the last `days`, against the plan. */
export async function progress(goalId: string): Promise<{
  totalHours: number;
  doneHours: number;
  studiedHours7d: number;
  topicsDone: number;
  topicsTotal: number;
  daysLeft: number | null;
  requiredHoursPerDay: number | null;
}> {
  const row = await one<{
    total: string; done: string; studied: string;
    n_done: string; n_total: string; deadline: Date | null;
  }>(
    `SELECT
       coalesce(sum(t.est_hours), 0)                                          AS total,
       coalesce(sum(t.est_hours) FILTER (WHERE t.status = 'done'), 0)          AS done,
       (SELECT coalesce(sum(minutes), 0) / 60.0 FROM study_sessions
        WHERE goal_id = $1 AND studied_at > now() - interval '7 days')         AS studied,
       count(*) FILTER (WHERE t.status = 'done')                               AS n_done,
       count(*)                                                               AS n_total,
       (SELECT deadline FROM study_goals WHERE id = $1)                        AS deadline
     FROM study_topics t WHERE t.goal_id = $1`,
    [goalId],
  );

  const total = Number(row?.total ?? 0);
  const done = Number(row?.done ?? 0);
  const deadline = row?.deadline ?? null;
  const daysLeft = deadline
    ? Math.ceil((new Date(deadline).getTime() - Date.now()) / 864e5)
    : null;

  return {
    totalHours: total,
    doneHours: done,
    studiedHours7d: Number(row?.studied ?? 0),
    topicsDone: Number(row?.n_done ?? 0),
    topicsTotal: Number(row?.n_total ?? 0),
    daysLeft,
    requiredHoursPerDay:
      daysLeft && daysLeft > 0 ? Math.round(((total - done) / daysLeft) * 10) / 10 : null,
  };
}

// ── spaced repetition (SM-2, trimmed) ──────────────────────
export async function addCard(input: {
  goalId: string;
  question: string;
  answer: string;
  topicFragment?: string | null;
}): Promise<void> {
  const topic = input.topicFragment
    ? await one<{ id: string }>(
        `SELECT id FROM study_topics WHERE goal_id = $1 AND name ILIKE '%' || $2 || '%'
         ORDER BY similarity(name, $2) DESC LIMIT 1`,
        [input.goalId, input.topicFragment],
      )
    : null;
  await query(
    `INSERT INTO study_cards (goal_id, topic_id, question, answer) VALUES ($1,$2,$3,$4)`,
    [input.goalId, topic?.id ?? null, input.question, input.answer],
  );
}

export async function dueCards(goalId: string, limit = 10): Promise<Card[]> {
  return query<Card>(
    `SELECT c.id, c.question, c.answer, c.ease, c.interval_days, c.reps, t.name AS topic_name
     FROM study_cards c LEFT JOIN study_topics t ON t.id = c.topic_id
     WHERE c.goal_id = $1 AND c.due_at <= now()
     ORDER BY c.due_at LIMIT $2`,
    [goalId, limit],
  );
}

/**
 * grade 0-5. Below 3 is a lapse: the card resets and comes back tomorrow,
 * because a half-remembered answer is not a remembered one.
 */
export async function gradeCard(cardId: string, grade: number): Promise<Card | null> {
  const card = await one<{ ease: string; interval_days: number; reps: number }>(
    `SELECT ease, interval_days, reps FROM study_cards WHERE id = $1`,
    [cardId],
  );
  if (!card) return null;

  const ease = Number(card.ease);
  let nextEase = ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  if (nextEase < 1.3) nextEase = 1.3;

  let interval: number;
  let reps = card.reps + 1;
  let lapse = 0;

  if (grade < 3) {
    interval = 1;
    reps = 0;
    lapse = 1;
  } else if (card.reps === 0) {
    interval = 1;
  } else if (card.reps === 1) {
    interval = 6;
  } else {
    interval = Math.round(card.interval_days * nextEase);
  }

  return one<Card>(
    `UPDATE study_cards
     SET ease = $2::numeric, interval_days = $3::int, reps = $4::int, lapses = lapses + $5::int,
         due_at = now() + make_interval(days => $3::int)
     WHERE id = $1
     RETURNING id, question, answer, ease, interval_days, reps`,
    [cardId, nextEase.toFixed(2), interval, reps, lapse],
  );
}
