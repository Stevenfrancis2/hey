-- Second Steven — data model
-- Postgres 17 + pgvector. One database for relational, vector, graph and job queue.
-- Idempotent: safe to run on every boot.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- CONTEXTS — the life domains everything is filed under
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contexts (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text,
  colour      text,
  active      boolean NOT NULL DEFAULT true
);

INSERT INTO contexts (key, name, description, colour) VALUES
  ('cligli',      'Cligli',      'The business — printing, assembly, orders, suppliers', '#7A5AA8'),
  ('drones',      'Drones',      'FPV builds, repairs, training, DCL, content',          '#0E7C86'),
  ('royal_pizza', 'Royal Pizza', 'Helping dad — dough logs, recipes, ops',               '#B03A2E'),
  ('work',        'Work',        'The remote automation job',                            '#3F7A46'),
  ('bank_ai',     'Bank AI',     'AI agents for banks — the side project, shared',        '#A9500B'),
  ('finance',     'Finance',     'The books across every business',                       '#0A6B74'),
  ('land',        'Land',        'The 600 m² plot — guesthouse or house',                 '#6B7A55'),
  ('body',        'Body',        'Gym, training, food',                                   '#C2557A'),
  ('personal',    'Personal',    'News, weather and flying, everything else',             '#7C7F86')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- LAYER 3 — ENTITY GRAPH (declared early; chunks reference it)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  type          text NOT NULL,   -- person|business|project|product|drone|part|supplier|
                                 -- recipe|place|tool|topic|goal|event
  name          text NOT NULL,
  canonical_key text UNIQUE NOT NULL,       -- lowercased, deduped; the merge target
  aliases       text[] NOT NULL DEFAULT '{}',
  context_id    uuid REFERENCES contexts(id),
  summary       text,                       -- rolling model-maintained description
  attrs         jsonb NOT NULL DEFAULT '{}',
  embedding     vector(1024),
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  mention_count integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS entities_embedding_idx ON entities USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS entities_name_trgm_idx ON entities USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entities_type_ctx_idx  ON entities (type, context_id);

CREATE TABLE IF NOT EXISTS edges (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  src_id     uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  dst_id     uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  rel        text NOT NULL,   -- works_on|part_of|blocked_by|depends_on|supplier_of|knows|
                              -- located_at|fixed_by|caused_by|competes_with|mentioned_with
  weight     real NOT NULL DEFAULT 1.0,
  attrs      jsonb NOT NULL DEFAULT '{}',
  evidence   uuid[] NOT NULL DEFAULT '{}',   -- capture ids supporting this edge
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (src_id, dst_id, rel)
);
CREATE INDEX IF NOT EXISTS edges_src_idx ON edges (src_id, rel);
CREATE INDEX IF NOT EXISTS edges_dst_idx ON edges (dst_id, rel);

-- Traversal is a recursive CTE over `edges` — no graph database required:
--   WITH RECURSIVE walk(id, depth) AS (
--     SELECT $1::uuid, 0
--     UNION
--     SELECT e.dst_id, w.depth + 1 FROM edges e JOIN walk w ON e.src_id = w.id
--     WHERE w.depth < 2
--   ) SELECT * FROM walk;

-- ─────────────────────────────────────────────────────────────
-- LAYER 1 — EPISODIC LOG. Immutable. Ground truth. Never deleted.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS captures (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  telegram_message_id bigint,
  chat_id             bigint,
  kind                text NOT NULL,       -- text|voice|photo|document|link|forward
  raw_text            text,                -- typed text, transcription, or OCR
  media_file_id       text,                -- telegram file id, re-fetchable
  media_mime          text,
  duration_s          integer,
  source              text NOT NULL DEFAULT 'telegram',
  captured_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  status              text NOT NULL DEFAULT 'pending',  -- pending|enriched|failed
  error               text
);
CREATE INDEX IF NOT EXISTS captures_at_idx      ON captures (captured_at DESC);
CREATE INDEX IF NOT EXISTS captures_pending_idx ON captures (status) WHERE status = 'pending';

-- What the model made of a capture (populated from Phase 1)
CREATE TABLE IF NOT EXISTS capture_enrichment (
  capture_id uuid PRIMARY KEY REFERENCES captures(id) ON DELETE CASCADE,
  context_id uuid REFERENCES contexts(id),
  intent     text,       -- idea|task|question|log|reminder|research|decision|feeling
  summary    text,
  urgency    smallint,
  tags       text[],
  model      text,
  cost_usd   numeric(10,6)
);

