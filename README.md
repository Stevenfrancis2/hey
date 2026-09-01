# Second Steven

A personal AI second brain that lives in Telegram.

One chat. You throw everything at it — voice notes while your hands are in pizza dough,
a business idea mid-drone-repair, a link, a photo of a broken arm on a quad, "remind me
Thursday", "should I fly today?", "what's happening with AI this week?".

It captures, understands, files it into a graph of your life, and then works for you:
reminders, research, calendar, market and weather watching, and a daily brief that
actually knows what you're building.

**Status:** planning. Nothing is built yet.

Start here → **[docs/PLAN.md](docs/PLAN.md)**

- [docs/PLAN.md](docs/PLAN.md) — architecture, framework choices, roadmap, costs
- [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) — decisions needed before code
- [db/schema.sql](db/schema.sql) — the concrete data model

## The five life contexts it is built around

| Context | What it tracks |
|---|---|
| `cligli` | the business — printing, assembly, orders, suppliers, ideas |
| `drones` | FPV building, repairs, training, DCL competition, content |
| `royal_pizza` | helping dad — dough logs, recipes, ops |
| `work` | the remote automation job |
| `personal` | health, weather/flying windows, news, money, everything else |
