import { query, toVector } from "../db/index.js";
import { embedOne } from "./embed.js";
import { log } from "../log.js";

export type Hit = {
  capture_id: string;
  text: string;
  kind: string;
  captured_at: Date;
  score: number;
};

const CANDIDATES = 40;
const RRF_K = 60;

/**
 * Hybrid retrieval. Vector search finds things you paraphrased; full-text
 * finds the exact part number you typed once six months ago. Reciprocal rank
 * fusion merges them without needing the two scores to be commensurable.
 */
export async function recall(question: string, limit = 8): Promise<Hit[]> {
  // If the embedding provider is unreachable — which in Lebanon is a normal
  // Tuesday — answering from full text alone is far better than answering
  // nothing. The exact part number he typed once is still findable.
  let vector: string | null = null;
  try {
    vector = toVector(await embedOne(question, "query"));
  } catch (err) {
    log.warn({ err }, "embedding unavailable; falling back to full-text recall");
  }

  return query<Hit>(
    `WITH semantic AS (
       SELECT c.id,
              row_number() OVER (ORDER BY c.embedding <=> $1::vector) AS rank
       FROM chunks c
       WHERE $1::vector IS NOT NULL AND c.embedding IS NOT NULL
       ORDER BY c.embedding <=> $1::vector
       LIMIT $3
     ),
     lexical AS (
       SELECT c.id,
              row_number() OVER (
                ORDER BY ts_rank(c.tsv, plainto_tsquery('simple', $2)) DESC
              ) AS rank
       FROM chunks c
       WHERE c.tsv @@ plainto_tsquery('simple', $2)
       LIMIT $3
     ),
     fused AS (
       SELECT id, sum(weight) AS score FROM (
         SELECT id, 1.0 / ($5 + rank) AS weight FROM semantic
         UNION ALL
         SELECT id, 1.0 / ($5 + rank) AS weight FROM lexical
       ) scored
       GROUP BY id
     )
     SELECT ch.capture_id,
            ch.text,
            cap.kind,
            cap.captured_at,
            fused.score::float8 AS score
     FROM fused
     JOIN chunks   ch  ON ch.id = fused.id
     JOIN captures cap ON cap.id = ch.capture_id
     ORDER BY fused.score DESC, cap.captured_at DESC
     LIMIT $4`,
    [vector, question, CANDIDATES, limit, RRF_K],
  );
}

export async function recent(limit = 10): Promise<Hit[]> {
  return query<Hit>(
    `SELECT id AS capture_id,
            coalesce(raw_text, '(' || kind || ', not yet transcribed)') AS text,
            kind, captured_at, 0::float8 AS score
     FROM captures
     ORDER BY captured_at DESC
     LIMIT $1`,
    [limit],
  );
}
