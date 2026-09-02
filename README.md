# Second Steven

A second brain that lives in Telegram and on every screen you own.

You throw everything at it — spoken, typed, photographed, forwarded — and it files your whole
life into one graph, then works for you while you're doing something else.

**Start here:** [docs/MODULES.md](docs/MODULES.md) — the system · [docs/PLAN.md](docs/PLAN.md) — architecture ·
[docs/INTERFACE.md](docs/INTERFACE.md) — why Telegram *and* a console · [docs/export/](docs/export/) — the dossier

---

## What works today

| | |
|---|---|
| **Capture** | Text, voice, photo, document, forwards. A 👌 reaction in under two seconds. |
| **Voice** | Transcribed and replied back, so a misheard word is obvious immediately. |
| **Attribution** | Forward your father's voice note and it's stored as *his* words, searchable that way. |
| **Understanding** | Every capture classified into one of nine rooms, with intent and urgency. |
| **The agent** | Claude Opus 5, adaptive thinking, 43 tools, hosted web search. |
| **Search** | Hybrid vector + full-text with reciprocal rank fusion. |
| **Tasks** | Created from what you say, closed by loose title match. |
| **Projects** | Deadlines, clients, overdue counts, across every room. |
| **Reminders** | Natural language in, absolute time out, claimed exactly once. |
| **Study** | A plan ordered by prerequisite, sized to your real hours, with spaced-repetition review. |
| **Money** | One book per business, receivables that chase themselves, "can I afford this". |
| **Flying** | Per-aircraft windows from wind, gusts, rain and daylight. |
| **Fleet** | Your quads, radios and printers — advice is about what you own. |
| **Decisions** | Options with payback, and the assumptions written down as assumptions. |
| **Body** | Training, weight, calories. |
| **Research desk** | Six standing topics, told what the last digest said so it reports what changed. |
| **Automation scout** | Monthly, finds work you keep doing by hand and proposes fixing it. |
| **The console** | Twelve pages, every device, installable, magic-link login. |
| **Archive** | Everything as plain-text files, nightly and on demand. |
| **Privacy** | Single user. Every other Telegram account is silently ignored. |

### Commands

```
/money  /study  /fly  /gear  /body  /land  /desk  /scout
/recall <query>   /tasks   /projects   /brief
/export           /login    /costs     /stats  /recent
```

### The nine rooms

`cligli` · `drones` · `royal_pizza` · `work` · `bank_ai` · `finance` · `land` · `body` · `personal`

Money talk goes to `finance` even when it names another business, so the books stay in one place.

---

## Two design rules everything follows

**The write path is dumb and instant. The read path is smart and slow.** A message is one
database insert plus a queued job, then it acknowledges. Transcription, classification and
embedding happen seconds later in the background. You never wait on a model — which is the
only reason this survives being used one-handed.

**You never choose between noting something and asking something.** Everything is stored, and
it replies only when you actually asked. There is no mode to switch.

## Nothing here is trapped

At 03:00 nightly, and any time you type `/export`, the whole system is written out and sent to
you on Telegram:

- **`.md`** — profile, projects, every capture by room *and* by day, tasks, reminders,
  watchlist, full conversation history. Opens on anything, needs nothing.
- **`.json`** — the same data, machine-readable, for rebuilding.

The database is the working store. **These files are the durable copy.** Delivered over
Telegram deliberately: no bucket to configure, no credentials to leak, and they land somewhere
you already have on every device.

There is also **[the dossier](docs/export/second-steven-dossier.pdf)** — the whole brainstorm,
organised, with your own words verbatim at the back. Hand that to anyone and nothing has to be
thought through twice.

---

## Running it

Node 22 and a Postgres 17 with `pgvector`.

```bash
npm install
cp .env.example .env      # then fill it in
npm run migrate           # idempotent; also runs on every boot
npm run dev               # long-polling
```

| Variable | Where from |
|---|---|
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_OWNER_ID` | [@userinfobot](https://t.me/userinfobot) — everyone else is ignored |
| `DATABASE_URL` | Neon, Supabase, or local Postgres with `CREATE EXTENSION vector` |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `VOYAGE_API_KEY` | [voyageai.com](https://www.voyageai.com) — embeddings |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) — Whisper |
| `LATITUDE` / `LONGITUDE` | Where you fly. Defaults to Beirut. Weather needs no key. |

Setting `PUBLIC_URL` switches from long-polling to webhooks and enables `/login`.

```bash
fly launch --no-deploy
fly secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_OWNER_ID=... DATABASE_URL=... \
                ANTHROPIC_API_KEY=... VOYAGE_API_KEY=... GROQ_API_KEY=... \
                TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 16)" \
                PUBLIC_URL=https://<app>.fly.dev
fly deploy
```

Then send `/login` and open the link on whichever device you're holding.

## Scheduled

| When | What |
|---|---|
| every minute | Due reminders fire |
| every 10 min | Sweep for captures stranded between insert and enqueue |
| 06:30 daily | Morning brief |
| 08:00 daily | Research desk — daily topics |
| 03:00 nightly | Archive delivered over Telegram |
| Sat 17:00 | Research desk — weekly topics |
| Sun 18:00 | Weekly review |
| 1st monthly | Automation scout |

## Layout

```
src/
├── bot/         grammY handlers — the write path
├── agent/       prompt, classifier, 43 tools, the tool-runner loop
├── memory/      capture · chunk · embed · recall · tasks · reminders · projects
│                watchlist · gear · study · money · decisions · body · research
├── jobs/        pg-boss queues, enrichment, briefs, archive, desk, scout
├── integrations/ transcription, weather, Telegram files
├── web/         Fastify — console (12 pages), auth, webhook
├── archive/     the plain-text mirror
└── db/          pool, helpers, idempotent migration
```

## Next

The Raspberry Pi farm manager — it stays on the Pi, because the printers are on your local
network. It gets an outbound sync instead. Then Google Drive and Calendar, then Instagram Ads
(request API access early — approval takes weeks).
