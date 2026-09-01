# Second Steven

A personal AI second brain that lives in Telegram.

One chat. You throw everything at it — voice notes while your hands are in pizza dough,
a business idea mid-drone-repair, a link, a photo of a broken arm on a quad. It captures,
understands, files it into a graph of your life, and then works for you.

**Start here:** [docs/MODULES.md](docs/MODULES.md) — the full system: two surfaces, ten rooms, and the order to build them in.

[docs/PLAN.md](docs/PLAN.md) architecture · [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) decisions · [docs/BRAINDUMP-2026-09-01.md](docs/BRAINDUMP-2026-09-01.md) raw scope · [db/schema.sql](db/schema.sql) data model

---

## Status — Phase 1 is built

Capture, understanding and the agent all work end to end.

**You never choose between noting something and asking something.** Everything you send is
stored. If you actually asked a question or wanted something done, it answers — otherwise
it stays quiet. There is no mode to switch.

| Works today | |
|---|---|
| Capture | Text, voice, photo, document, forwarded messages |
| Acknowledgement | A 👌 reaction, under two seconds — nothing waits on a model |
| Transcription | Voice notes via Groq Whisper, replied back so a misheard word is obvious |
| Indexing | Chunked and embedded with Voyage, in a background job |
| Search | `/recall` — hybrid vector + full-text with reciprocal rank fusion |
| Understanding | Every capture classified into one of nine rooms, with intent and urgency |
| The agent | Claude Opus 5 with adaptive thinking, eight tools, and hosted web search |
| Tasks | Created from what you say, closed by loose title match — say it how you'd say it |
| Reminders | Natural language in, absolute time out, fired on a minute tick |
| Briefs | 06:30 daily, 18:00 Sunday weekly, in your timezone |
| Privacy | Single user. Any other Telegram account is silently ignored. |

```
/recall <anything>   search everything you've ever sent
/tasks               what's open, grouped by room
/brief               today's brief, now
/recent              the last ten things
/stats               what's in the brain
/costs               what it's spending today and this month
```

### The nine rooms

`cligli` · `drones` · `royal_pizza` · `work` · `bank_ai` · `finance` · `land` · `body` · `personal`

Every capture lands in exactly one. Money talk goes to `finance` even when it names another
business, so the books stay in one place.

### The design rule

**The write path is dumb and instant. The read path is smart and slow.** A message is one
`INSERT` plus a queued job, then it acknowledges. Transcription, chunking and embedding all
happen in a pg-boss worker seconds later. You are never waiting on a model — which is the
whole reason this gets used instead of abandoned.

---

## Running it

Needs Node 22 and a Postgres 17 with `pgvector`.

```bash
npm install
cp .env.example .env      # then fill it in
npm run migrate           # idempotent; also runs automatically on boot
npm run dev               # long-polling
```

Four credentials are required:

| Variable | Where from |
|---|---|
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_OWNER_ID` | [@userinfobot](https://t.me/userinfobot) — your numeric id. Everyone else is ignored. |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) — the brain |
| `DATABASE_URL` | Neon, Supabase, or local Postgres with `CREATE EXTENSION vector` |
| `VOYAGE_API_KEY` | [voyageai.com](https://www.voyageai.com) — embeddings |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) — Whisper transcription |

Setting `PUBLIC_URL` switches the bot from long-polling to webhooks; leave it unset locally.

### Deploying

```bash
fly launch --no-deploy
fly secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_OWNER_ID=... \
                DATABASE_URL=... VOYAGE_API_KEY=... GROQ_API_KEY=... \
                TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 16)" \
                PUBLIC_URL=https://<app>.fly.dev
fly deploy
```

`/health` checks the database and reports polling vs. webhook mode. The schema is applied
on every boot before the HTTP server starts.

---

## Layout

```
src/
├── config.ts          env parsing, fails loudly on a missing credential
├── bot/               grammY handlers — the whole write path
├── agent/
│   ├── client.ts      Anthropic client + per-call cost accounting
│   ├── classify.ts    structured-output routing into rooms
│   ├── prompt.ts      system prompt; stable block cached, clock kept out of it
│   ├── tools.ts       the tool belt
│   └── run.ts         the tool-runner loop, incl. pause_turn resume
├── memory/
│   ├── capture.ts     the one INSERT
│   ├── chunk.ts       sentence-aware splitting
│   ├── embed.ts       Voyage
│   ├── index.ts       chunk + embed + store
│   └── recall.ts      hybrid search, reciprocal rank fusion
├── jobs/              pg-boss queues, enrichment worker, briefs and cron
├── integrations/      transcription, Telegram file download
├── db/                pool, helpers, migration
└── web/               Fastify — health and the Telegram webhook
```

## The five life contexts

Seeded in `contexts` on first migration; Phase 1 classifies every capture into one.

| Context | Tracks |
|---|---|
| `cligli` | printing, assembly, orders, suppliers, ideas |
| `drones` | FPV building, repairs, training, DCL, content |
| `royal_pizza` | dough logs, recipes, helping dad |
| `work` | the remote automation job |
| `personal` | health, weather and flying windows, news, money |

## Next

**The study planner**, and the console shell it brings with it — a study plan is a calendar
and a checklist, which is a screen rather than a chat message. There is a bank project with
a real deadline, so this one is next.

Then the finance ledger, then importing the Raspberry Pi farm manager. Why the console is
not optional, and why the Pi keeps its printers, is in
[docs/INTERFACE.md](docs/INTERFACE.md).
