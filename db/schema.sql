-- Second Steven — data model (draft)
-- Postgres 17 + pgvector. One database for relational, vector, graph and job queue.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- CONTEXTS — the life domains everything is filed under
-- ─────────────────────────────────────────────────────────────
CREATE TABLE contexts (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         text UNIQUE NOT NULL,        -- cligli | drones | royal_pizza | work | personal
  name        text NOT NULL,
  description text,
  colour      text,
  active      boolean NOT NULL DEFAULT true
);

-- ─────────────────────────────────────────────────────────────
-- LAYER 1 — EPISODIC LOG. Immutable. Ground truth. Never deleted.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE captures (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  telegram_message_id bigint,
  chat_id             bigint,
  kind                text NOT NULL,       -- text|voice|photo|document|link|forward
  raw_text            text,                -- typed text, transcription, or OCR
  media_path          text,
  media_mime          text,
  duration_s          integer,
  source              text NOT NULL DEFAULT 'telegram',
  captured_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  status              text NOT NULL DEFAULT 'pending'  -- pending|enriched|failed
);
CREATE INDEX ON captures (captured_at DESC);
CREATE INDEX ON captures (status) WHERE status = 'pending';

-- What the model made of a capture
CREATE TABLE capture_enrichment (
  capture_id  uuid PRIMARY KEY REFERENCES captures(id) ON DELETE CASCADE,
  context_id  uuid REFERENCES contexts(id),
  intent      text,       -- idea|task|question|log|reminder|research|decision|feeling
  summary     text,
  urgency     smallint,   -- 0-3
  tags        text[],
  model       text,
  cost_usd    numeric(10,6)
);

