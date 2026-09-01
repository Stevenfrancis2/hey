# Second Steven — Build Plan

*Codename: `sven`. Rename whenever you like.*

---

## 1. The problem, stated properly

You are running five things at once — Cligli, FPV/drones and DCL, Royal Pizza with your
father, the remote automation job, and content. Ideas arrive at the worst possible moment:
hands in dough, soldering an arm back on, mid-print. The idea is worth something for about
ninety seconds and then it's gone.

So the real product is not "a chatbot". It is:

> **A zero-friction inbox for your head, attached to a system that never forgets and
> that works on your behalf while you're doing something else.**

Two halves, and most people only build the first:

1. **Capture** — anything, any format, in under two seconds, no categorising, no app switching.
2. **Leverage** — it comes back to you *unprompted* with the right thing at the right time.

Half 2 is what makes it feel like a second you rather than a note app.

### The design rule that follows

**The write path is dumb and instant. The read path is smart and slow.**

When you fire a voice note, the bot stores it and acknowledges immediately. All the
thinking — transcription, classification, entity extraction, graph linking, deciding
whether to act — happens in a background job seconds later. You are never waiting on a
model. This single decision is what will make you actually use it.

---

## 2. The loop

```
   ┌──────────┐
   │ TELEGRAM │  text · voice · photo · document · forwarded link
   └────┬─────┘
        │  < 2s ack
   ┌────▼─────────┐
   │   CAPTURE    │  raw row written, immutable, never deleted
   └────┬─────────┘
        │  background job (pg-boss)
   ┌────▼─────────┐
   │  UNDERSTAND  │  transcribe → classify → extract entities → route
   │              │  Haiku 4.5 for the fast pass, Opus 5 when it's complex
   └────┬─────────┘
        │
   ┌────▼─────────┐
   │    STORE     │  episodic log · vectors · entity graph · tasks
   └────┬─────────┘
        │
   ┌────▼─────────┐
   │     ACT      │  answer · research · schedule · remind · file
   └────┬─────────┘
        │
   ┌────▼─────────┐
   │   SURFACE    │  morning brief · nudges · weekly review · resurfacing
   └──────────────┘
```

---

## 3. Memory: five layers, not one

"Graph memory" alone is not enough, and vectors alone are not enough. The thing that makes
an assistant feel like it knows you is layer 5, and almost nobody builds it.

### Layer 1 — Episodic log (the tape)
Every message you ever send, raw, immutable, with timestamp and media. This is ground
truth. Everything else is derived and can be rebuilt from it. Never lossy, never
summarised away.

### Layer 2 — Semantic index (fuzzy recall)
Chunks + embeddings in **pgvector**, plus Postgres full-text search on the same rows.
Hybrid retrieval — BM25 and vector together beat either alone, consistently.
*"What did I say about that hydration percentage?"*

### Layer 3 — Entity graph (the graphical memory you asked for)
Typed nodes and typed edges in plain Postgres tables, traversed with recursive CTEs.

**Node types:** `person · business · project · product · drone · part · supplier ·
recipe · place · tool · topic · goal · event`

**Edge types:** `works_on · part_of · blocked_by · depends_on · supplier_of · knows ·
located_at · fixed_by · caused_by · competes_with · mentioned_with`

This is what lets it answer things retrieval alone can't:
*"Every time this ESC brand comes up, it's within two weeks of a crash log"* or
*"the supplier for the Cligli housings is also the one Dad used for boxes."*

**No Neo4j.** At your scale (tens of thousands of nodes, not millions) an `edges` table
with a recursive CTE is faster to build, faster to query, transactional with the rest of
your data, and one less thing to run. Revisit only if you cross ~100k nodes with deep
multi-hop queries.

### Layer 4 — Working state (the actionable layer)
Structured, boring, queryable: `tasks`, `reminders`, `projects`, `open_loops`,
`dough_batches`, `flight_sessions`. This is the layer that produces the morning brief.
It exists because "search my notes for what's undone" is unreliable and a `WHERE status =
'open'` is not.

### Layer 5 — Distilled profile (the highest-leverage layer)
A short, hand-editable Markdown document — around 2,000–3,000 tokens — that is
**prepended to every single conversation**. Who you are, what you're building, the five
contexts, the people, the current state of each project, your preferences, your voice.

