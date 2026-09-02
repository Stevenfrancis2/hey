# The prompt to paste into Claude Code in VS Code

Copy everything between the lines into your first message. `CLAUDE.md` loads
automatically, so this is the *task*, not the background.

---

I'm Steven. This repo is my personal second brain — Telegram bot plus a web console.
Read CLAUDE.md first, then README.md, then docs/MODULES.md. It was all built in a
remote session against a test database, so **nothing has ever run against a real
Telegram, a real Anthropic key, or a real Google account.** Your job is to get it
actually running on my machine, then bring in work that only exists locally.

Work through these in order. Don't skip ahead — each one blocks the next.

**1. Get it running locally, and fix what breaks.**
Install, set up a local Postgres with pgvector, run the migration, boot it, and send
the bot a message. Expect real bugs on first contact — API shapes are verified against
docs but not against live services. When something fails, fix it properly rather than
working around it. Confirm end to end: I send a voice note → it acknowledges within
two seconds → the transcript comes back → `/recall` finds it. Then check `/costs` and
tell me what a real message actually costs.

**2. Verify prompt caching is working.**
`usage.cache_read_input_tokens` should be non-zero from the second message onward. If
it's zero, something is invalidating the cached prefix and my bill is roughly triple
what it should be. Find it and fix it. Report the actual numbers.

**3. Bring in my Raspberry Pi farm manager.**
I built it earlier with Claude Code; the files are on this PC. I'll point you at the
folder. **Do not port it into this repo** — it has to keep running on the Pi, because
my printers are on my local network and a cloud container can't reach them. Read it,
work out its data model, then design and build a small outbound sync: the Pi pushes
job state, filament levels and failures up to Second Steven. Outbound only — I don't
want to expose anything or forward a port. Then wire that into the Cligli room so it
can tell me things the farm manager alone never could, like whether a job was
underpriced given what the filament actually cost.

**4. Google Drive and Calendar.**
The code is written; I need to create the credentials. Walk me through
docs/GOOGLE-SETUP.md one step at a time, wait for me at each step, then test `/connect`,
`/drive`, and asking it about my calendar. If Google's console has changed since that
guide was written, fix the guide.

**5. Deploy it.**
Fly.io and Neon. Set every secret including SESSION_SECRET, which must be different
from the webhook secret. Then check the scheduled jobs actually fire — I care most
about the 06:30 brief and the 03:00 archive. Send me the archive files and confirm
they contain everything.

**6. Then ask me what's next.**

How I want you to work:

- **Test behaviour, not compilation.** Every bug worth catching in this codebase was
  found by a test that computed the answer by hand and compared. Typechecking passing
  means nothing. Run things against a real database.
- **Tell me when I'm wrong.** I asked for a second brain, not an agreeable one. If
  something I want is a bad idea, say so once, plainly, then do it my way if I insist.
- **Don't over-build.** I have a bank AI project with a real deadline and a friend
  depending on me. If this system and that project ever compete for a weekend, that
  project wins. Say so if you see me avoiding it.
- **Never break the archive.** `/export` and the nightly job are my guarantee that
  nothing is trapped. If you touch that path, verify it still round-trips.
- **Commit as you go**, with messages that explain why, and push to
  `claude/telegram-personal-assistant-vodi6o`.

Start with step 1. Tell me exactly what you need from me before you begin.

---

## After this, useful things to ask for

- *"Read my ragagent repo and tell me what's reusable for the bank project, then build
  my study plan from what I already know instead of from zero."*
- *"Here's my product list for Cligli — get it in, then work out what I should push."*
- *"Research the guesthouse question properly and fill in the land dossier with real
  numbers for Lebanon. Record every assumption with its source."*
- *"Find me a Moretti oven burner that actually ships to Lebanon, with prices and images."*
- *"Quiz me on NeMo for twenty minutes."*
