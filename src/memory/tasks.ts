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
       AND ($2::int  IS NULL OR (t.due_at IS NOT NULL AND t.due_at <= now() + ($2 || ' days')::interval))
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