Regenerated every night from layers 1–4, and editable by you at any time.

This is the difference between an assistant that retrieves facts about you and one that
*already knows you before you've finished the sentence*. It is also cheap — it sits in the
prompt cache, so you pay full price for it roughly once and 10% thereafter.

### Retrieval strategy on a question

```
question
  → embed
  → vector top-40  ⊕  full-text top-40      (hybrid)
  → matched entities → expand 1–2 hops in graph → pull their summaries
  → rerank to top-12
  → assemble: [ profile (always) + context brief + retrieved + recent turns ]
  → Opus 5
```

---

## 4. Agent architecture

**One main agent with a wide tool belt.** Not a multi-agent mesh — not yet. A single
`claude-opus-5` loop with good tools is easier to debug, cheaper, and Opus 5 handles this
class of orchestration well. The one place fan-out genuinely pays is deep research, and
that gets sub-agents in Phase 4.

- **Model:** `claude-opus-5` for the main loop, `claude-haiku-4-5` for the fast classify
  pass on capture and for cheap summarisation.
- **Thinking:** `thinking: { type: "adaptive" }` — the model decides when to think.
- **Effort:** `output_config: { effort: ... }` tuned per route — `low` for classification,
  `high` for the main chat, `xhigh` for research and the weekly review.
- **Loop:** the SDK's beta tool runner (`client.beta.messages.toolRunner`) with
  `betaZodTool` — you write the tool functions, the SDK drives the loop, and the per-turn
  hooks give you approval gates and logging for free.
- **Prompt caching:** tools → system → profile → context brief, all cached; the volatile
  question goes last. Verify with `usage.cache_read_input_tokens` — if it's zero, something
  is silently invalidating the prefix (a `new Date()` in the system prompt is the classic).
- **Compaction:** server-side compaction for long-running threads so a week-long
  conversation doesn't fall over.

### The tool belt

| Group | Tools |
|---|---|
| **Memory** | `recall(query, context?, since?)` · `remember(fact, entities)` · `graph_query(entity, rel, hops)` · `update_profile(section, text)` |
| **Tasks** | `create_task` · `complete_task` · `list_tasks(context, due)` · `snooze(task, until)` |
| **Time** | `set_reminder(text, when|rrule)` · `list_reminders` · `cancel_reminder` |
| **Calendar** | `list_events` · `create_event` · `find_slot(duration, constraints)` |
| **Research** | server-side `web_search_20260209` + `web_fetch_20260209` — hosted by Anthropic, no scraping code to own |
| **Markets** | `quote(symbol)` · `market_news(symbols)` · `watchlist_summary` |
| **Weather / flying** | `forecast(place)` · **`flyability(place, window)`** — see §6 |
| **News** | `news_digest(topics)` — AI, defence/conflict, drones, your feeds |
| **Domain** | `log_dough(batch)` · `log_flight(session)` · `log_repair(drone, part, fix)` |
| **Output** | `send_message(text)` for proactive pushes · `export_markdown(range)` to Obsidian |

---

## 5. Stack — the actual answer to "what frameworks"

| Layer | Choice | Why this one |
|---|---|---|
| Language | **TypeScript, Node 22** | One language for bot, jobs, API and web UI. Best Telegram library lives here. |
| Telegram | **grammY** | TypeScript-first, genuinely good docs, plugins for conversations, file handling, rate limiting and long-running work. Telegraf's types are painful by comparison. |
| HTTP | **Fastify** | Webhook endpoint plus the small internal web UI. Fast, tiny, good TS types. |
| Brain | **Anthropic SDK** — `claude-opus-5` | Tool runner, adaptive thinking, effort control, server-side web search/fetch, prompt caching, compaction. |
| Database | **Postgres 17 + pgvector** (Neon or Supabase) | One store for relational data, vectors (HNSW), the graph edge table, *and* the job queue. One backup, one connection string, ACID across all of it. |
| Graph | `edges` table + recursive CTEs | See §3. No second database. |
| Jobs & cron | **pg-boss** | Postgres-backed, no Redis to run. Cron schedules, one-shot delayed jobs, singleton keys, retries, archiving. Exactly the shape of "remind me Thursday at 4". |
| Voice | **Groq `whisper-large-v3`** (fast + cheap), Deepgram as fallback | You will speak far more than you type. Sub-second transcription matters. |
| Weather | **Open-Meteo** | Free, no API key, hourly wind *and gusts*, cloud base, precipitation probability. Perfect for the flyability score. |
| Markets | **Finnhub** free tier | Quotes + company news. Alpha Vantage as backup. |
| Calendar | **Google Calendar API** | Read + write, service account or OAuth. |
| Deploy | **Fly.io**, single container, EU region + **Neon** Postgres | ~$5–10/mo, persistent, close to you, deploys in one command. |
| Graph UI | **Cytoscape.js** at `/brain` | Your memory, visible and clickable. Also the fastest way to spot bad entity extraction. |
| Observability | **Pino** structured logs + `llm_calls` cost table + `/costs` command | You will want to know what it's spending. |