-- ─────────────────────────────────────────────────────────────
-- LAYER 2 — SEMANTIC INDEX. Hybrid: vector + full text.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chunks (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  capture_id uuid REFERENCES captures(id) ON DELETE CASCADE,
  entity_id  uuid REFERENCES entities(id) ON DELETE SET NULL,
  text       text NOT NULL,
  embedding  vector(1024),
  tsv        tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx       ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_capture_idx   ON chunks (capture_id);

-- ─────────────────────────────────────────────────────────────
-- LAYER 4 — WORKING STATE. The actionable layer. (Phase 1)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  title          text NOT NULL,
  detail         text,
  context_id     uuid REFERENCES contexts(id),
  entity_id      uuid REFERENCES entities(id),
  status         text NOT NULL DEFAULT 'open',  -- open|doing|done|dropped
  priority       smallint NOT NULL DEFAULT 1,
  due_at         timestamptz,
  snoozed_until  timestamptz,
  source_capture uuid REFERENCES captures(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_open_idx ON tasks (status, due_at) WHERE status IN ('open','doing');

CREATE TABLE IF NOT EXISTS reminders (
  id       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id  uuid REFERENCES tasks(id) ON DELETE CASCADE,
  text     text NOT NULL,
  fire_at  timestamptz,
  rrule    text,
  status   text NOT NULL DEFAULT 'scheduled',   -- scheduled|fired|cancelled
  fired_at timestamptz
);
CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders (fire_at) WHERE status = 'scheduled';

-- ─────────────────────────────────────────────────────────────
-- LAYER 5 — DISTILLED PROFILE. Prepended to every conversation. (Phase 2)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profile_docs (
  key         text PRIMARY KEY,     -- 'core' | 'context:cligli' | ...
  body_md     text NOT NULL,
  tokens      integer,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  hand_edited boolean NOT NULL DEFAULT false
);

-- ─────────────────────────────────────────────────────────────
-- CONVERSATION THREADING (Phase 1)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS threads (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id        bigint NOT NULL,
  title          text,
  last_active_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id  uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role       text NOT NULL,        -- user|assistant|system
  content    jsonb NOT NULL,       -- full content blocks, incl. tool use/results
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- PROACTIVE OUTPUT (Phase 1)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS briefs (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind         text NOT NULL,       -- morning|evening|weekly|alert
  context_id   uuid REFERENCES contexts(id),
  body_md      text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- DOMAIN TABLES — structured logs that become real answers (Phase 3)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dough_batches (
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

CREATE TABLE IF NOT EXISTS flight_sessions (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  flown_on   date NOT NULL,
  place      text,
  drone_id   uuid REFERENCES entities(id),
  packs      smallint,
  conditions jsonb,                 -- wind, gusts, temp at the time
  notes      text,
  capture_id uuid REFERENCES captures(id)
);

CREATE TABLE IF NOT EXISTS repairs (
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
CREATE TABLE IF NOT EXISTS llm_calls (
  id         bigserial PRIMARY KEY,
  route      text NOT NULL,       -- classify|chat|distill|brief|research|embed|transcribe
  model      text NOT NULL,
  tokens_in  integer,
  tokens_out integer,
  cache_read integer,
  cost_usd   numeric(10,6),
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_calls_at_idx ON llm_calls (created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- PROJECTS — work with a deadline and material attached to it
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key          text UNIQUE NOT NULL,        -- short slug he can say out loud
  name         text NOT NULL,
  context_id   uuid REFERENCES contexts(id),
  client       text,
  description  text,
  status       text NOT NULL DEFAULT 'active',  -- active|paused|done|dropped
  deadline     timestamptz,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS projects_active_idx ON projects (status, deadline)
  WHERE status IN ('active','paused');

-- Forwarded messages carry someone else's words. Attribute them.
ALTER TABLE captures           ADD COLUMN IF NOT EXISTS author text;

ALTER TABLE tasks              ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
ALTER TABLE capture_enrichment ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks (project_id);

-- ─────────────────────────────────────────────────────────────
-- WATCHLIST — what he is tracking, and why he is tracking it
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist (
  id       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind     text NOT NULL,          -- stock|crypto|theme
  symbol   text,                   -- ticker or coin; null for a theme
  name     text NOT NULL,
  thesis   text,                   -- why he is watching. The important column.
  active   boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, name)
);

-- ─────────────────────────────────────────────────────────────
-- ARCHIVE RUNS — proof the plain-text mirror actually happened
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archive_runs (
  id         bigserial PRIMARY KEY,
  captures   integer NOT NULL,
  bytes_md   integer NOT NULL,
  bytes_json integer NOT NULL,
  delivered  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- GEAR — the actual kit. Drives per-aircraft flyability and
-- firmware watching, so answers are about HIS things.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gear (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind        text NOT NULL,        -- drone|radio|printer|battery|goggles|tool|other
  brand       text,
  model       text NOT NULL,
  nickname    text,
  quantity    integer NOT NULL DEFAULT 1,
  status      text NOT NULL DEFAULT 'active',   -- active|broken|retired
  specs       jsonb NOT NULL DEFAULT '{}',      -- class, wind_limit_kmh, size_mm, ...
  notes       text,
  acquired_at date,
  UNIQUE (kind, model)
);
CREATE INDEX IF NOT EXISTS gear_kind_idx ON gear (kind, status);

INSERT INTO gear (kind, brand, model, quantity, specs, notes) VALUES
  ('drone', 'iFlight',  'Nazgul F5 V3', 1,
   '{"class":"5inch","size":"5\"","wind_limit_kmh":32,"gust_limit_kmh":38}',
   'Freestyle. Handles real wind.'),
  ('drone', 'BetaFPV',  'Meteor 75', 1,
   '{"class":"whoop","size":"75mm","wind_limit_kmh":8,"gust_limit_kmh":12}',
   'Tiny whoop. Effectively indoor or dead calm.'),
  ('drone', 'Flywoo',   'DarkStar 22', 1,
   '{"class":"micro","size":"2.2\"","wind_limit_kmh":16,"gust_limit_kmh":22}',
   'Micro long range. Brand assumed Flywoo — correct it if wrong.'),
  ('radio', 'RadioMaster', 'TX16S MAX', 1, '{}',
   'Assumed TX16S MAX; there is no TX15. Correct it if wrong.'),
  ('radio', 'RadioMaster', 'Boxer', 1, '{}', NULL),
  ('printer', 'Bambu Lab', 'A1', 7,
   '{"watch_firmware":true}', 'The farm. Seven of them.'),
  ('printer', 'Bambu Lab', 'H2C', 1,
   '{"watch_firmware":true}', 'Model read from "h2c" — confirm exact model.')
ON CONFLICT (kind, model) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- STUDY — material in, a plan out, and questions that come back
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS study_goals (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  project_id  uuid REFERENCES projects(id),
  context_id  uuid REFERENCES contexts(id),
  deadline    date,
  hours_per_day numeric(3,1) NOT NULL DEFAULT 2,
  status      text NOT NULL DEFAULT 'active',   -- active|done|dropped
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS study_topics (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id    uuid NOT NULL REFERENCES study_goals(id) ON DELETE CASCADE,
  name       text NOT NULL,
  detail     text,
  position   integer NOT NULL,              -- prerequisite order; low comes first
  est_hours  numeric(4,1) NOT NULL DEFAULT 1,
  status     text NOT NULL DEFAULT 'todo',  -- todo|doing|done
  confidence smallint,                      -- 1-5, his own read after studying
  done_at    timestamptz,
  UNIQUE (goal_id, name)
);
CREATE INDEX IF NOT EXISTS study_topics_order_idx ON study_topics (goal_id, position);

CREATE TABLE IF NOT EXISTS study_materials (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id    uuid REFERENCES study_goals(id) ON DELETE CASCADE,
  topic_id   uuid REFERENCES study_topics(id) ON DELETE SET NULL,
  kind       text NOT NULL,        -- pdf|link|repo|video|note|course
  title      text NOT NULL,
  url        text,
  notes      text,
  capture_id uuid REFERENCES captures(id),
  added_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS study_sessions (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  topic_id   uuid REFERENCES study_topics(id) ON DELETE SET NULL,
  goal_id    uuid REFERENCES study_goals(id) ON DELETE CASCADE,
  minutes    integer NOT NULL,
  confidence smallint,
  notes      text,
  studied_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS study_sessions_at_idx ON study_sessions (studied_at DESC);

-- Spaced repetition. Re-reading feels productive and is not; being asked is.
CREATE TABLE IF NOT EXISTS study_cards (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  goal_id    uuid REFERENCES study_goals(id) ON DELETE CASCADE,
  topic_id   uuid REFERENCES study_topics(id) ON DELETE SET NULL,
  question   text NOT NULL,
  answer     text NOT NULL,
  ease       numeric(3,2) NOT NULL DEFAULT 2.5,
  interval_days integer NOT NULL DEFAULT 0,
  reps       integer NOT NULL DEFAULT 0,
  lapses     integer NOT NULL DEFAULT 0,
  due_at     timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS study_cards_due_idx ON study_cards (due_at) WHERE reps >= 0;

-- ─────────────────────────────────────────────────────────────
-- MONEY — one book per business, one view across all of them.
-- Amounts are stored in minor units (piastres/cents) as bigint:
-- floating point must never touch money.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  context_id   uuid REFERENCES contexts(id),      -- which business
  project_id   uuid REFERENCES projects(id),
  direction    text NOT NULL CHECK (direction IN ('in','out')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency     text NOT NULL DEFAULT 'USD',
  counterparty text,
  category     text,          -- sale|purchase|salary|bill|fee|transfer|other
  note         text,
  occurred_on  date NOT NULL DEFAULT current_date,
  settled      boolean NOT NULL DEFAULT true,     -- false = owed, either way
  due_on       date,
  capture_id   uuid REFERENCES captures(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_when_idx    ON ledger (occurred_on DESC);
CREATE INDEX IF NOT EXISTS ledger_ctx_idx     ON ledger (context_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS ledger_pending_idx ON ledger (settled, due_on) WHERE settled = false;

-- Recurring outgoings, so "what can I afford" knows what is already committed.
CREATE TABLE IF NOT EXISTS bills (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         text NOT NULL UNIQUE,
  context_id   uuid REFERENCES contexts(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency     text NOT NULL DEFAULT 'USD',
  day_of_month smallint NOT NULL DEFAULT 1,
  active       boolean NOT NULL DEFAULT true
);

-- pg-boss creates and owns its own schema in this same database.