-- ─────────────────────────────────────────────────────────────
-- LAYER 2 — SEMANTIC INDEX. Hybrid: vector + full text.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE chunks (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  capture_id uuid REFERENCES captures(id) ON DELETE CASCADE,
  entity_id  uuid,                          -- FK added after entities
  text       text NOT NULL,
  embedding  vector(1536),
  tsv        tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON chunks USING gin (tsv);

-- ─────────────────────────────────────────────────────────────
-- LAYER 3 — ENTITY GRAPH. Nodes and typed edges.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE entities (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type          text NOT NULL,   -- person|business|project|product|drone|part|supplier|
                                 -- recipe|place|tool|topic|goal|event
  name          text NOT NULL,
  canonical_key text UNIQUE NOT NULL,       -- lowercased, deduped; the merge target
  aliases       text[] DEFAULT '{}',
  context_id    uuid REFERENCES contexts(id),
  summary       text,                       -- rolling model-maintained description
  attrs         jsonb DEFAULT '{}',
  embedding     vector(1536),
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  mention_count integer NOT NULL DEFAULT 1
);
CREATE INDEX ON entities USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON entities USING gin (name gin_trgm_ops);   -- fuzzy alias matching
CREATE INDEX ON entities (type, context_id);

ALTER TABLE chunks ADD FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE SET NULL;

CREATE TABLE edges (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  src_id     uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  dst_id     uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  rel        text NOT NULL,   -- works_on|part_of|blocked_by|depends_on|supplier_of|knows|
                              -- located_at|fixed_by|caused_by|competes_with|mentioned_with
  weight     real NOT NULL DEFAULT 1.0,
  attrs      jsonb DEFAULT '{}',
  evidence   uuid[] DEFAULT '{}',           -- capture ids that support this edge
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (src_id, dst_id, rel)
);
CREATE INDEX ON edges (src_id, rel);
CREATE INDEX ON edges (dst_id, rel);

-- Traversal is a recursive CTE over `edges` — no graph database required.
-- Example: everything within 2 hops of an entity.
--   WITH RECURSIVE walk(id, depth) AS (
--     SELECT $1::uuid, 0
--     UNION
--     SELECT e.dst_id, w.depth + 1 FROM edges e JOIN walk w ON e.src_id = w.id
--     WHERE w.depth < 2
--   ) SELECT * FROM walk;

-- ─────────────────────────────────────────────────────────────
-- LAYER 4 — WORKING STATE. The actionable layer.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title         text NOT NULL,
  detail        text,
  context_id    uuid REFERENCES contexts(id),
  entity_id     uuid REFERENCES entities(id),
  status        text NOT NULL DEFAULT 'open',  -- open|doing|done|dropped
  priority      smallint NOT NULL DEFAULT 1,
  due_at        timestamptz,
  snoozed_until timestamptz,
  source_capture uuid REFERENCES captures(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX ON tasks (status, due_at) WHERE status IN ('open','doing');

CREATE TABLE reminders (
  id       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id  uuid REFERENCES tasks(id) ON DELETE CASCADE,
  text     text NOT NULL,
  fire_at  timestamptz,
  rrule    text,                                -- recurring, iCal RRULE
  status   text NOT NULL DEFAULT 'scheduled',   -- scheduled|fired|cancelled
  fired_at timestamptz
);
CREATE INDEX ON reminders (fire_at) WHERE status = 'scheduled';

-- ─────────────────────────────────────────────────────────────
-- LAYER 5 — DISTILLED PROFILE. Prepended to every conversation.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE profile_docs (
  key        text PRIMARY KEY,     -- 'core' | 'context:cligli' | 'context:drones' | ...
  body_md    text NOT NULL,
  tokens     integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  hand_edited boolean NOT NULL DEFAULT false
);

-- ─────────────────────────────────────────────────────────────
-- CONVERSATION THREADING
-- ─────────────────────────────────────────────────────────────
CREATE TABLE threads (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id        bigint NOT NULL,
  title          text,
  last_active_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id  uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role       text NOT NULL,        -- user|assistant|system
  content    jsonb NOT NULL,       -- full content blocks, incl. tool use/results
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON messages (thread_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- PROACTIVE OUTPUT
-- ─────────────────────────────────────────────────────────────
CREATE TABLE briefs (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind         text NOT NULL,       -- morning|evening|weekly|alert
  context_id   uuid REFERENCES contexts(id),
  body_md      text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- DOMAIN TABLES — structured logs that become real answers over time
-- ─────────────────────────────────────────────────────────────
CREATE TABLE dough_batches (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  made_on       date NOT NULL,
  flour         text,
  hydration_pct numeric(4,1),
  salt_pct      numeric(4,2),
  yeast_pct     numeric(4,3),
  bulk_hours    numeric(4,1),
  ambient_c     numeric(4,1),
  cold_hours    numeric(4,1),
  result_score  smallint,           -- 1-10, how the bake actually went
  notes         text,
  capture_id    uuid REFERENCES captures(id)
);

CREATE TABLE flight_sessions (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flown_on   date NOT NULL,
  place      text,
  drone_id   uuid REFERENCES entities(id),
  packs      smallint,
  conditions jsonb,                 -- wind, gusts, temp, snapshot at the time
  notes      text,
  capture_id uuid REFERENCES captures(id)
);

CREATE TABLE repairs (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  drone_id   uuid REFERENCES entities(id),
  part_id    uuid REFERENCES entities(id),
  fixed_on   date NOT NULL,
  cause      text,
  fix        text,
  cost_eur   numeric(8,2),
  capture_id uuid REFERENCES captures(id)
);

-- ─────────────────────────────────────────────────────────────
-- OBSERVABILITY — know what it costs
-- ─────────────────────────────────────────────────────────────
CREATE TABLE llm_calls (
  id           bigserial PRIMARY KEY,
  route        text NOT NULL,       -- classify|chat|distill|brief|research
  model        text NOT NULL,
  tokens_in    integer,
  tokens_out   integer,
  cache_read   integer,
  cost_usd     numeric(10,6),
  latency_ms   integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON llm_calls (created_at DESC);

-- pg-boss creates and owns its own schema in this same database.
