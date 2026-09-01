import { one, query } from "../db/index.js";

export type Project = {
  id: string;
  key: string;
  name: string;
  client: string | null;
  description: string | null;
  status: string;
  deadline: Date | null;
  context_key: string | null;
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "project";
}

const SELECT = `p.id, p.key, p.name, p.client, p.description, p.status, p.deadline,
                (SELECT key FROM contexts WHERE id = p.context_id) AS context_key`;

export async function createProject(input: {
  name: string;
  contextKey?: string | null;
  client?: string | null;
  description?: string | null;
  deadline?: Date | null;
}): Promise<Project> {
  const row = await one<Project>(
    `INSERT INTO projects (key, name, context_id, client, description, deadline)
     VALUES ($1, $2, (SELECT id FROM contexts WHERE key = $3), $4, $5, $6)
     ON CONFLICT (key) DO UPDATE SET
       name = EXCLUDED.name,
       client = coalesce(EXCLUDED.client, projects.client),
       description = coalesce(EXCLUDED.description, projects.description),
       deadline = coalesce(EXCLUDED.deadline, projects.deadline)
     RETURNING ${SELECT.replace(/p\./g, "")}`,
    [
      slugify(input.name),
      input.name,
      input.contextKey ?? null,
      input.client ?? null,
      input.description ?? null,
      input.deadline ?? null,
    ],
  );
  if (!row) throw new Error("project insert returned no row");
  return row;
}

export async function listProjects(includeDone = false): Promise<Project[]> {
  return query<Project>(
    `SELECT ${SELECT} FROM projects p
     WHERE ($1::bool OR p.status IN ('active','paused'))
     ORDER BY (p.status = 'active') DESC, p.deadline NULLS LAST, p.name`,
    [includeDone],
  );
}

export async function updateProject(
  nameFragment: string,
  changes: { status?: string; deadline?: Date | null; description?: string },
): Promise<Project | null> {
  return one<Project>(
    `UPDATE projects p SET
       status      = coalesce($2, p.status),
       deadline    = coalesce($3, p.deadline),
       description = coalesce($4, p.description),
       completed_at = CASE WHEN $2 = 'done' THEN now() ELSE p.completed_at END
     WHERE p.id = (
       SELECT id FROM projects
       WHERE name ILIKE '%' || $1 || '%' OR key ILIKE '%' || $1 || '%'
       ORDER BY similarity(name, $1) DESC LIMIT 1
     )
     RETURNING ${SELECT}`,
    [nameFragment, changes.status ?? null, changes.deadline ?? null, changes.description ?? null],
  );
}
