# Second Steven

A personal AI second brain that lives in Telegram.

One chat. You throw everything at it — voice notes while your hands are in pizza dough,
a business idea mid-drone-repair, a link, a photo of a broken arm on a quad. It captures,
understands, files it into a graph of your life, and then works for you.

**Start here:** [docs/MODULES.md](docs/MODULES.md) — the full system: two surfaces, ten rooms, and the order to build them in.

[docs/PLAN.md](docs/PLAN.md) architecture · [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) decisions · [docs/BRAINDUMP-2026-09-01.md](docs/BRAINDUMP-2026-09-01.md) raw scope · [db/schema.sql](db/schema.sql) data model

---

## Status — Phase 0 is built

The capture loop works end to end. No intelligence yet beyond store-and-search; that's
Phase 1.

| Works today | |
|---|---|
| Capture | Text, voice, photo, document, forwarded messages |
| Acknowledgement | A 👌 reaction, under two seconds — nothing waits on a model |
| Transcription | Voice notes via Groq Whisper, replied back so a misheard word is obvious |
| Indexing | Chunked and embedded with Voyage, in a background job |
| Search | `/recall` — hybrid vector + full-text with reciprocal rank fusion |
| Privacy | Single user. Any other Telegram account is silently ignored. |

```
/recall <anything>   search everything you've ever sent
/recent              the last ten things
/stats               what's in the brain
```

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
├── memory/
│   ├── capture.ts     the one INSERT
│   ├── chunk.ts       sentence-aware splitting
│   ├── embed.ts       Voyage
│   ├── index.ts       chunk + embed + store
│   └── recall.ts      hybrid search, reciprocal rank fusion
├── jobs/              pg-boss queue and the enrichment worker
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

**Phase 1 — the brain.** The Opus 5 tool loop, classification into rooms, tasks and
reminders with natural-language time parsing, web research, and the 06:30 morning brief.
Everything else is built on it.

Then the study planner (there is a bank project with a real deadline), then the finance
ledger, then the console. Full reasoning and the rest of the order in
[docs/MODULES.md](docs/MODULES.md).
