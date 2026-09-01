# Decisions

## Locked — 1 September 2026

| Question | Decision |
|---|---|
| **Language** | **TypeScript**, Node 22. grammY for Telegram, one language across bot, jobs, API and the graph UI. |
| **Hosting** | **Managed** — Fly.io (single container, `cdg`) + Neon Postgres. Migratable to your own hardware later; nothing in the design prevents it. |
| **Voice notes** | **Yes, from day one.** Groq `whisper-large-v3-turbo`. The bot replies with the transcript so a misheard word is obvious immediately. |
| **Calendar** | **Google Calendar**, read and write. Lands in Phase 3 — it needs an OAuth consent step from you and isn't worth blocking Phase 0 on. |

Embeddings weren't on the list but needed deciding: **Voyage AI `voyage-3.5-lite`** at 1024
dimensions. Anthropic doesn't offer an embeddings endpoint, Voyage is the provider they
recommend, and it's cheap. Swapping it later means re-embedding the `chunks` table — a
background job, not a migration.

---

## Still open — I can guess, but the answers make it better

- **Where are you based?** Needed for weather, flying windows and market hours. Currently
  assumes `Europe/Paris` in `fly.toml` and `.env.example` — change `TZ` if that's wrong.
- **What is Cligli, exactly?** I've assumed printing and assembly of a physical product.
  This shapes the entity types and the questions the weekly review asks.
- **Do you already keep notes somewhere?** Obsidian, Notion, Apple Notes, a paper notebook.
  Importing an existing pile seeds the graph with real history — that's the difference
  between this feeling useful in week one versus week six.
- **Stocks — watching or trading?** A watchlist digest and a trading assistant are very
  different features.
- **Which drones do you fly?** Seeding the `entities` table with your actual airframes
  makes the repair log useful from the first crash instead of the fifth.
