# Second Steven

A personal second brain for **Steven**, in Telegram and a web console. This file loads
automatically in every Claude Code session — read it before doing anything.

## Who this is for

Steven is in **Lebanon** and runs several things at once:

| Room | What |
|---|---|
| `cligli` | 3D printing and assembly business. Seven Bambu Lab A1s and an H2C. Wants more sales and better suppliers. |
| `bank_ai` | Side project with a friend building AI agents for banks. Friend owns the platform; Steven deploys a local LLM (**NVIDIA NeMo**), Docker, L1/L2 agent tiers. **This has a real deadline and someone depending on him — it outranks everything.** |
| `drones` | FPV. Nazgûl F5 V3 (5"), DarkStar 22 (2.2"), Meteor 75 (whoop). RadioMaster TX16S MAX and Boxer. DCL racing. |
| `work` | Remote automation job. Client projects with deadlines. |
| `royal_pizza` | His father's business — dough. **Keep this light; he asked for it not to be over-engineered.** |
| `finance` `land` `body` `personal` | Books across all businesses · a 600 sqm plot decision · gym and food · everything else |

Lebanon matters constantly: parts often aren't available locally, importing is normal, and
shipping cost and lead time matter as much as price. Never assume a local supplier exists.

## Two rules the whole design rests on

**1. The write path is dumb and instant. The read path is smart and slow.**
A message is one INSERT plus a queued job, then it acknowledges. Transcription,
classification and embedding happen seconds later in a pg-boss worker. He never waits on a
model — that is the only reason this survives being used one-handed with dough on them.
**Never add blocking work to the capture path.**

**2. He never chooses between noting something and asking something.**
Everything is stored; it replies only when the classifier says he actually asked. There is
no mode to switch. Don't add one.

## Stack

TypeScript · Node 22 · grammY (Telegram) · Fastify (console) · Postgres 17 + pgvector ·
pg-boss (jobs, no Redis) · Claude **Opus 5** with adaptive thinking and the beta tool runner ·
Voyage embeddings · Groq Whisper · Open-Meteo (free, no key) · Fly.io + Neon.

## Layout

```
src/
├── bot/          grammY handlers — the write path and all slash commands
├── agent/        prompt.ts (system prompt) · classify.ts · tools.ts (46 tools) · run.ts (the loop)
├── memory/       capture · chunk · embed · recall · tasks · reminders · projects · watchlist
│                 gear · study · money · decisions · body · research
├── jobs/         pg-boss queues: enrich · brief · archive · research · drive · index.ts (schedules)
├── integrations/ transcribe · weather · google · telegram-files
├── web/          Fastify console: server.ts (routes) · pages.ts · layout.ts · auth.ts
├── archive/      the plain-text mirror
└── db/           pool, helpers, idempotent migration
db/schema.sql     the whole data model; idempotent, runs on every boot
```

## Things that will bite you

- **Money is `bigint` minor units.** Never floats. Never sum across currencies —
  `summary()` groups by currency deliberately.
- **The system prompt is two blocks.** The stable one is cached; the clock lives in the
  volatile one. Putting anything time-varying in the cached block destroys the cache hit
  rate and roughly triples the bill.
- **The tool runner does not auto-resume `pause_turn`.** `run.ts` handles it explicitly.
  Web search can pause a turn, and without that the answer is silently truncated.
- **`SESSION_SECRET` is not `TELEGRAM_WEBHOOK_SECRET`.** The webhook secret is handed to
  Telegram; signing sessions with it would let anyone holding it read the finance room.
- **Postgres parameter types.** Don't bind the same `$n` as both an int and a text concat —
  use `make_interval(days => $n::int)`. This has already caused one 42P08.
- **Reminders use `FOR UPDATE SKIP LOCKED`** so a restart can't double-fire.
- **A capture is written before it is enqueued.** A sweeper recovers stranded ones every ten
  minutes. A lost thought is the one failure this system cannot have.

## Testing expectations

There is no test framework. The convention is a throwaway `*.tmp.ts` at the repo root run
with `npx tsx`, against a real Postgres, then deleted. **Verify behaviour, not compilation.**
Assert on actual numbers — several bugs here were caught only because a test computed the
answer by hand and compared.

```bash
npm run typecheck     # must pass
npm run build         # must pass
npm run migrate       # idempotent, safe to re-run
npm run dev           # long-polling; no PUBLIC_URL needed
```

Local Postgres with pgvector, if you need one:

```bash
docker run -d --name sven-pg -e POSTGRES_PASSWORD=x -p 5432:5432 pgvector/pgvector:pg17
# DATABASE_URL=postgresql://postgres:x@localhost:5432/postgres
```

## Style

- Comments explain **why**, not what. Prefer none to restating the code.
- Match the surrounding code. No new dependencies without a real reason — `googleapis` was
  deliberately skipped in favour of raw REST for exactly this.
- Console pages are server-rendered template strings. No framework, no build step. Keep it.
- Write for a phone: short paragraphs, no markdown headers in Telegram replies.

## Never

- Add blocking work to the capture path.
- Give financial advice or trade calls. The watchlist stores **his thesis**; it does not
  recommend. `can_i_afford` deliberately excludes money owed *to* him — it isn't his until
  it lands.
- Break the archive. `/export` and the 03:00 job are his guarantee that nothing is trapped.
- Silently drop a capture.
