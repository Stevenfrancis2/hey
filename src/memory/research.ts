import { one, query } from "../db/index.js";

export type Topic = {
  id: string;
  name: string;
  brief: string;
  cadence: string;
  last_run: Date | null;
  context_key: string | null;
};

export async function dueTopics(cadence: "daily" | "weekly"): Promise<Topic[]> {
  return query<Topic>(
    `SELECT t.id, t.name, t.brief, t.cadence, t.last_run,
            (SELECT key FROM contexts WHERE id = t.context_id) AS context_key
     FROM research_topics t
     WHERE t.active AND t.cadence = $1
       AND (t.last_run IS NULL OR t.last_run < now() - CASE $1
              WHEN 'daily' THEN interval '20 hours'
              ELSE interval '6 days' END)
     ORDER BY t.last_run NULLS FIRST`,
    [cadence],
  );
}

export async function listTopics(): Promise<Topic[]> {
  return query<Topic>(
    `SELECT t.id, t.name, t.brief, t.cadence, t.last_run,
            (SELECT key FROM contexts WHERE id = t.context_id) AS context_key
     FROM research_topics t WHERE t.active ORDER BY t.cadence, t.name`,
  );
}

export async function addTopic(input: {
  name: string; brief: string; cadence?: "daily" | "weekly"; contextKey?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO research_topics (name, brief, cadence, context_id)
     VALUES ($1,$2,$3,(SELECT id FROM contexts WHERE key = $4))
     ON CONFLICT (name) DO UPDATE SET
       brief = EXCLUDED.brief, cadence = EXCLUDED.cadence, active = true`,
    [input.name, input.brief, input.cadence ?? "weekly", input.contextKey ?? null],
  );
}

export async function removeTopic(fragment: string): Promise<Topic | null> {
  return one<Topic>(
    `UPDATE research_topics SET active = false
     WHERE id = (SELECT id FROM research_topics WHERE active AND name ILIKE '%' || $1 || '%'
                 ORDER BY similarity(name, $1) DESC LIMIT 1)
     RETURNING id, name, brief, cadence, last_run, NULL::text AS context_key`,
    [fragment],
  );
}

export async function saveFinding(topicId: string, body: string): Promise<void> {
  await query(`INSERT INTO research_findings (topic_id, body_md) VALUES ($1,$2)`, [topicId, body]);
  await query(`UPDATE research_topics SET last_run = now() WHERE id = $1`, [topicId]);
}

export async function markRun(topicId: string): Promise<void> {
  await query(`UPDATE research_topics SET last_run = now() WHERE id = $1`, [topicId]);
}

export async function recentFindings(limit = 20): Promise<
  { name: string; body_md: string; created_at: Date }[]
> {
  return query(
    `SELECT t.name, f.body_md, f.created_at
     FROM research_findings f JOIN research_topics t ON t.id = f.topic_id
     ORDER BY f.created_at DESC LIMIT $1`,
    [limit],
  );
}

/** What the previous run said, so a digest can skip repeating itself. */
export async function lastFinding(topicId: string): Promise<string | null> {
  const row = await one<{ body_md: string }>(
    `SELECT body_md FROM research_findings WHERE topic_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [topicId],
  );
  return row?.body_md ?? null;
}

// ── automation scout ───────────────────────────────────────
export type Candidate = {
  id: string; title: string; observation: string; proposal: string;
  effort: string | null; saves: string | null; status: string;
};

export async function addCandidate(input: {
  title: string; observation: string; proposal: string;
  effort?: string | null; saves?: string | null; contextKey?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO automation_candidates (title, observation, proposal, effort, saves, context_id)
     VALUES ($1,$2,$3,$4,$5,(SELECT id FROM contexts WHERE key = $6))
     ON CONFLICT (title) DO UPDATE SET
       observation = EXCLUDED.observation, proposal = EXCLUDED.proposal,
       effort = EXCLUDED.effort, saves = EXCLUDED.saves`,
    [input.title, input.observation, input.proposal,
     input.effort ?? null, input.saves ?? null, input.contextKey ?? null],
  );
}

export async function listCandidates(includeClosed = false): Promise<Candidate[]> {
  return query<Candidate>(
    `SELECT id, title, observation, proposal, effort, saves, status
     FROM automation_candidates
     WHERE ($1::bool OR status = 'proposed')
     ORDER BY created_at DESC LIMIT 40`,
    [includeClosed],
  );
}

export async function setCandidateStatus(fragment: string, status: string): Promise<Candidate | null> {
  return one<Candidate>(
    `UPDATE automation_candidates SET status = $2
     WHERE id = (SELECT id FROM automation_candidates WHERE title ILIKE '%' || $1 || '%'
                 ORDER BY similarity(title, $1) DESC LIMIT 1)
     RETURNING id, title, observation, proposal, effort, saves, status`,
    [fragment, status],
  );
}