### Why not the obvious alternatives

- **Not LangChain / LlamaIndex.** Heavy abstraction over an API that is already the right
  shape. You'd spend more time fighting the framework than writing the twelve tools you
  actually need. The Anthropic SDK's tool runner *is* the framework.
- **Not Neo4j.** See §3. Real cost, no benefit at this size.
- **Not Redis + BullMQ.** pg-boss gives you cron and delayed jobs with ACID guarantees and
  zero extra infrastructure. Revisit only under sustained high throughput, which a
  one-person second brain will never have.
- **Not Python.** Perfectly viable (`aiogram`, APScheduler) and better if you later want
  heavy local ML. But the Telegram ecosystem and the single-language-everywhere argument
  win for this build. Say the word and it flips.
- **Not a self-hosted LLM.** Later, maybe, for transcription. The reasoning quality gap on
  exactly this kind of messy multi-domain judgement is the whole product.

### Repo shape

```
sven/
├── src/
│   ├── bot/          grammY: handlers, commands, media, ack
│   ├── agent/        system prompt, tool definitions, the loop, context assembly
│   ├── memory/       capture, embed, entity extraction, graph ops, retrieval
│   ├── jobs/         pg-boss workers: enrich, brief, remind, distill, watch
│   ├── integrations/ weather, markets, calendar, news, transcription
│   ├── web/          Fastify: webhook + /brain graph explorer
│   └── db/           migrations, queries
├── db/schema.sql
├── docs/
└── prompts/          system prompt + per-route prompts, version controlled
```

---

## 6. The features that are specifically *yours*

Generic assistants are boring. These are the ones that earn their keep because of what
you actually do.

### Flyability score
Open-Meteo gives hourly wind at 10m, **gusts**, precipitation probability, cloud base,
visibility, and sunrise/sunset. Combine into a 0–100 score with your own thresholds
(freestyle tolerates more wind than cinematic; a heavy lift build tolerates less).

> **06:30** — *Green window today 14:00–17:00. Wind 8 km/h, gusts 14, no rain, cloud base
> 1200m, sunset 19:42. Best you'll get this week — Thursday looks blown out.*

Ask it "can I fly?" any time and it answers with a window, not a paragraph.

### DCL tracking
The 2026 season runs Falcon, Eagle and Hawk Cups into a Super Final, with the AI Grand
Prix alongside. Watch the calendar and results, tie training sessions to upcoming rounds,
and count down: *"Eagle Cup finals in 19 days — you've logged 3 sim sessions in 2 weeks."*

### Dough log for Royal Pizza
Every batch: flour, hydration, salt, yeast, bulk time, ambient temp, cold ferment hours,
and a result score. After thirty batches it can actually tell you *"your best scores all
sit at 68–70% hydration with 18h cold — the 24h ones score lower"*. That is a real answer
your father would care about, and it comes free once you're logging into a table instead
of a notebook.

### Repair and parts memory
Photo of a broken quad → logged against that drone entity → linked to the part, the
supplier, the crash. *"That's the third GEPRC arm on the 5-inch this year — you have one
spare, ordered 6 weeks ago from the same supplier."*

### Cligli operations brain
Ideas, orders, print jobs, suppliers, costs. Open loops per customer. The weekly review
asks the questions you'd forget to ask yourself.

