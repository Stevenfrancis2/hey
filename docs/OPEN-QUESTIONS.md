# Decisions needed before Phase 0

Four things. Everything else I can pick sensibly and you can override later.

### 1. Language — TypeScript or Python?
**Recommendation: TypeScript.** Best Telegram library (grammY), one language across bot,
jobs, API and the graph UI, and a single deploy artifact. Python is the better call only
if you plan to run local ML models yourself later.

### 2. Hosting — managed or your own hardware?
**Recommendation: managed.** Fly.io + Neon Postgres, roughly $5–30/mo, deploys in one
command, backups handled. The alternative is a box at home or a Pi — free and fully
private, but you own uptime, and a second brain that's down when you have the idea is
worse than no second brain. A middle path exists: managed now, migrate to your own
hardware later. Nothing in the design prevents it.

### 3. Voice notes from day one?
**Recommendation: yes.** You will be holding a soldering iron or a ball of dough most of
the times this thing is genuinely useful. Adds Groq Whisper, ~$2/mo, about half a day of
work. Without it I think usage drops by more than half.

### 4. Calendar — connect which one?
Google, Apple/CalDAV, or skip it for now. Skipping is fine — reminders cover most of it
and calendar can land in Phase 3.

---

## Things I'd also like to know, but can guess at

- **Where are you based?** Needed for weather, flying windows, and market hours. Guessing
  Europe from Royal Pizza and DCL.
- **What is Cligli, exactly?** I've assumed printing and assembly of a physical product.
  Getting this right shapes the entity types and the weekly review questions.
- **Do you already keep notes somewhere?** Obsidian, Notion, Apple Notes, a paper
  notebook? If there's an existing pile, importing it seeds the graph with real history
  instead of starting cold — that's the difference between the thing feeling useful in
  week one versus week six.
- **Stocks — watching or trading?** A watchlist digest and an active trading assistant are
  very different features.
