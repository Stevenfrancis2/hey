import { one, query } from "../db/index.js";

export type Task = {
  id: string;
  title: string;
  detail: string | null;
  context_key: string | null;
  status: string;
  priority: number;
  due_at: Date | null;
};

export async function createTask(input: {
  title: string;
  detail?: string | null;
  contextKey?: string | null;
  priority?: number;
  dueAt?: Date | null;
  sourceCapture?: string | null;
}): Promise<Task> {
  const row = await one<Task>(
    `INSERT INTO tasks (title, detail, context_id, priority, due_at, source_capture)
     VALUES ($1, $2, (SELECT id FROM contexts WHERE key = $3), $4, $5, $6)
     RETURNING id, title, detail, status, priority, due_at,
               (SELECT key FROM contexts WHERE id = context_id) AS context_key`,
    [
      input.title,
      input.detail ?? null,
      input.contextKey ?? null,
      input.priority ?? 1,
      input.dueAt ?? null,
      input.sourceCapture ?? null,
    ],
  );
  if (!row) throw new Error("task insert returned no row");
  return row;
}

export async function listTasks(opts: { contextKey?: string | null; dueWithinDays?: number | null } = {}): Promise<Task[]> {
  return query<Task>(
    `SELECT t.id, t.title, t.detail, t.status, t.priority, t.due_at,
            c.key AS context_key
     FROM tasks t
     LEFT JOIN contexts c ON c.id = t.context_id
     WHERE t.status IN ('open','doing')
       AND (t.snoozed_until IS NULL OR t.snoozed_until <= now())
       AND ($1::text IS NULL OR c.key = $1)
       AND ($2::int IS NULL OR (t.due_at IS NOT NULL AND t.due_at <= now() + make_interval(days => $2::int)))
     ORDER BY (t.due_at IS NULL), t.due_at ASC, t.priority DESC, t.created_at ASC
     LIMIT 50`,
    [opts.contextKey ?? null, opts.dueWithinDays ?? null],
  );
}

/** Matches on a fuzzy title so the agent can close a task the way you'd say it. */
export async function completeTask(titleFragment: string): Promise<Task | null> {
  return one<Task>(
    `UPDATE tasks SET status = 'done', completed_at = now()
     WHERE id = (
       SELECT id FROM tasks
       WHERE status IN ('open','doing') AND title ILIKE '%' || $1 || '%'
       ORDER BY similarity(title, $1) DESC, created_at DESC
       LIMIT 1
     )
     RETURNING id, title, detail, status, priority, due_at,
               (SELECT key FROM contexts WHERE id = context_id) AS context_key`,
    [titleFragment],
  );
}

export async function snoozeTask(titleFragment: string, until: Date): Promise<Task | null> {
  return one<Task>(
    `UPDATE tasks SET snoozed_until = $2
     WHERE id = (
       SELECT id FROM tasks
       WHERE status IN ('open','doing') AND title ILIKE '%' || $1 || '%'
       ORDER BY similarity(title, $1) DESC, created_at DESC
       LIMIT 1
     )
     RETURNING id, title, detail, status, priority, due_at,
               (SELECT key FROM contexts WHERE id = context_id) AS context_key`,
    [titleFragment, until],
  );
}

// ── Editing from the console ──────────────────────────────
// The agent matches on a title fragment because he speaks; the console has the
// id in its hand and should never guess at which task he meant.

export async function completeById(id: string): Promise<void> {
  await query(
    `UPDATE tasks SET status = 'done', completed_at = now() WHERE id = $1 AND status <> 'done'`,
    [id]);
}

export async function reopenById(id: string): Promise<void> {
  await query(
    `UPDATE tasks SET status = 'open', completed_at = NULL WHERE id = $1`, [id]);
}

export async function dropById(id: string): Promise<void> {
  await query(`UPDATE tasks SET status = 'dropped' WHERE id = $1`, [id]);
}

/** Pushes the due date out, and clears any snooze so it reappears. */
export async function postponeById(id: string, days: number): Promise<void> {
  await query(
    `UPDATE tasks
     SET due_at = coalesce(greatest(due_at, now()), now()) + make_interval(days => $2::int),
         snoozed_until = NULL
     WHERE id = $1`,
    [id, days]);
}

export async function editById(id: string, input: {
  title?: string; detail?: string | null; dueAt?: Date | null; priority?: number;
  contextKey?: string | null;
}): Promise<void> {
  await query(
    `UPDATE tasks SET
       title      = coalesce(nullif($2, ''), title),
       detail     = CASE WHEN $3::text IS NULL THEN detail ELSE nullif($3, '') END,
       due_at     = CASE WHEN $4::text = 'clear' THEN NULL
                         WHEN $5::timestamptz IS NOT NULL THEN $5::timestamptz
                         ELSE due_at END,
       priority   = coalesce($6::smallint, priority),
       context_id = coalesce((SELECT id FROM contexts WHERE key = $7), context_id)
     WHERE id = $1`,
    [id, input.title ?? "", input.detail ?? null,
     input.dueAt === null ? "clear" : "", input.dueAt ?? null,
     input.priority ?? null, input.contextKey ?? null]);
}

export async function listAll(includeDone = false): Promise<Task[]> {
  return query<Task>(
    `SELECT t.*, c.key AS context_key FROM tasks t
     LEFT JOIN contexts c ON c.id = t.context_id
     WHERE $1::boolean OR t.status IN ('open','doing')
     ORDER BY t.status <> 'done',
              t.due_at IS NULL, t.due_at, t.priority DESC, t.created_at DESC
     LIMIT 200`,
    [includeDone]);
}