### The idea inbox that doesn't rot
Every idea gets an entity, a context, and a decay clock. Ideas nobody has touched in three
weeks get resurfaced once — *"still worth doing, or kill it?"* — and then archived. An
idea list you never revisit is just a graveyard.

### Proactive briefs

| When | What |
|---|---|
| **06:30 daily** | Weather + flying window · calendar · today's tasks by context · overnight AI news · anything overdue |
| **Hourly** | Due reminders fire |
| **13:00** | Market check if anything on the watchlist moved >3% |
| **21:30 daily** | "How did today go?" + the nightly distillation job rebuilds your profile |
| **Sun 18:00** | Weekly review — open loops per business, what moved, what didn't, ideas to kill or commit |

---

## 7. Roadmap — ship something useful in a weekend

Each phase ends with something you'd genuinely miss if it were taken away.

### Phase 0 — The Capture Loop *(a weekend)*
grammY bot · Postgres + pgvector · capture text and voice · transcription · embedding ·
instant ack · `/recall <query>` semantic search · deployed and live.

**No intelligence beyond store-and-search.** Ship it first anyway. It proves the habit,
and the habit is the hard part. If you're not firing thoughts at it daily by the end of
week one, nothing else matters.

### Phase 1 — The Brain *(week 2)*
Opus 5 tool runner · classification into contexts · tasks and reminders · natural-language
time parsing · web research via server-side search · the morning brief.

### Phase 2 — The Graph *(weeks 3–4)*
Entity extraction and resolution (aliases, dedup) · edges · graph-aware retrieval ·
nightly distillation into the profile · the `/brain` visual graph explorer.

### Phase 3 — Your Domains *(weeks 5–6)*
Flyability · stocks · news filters · Google Calendar · per-context weekly digests ·
dough log · repair log · DCL calendar.

### Phase 4 — Proactivity *(ongoing)*
It messages *first*. Deep-research sub-agents. Pattern noticing across contexts. Photo
understanding. Obsidian export. Whatever the first three phases teach you that you need.

---

## 8. Cost

| Item | Monthly |
|---|---|
| Anthropic API (with prompt caching, ~50 interactions/day) | $20–45 |
| Postgres (Neon free tier → $19 paid) | $0–19 |
| Fly.io container | $5–10 |
| Transcription (Groq whisper) | ~$2 |
| Weather / markets / calendar | $0 (free tiers) |
| **Total** | **~$27–76/mo** |

Caching is doing a lot of work in that number — the profile, context briefs and tool
definitions are resent on every turn and would otherwise dominate the bill. Budget the
top of that range and be pleasantly surprised.

---

## 9. Privacy and safety

This system will hold more about you than anything else you own: business plans, family,
finances, health, half-formed ideas. So:

- **Single-user by default.** The bot checks your Telegram user ID and ignores everyone
  else. First line of the first handler.
- **Your database.** Neon/Supabase with encryption at rest, or self-hosted on hardware you
  own. Not somebody's SaaS note app.
- **Secrets in the platform's secret store**, never in the repo, never in the prompt.
- **Nightly `pg_dump` to encrypted object storage.** The tape is the one thing you cannot
  lose.
- **Full export command.** Everything to Markdown, any time. No lock-in — if you stop
  paying for this, you keep the brain.
- **Confirm before acting outward.** Sending an email, booking a meeting, spending money:
  it asks first. Reading and thinking is free; acting in the world is not.

---

## 10. What makes this fail

Worth naming up front, because these are the actual risks, not the technical ones:

1. **You stop using it.** By far the most likely failure. Mitigated by Phase 0 shipping in
   a weekend and by capture being genuinely instant. If there is *any* friction — a
   spinner, a "which category?" prompt — it dies.
2. **It becomes a graveyard.** Capture without resurfacing is a landfill. The morning brief
   and the weekly review are not optional extras; they are the product.
3. **Bad entity extraction poisons the graph.** "Cligli", "cligli printing" and "the print
   business" becoming three nodes makes the graph worse than useless. Hence the `/brain`
   explorer in Phase 2 — you need to *see* the graph to fix it, and a merge command.
4. **Over-engineering phase 4 before phase 0 works.** The plan above is deliberately
   ordered so the boring part ships first.

---

## 11. Next step

Answer the four questions in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) and Phase 0 gets
built.
