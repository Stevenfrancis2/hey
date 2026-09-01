# The system: one brain, ten rooms

You asked for compartments that stand alone, plus one shared place you throw everything
at. That is exactly the right instinct, and it has one non-obvious consequence worth
stating before anything else.

> **The compartments are not ten apps. They are ten views onto one graph.**

Ten separate apps is what you already have — a notes app, a spreadsheet, Instagram
insights, a notebook by the printer. Bolting an LLM onto each one gets you ten chatbots
that each know a tenth of your life. The value is entirely in the crossings:

- *"That Cligli job lost money — you priced it before the filament price moved."*
- *"Your study plan slipped four days. You flew three of them. Eagle Cup is in 19 days."*
- *"You're 4k short of the machine you want, and the retail store owes you exactly that."*
- *"The guesthouse pencils out only if you can do the fit-out yourself — which your print
  farm and your father's trade actually make possible."*

No single-purpose app can produce those sentences. That is what makes it Jarvis rather
than a folder of tools, and it is why the spine below is shared and the rooms are thin.

---

## The two surfaces

Telegram does not go away — it gets a sibling. They are two doors into the same brain.

### 1. Telegram — the firehose
What you already have. Voice notes with dough on your hands, a photo of a snapped arm, an
idea at 23:40. Zero friction, works one-handed, works offline-ish, no app to open. This is
where **capture** and **conversation** live, and where the assistant pushes to you.

### 2. The console — a phone-installable web app
Everything the firehose is bad at: looking at things. Your finances, the study plan, the
graph, the print queue, the land dossier, file drops. A PWA — you add it to your home
screen and it behaves like an app, with no App Store review, one codebase, and instant
updates. Voice works here too (the browser records, the same Whisper pipeline transcribes).

**Rule:** anything you'd do while moving goes in Telegram. Anything you'd do sitting down
goes in the console. Neither owns data — the brain does.

A native app is a later question, and only if a PWA genuinely fails you. It rarely does
for a single-user tool, and it would cost you weeks you do not have this month.

---

## The spine — shared by every room

Unchanged from the original plan, and now carrying more weight:

1. **Episodic log** — the tape. Every capture, immutable.
2. **Semantic index** — pgvector + full text, hybrid retrieval.
3. **Entity graph** — typed nodes and edges. This is what makes the crossings possible.
4. **Working state** — tasks, reminders, ledger entries, study blocks, print jobs.
5. **Distilled profile** — the always-in-context brief. Now per-compartment as well as core.

Plus the agent (Claude Opus 5 + tools), the job runner, and the proactive engine.

**Files:** Google Drive is the substrate, not something we rebuild. You and your friend
already know how to use it. We index what lands there — PDFs, spec sheets, invoices, study
material — into the same spine, so a document you dropped in Drive is findable from a voice
note in Telegram.

---

## The ten rooms

### Businesses

**1 · Cligli**
Products, orders, customers, suppliers, job costing. The heavy sub-parts:
*print farm* (printers, queue, uptime, maintenance, failures) and *filament inventory*
(spools, material, colour, grams remaining, cost per gram, drying state). Those two exist
so a quote can be priced off what a job actually costs rather than a guess. Later: the
product catalogue and Instagram Ads, so spend can be tied to a margin instead of a like.

**2 · Royal Pizza**
The dough log, ops, costs. Small, and the one your father benefits from directly.

**3 · Drones / FPV**
Builds, repairs, parts and their suppliers, DCL season, training sessions, the content
pipeline. Already the best-developed idea in the original plan.

**4 · Bank AI project** *(shared with your friend)*
Study plan, deliverables, environment notes, the local-LLM and Docker work, L1/L2 agent
design. The only room with someone else in it — see access below.

### Money

**5 · Finance** — *the highest value per line of code in this document.*
You said it yourself: you want to send *"we sold this, we bought this"* and have it
tracked, for every business. That is a ledger with a natural-language front door, and it is
genuinely easy to build well.

- Every business keeps its own book; one consolidated view on top.
- Receivables tracked properly — the ~4k from the retail store stops being a thing you
  remember and becomes a thing that chases itself.
- Savings, recurring bills, runway per business.
- **"Can I buy this?"** answered against real numbers: what's committed, what's owed to
  you, what's due out, what's left.

This is the room that changes decisions fastest, and it needs no external API at all.

### Property

**6 · Land — the 600 m² dossier**
Not a module so much as a long-running decision file: guesthouse vs. your own house vs.
hold. Build cost per m², local guesthouse occupancy and nightly rates, permitting,
financing, and an honest ROI model of each option with the assumptions written down and
revisable. Cheap to build — it is mostly the agent doing research into a structured
document — and it improves every time you drop something new into it.

### Self

**7 · Body**
Gym reminders, session log, calorie tracking, technique tips. Small, and it works because
capture is already instant.

**8 · Study** — *the urgent one.*
You have roughly a month before the bank project needs you competent. You drop material —
PDFs, repos, docs, videos — and it produces a plan to learn it as fast as possible:
ordered prerequisites, daily blocks sized to the time you actually have, spaced-repetition
review, and it quizzes you rather than letting you re-read and feel productive.

Applies to everything else too, but the bank project is what it must survive first.

### Intelligence

**9 · Research desk**
The daily and weekly digests: AI news, stocks, crypto, trending 3D-printed products and
the wider toy market, machines worth buying, suppliers worth approaching, and openings for
Cligli. Filtered against your profile, so it is your feed and not a newsletter.

**10 · Automation scout**
The one you asked for that most systems don't have. It watches the tape for work you keep
doing by hand — the same message retyped, the same spreadsheet updated, the same file
renamed — and once a month proposes what to automate, with a plan and an effort estimate.
The assistant's job is to make itself more useful without being asked.

---

## Access: who sees what

Your friend needs the bank room. He must not get the rest — your finances, your health,
your half-formed ideas, your father's business.

- **Default deny.** A room is private unless explicitly shared.
- Sharing is per-compartment, never global.
- The shared Drive folder maps to the shared room only; nothing else syncs into it.
- The assistant's answers are scoped too — a question asked inside the bank room cannot
  retrieve from your finance room, even though both live in one graph.

This is worth getting right on day one of the console. Retrofitting permissions onto a
system that assumed one user is how private things leak.

---

## What you already have that feeds into this

Looking at your repositories, two are directly relevant and worth not rebuilding:

- **`ragagent` / `ragagent1`** (December 2025) — you have already built retrieval-augmented
  agent work. That is the same shape as both the bank project *and* the retrieval spine
  here. Worth reading before starting the bank curriculum: your study plan should begin
  from what you already did, not from zero.
- **`leadgen-dashboard`** — relevant to "more sales" and finding suppliers. If it has
  working lead-sourcing in it, that is a head start on the Cligli growth room.

Also present: `royals-landing` / `royal` (and `royal-landing-page` under **JeanPaulBassil**
— if that is your friend on the bank project, you two already share a repository, which
makes the shared room easier), `virtualb`, and a run of hardware projects — autonomous car,
blind stick, Arduino. That hardware background is why the print-farm room is realistic for
you and would not be for most people.

I have not read inside any of them; this is from the repository listing only. Say the word
and I'll pull `ragagent` in and tell you what's reusable.

---

## Sequencing — and an honest objection

Everything above is buildable. Building it all now is the wrong call, and I'd be doing you
a disservice to just say yes.

**You have about a month before the bank project demands real competence from you** — a
local LLM deployment, Docker, an agent architecture, with your friend depending on you.
That is the single hardest commitment in this dump, it has a date on it, and it is the one
where failing is most expensive. Everything else has no deadline.

So the order is chosen to protect that, not to build the most impressive thing first:

| | What | Why here |
|---|---|---|
| **1** | **Phase 1 — the brain** *(2 weeks)* | Classification, tasks, reminders, research, morning brief. Everything else is a room built on this; without it there is nothing to build on. |
| **2** | **Study planner** | Your deadline is real. This is the room that directly protects it, and the work you do learning the local-LLM stack feeds straight back into this system later. |
| **3** | **Finance ledger** | Highest value per line of code, no external APIs, and it starts paying the day the first entry lands. |
| **4** | **The console (PWA)** | Only once there's enough in the brain to be worth looking at. Building the interface before the data exists is the classic way to end up with a beautiful empty dashboard. |
| **5** | **Research desk + automation scout** | Nearly free once the agent and the job runner exist. |
| **6** | **Land dossier** | Can start any time after Phase 1 — it's mostly research, very little code. Slot it in whenever the question gets urgent. |
| **7** | **Cligli deep — print farm, filament, ads** | The heaviest: hardware integration, and Meta's Ads API access takes weeks to be approved. Start the access request early, build it late. |
| **8** | **Body** | Genuinely small. Slot it anywhere it fits. |

The risk with a dump this good is that it becomes a cathedral nobody finishes. The defence
is that every step above ships something you'd miss if it were removed — the same rule
Phase 0 followed.

---

## Things I need from you

1. **The 4k from the retail store — is that money they owe you, or money you've already
   been paid?** It changes whether finance opens with a receivable or a revenue entry, and
   it's the first real number in the system.
2. **"New doors"** — new sales channels and openings, or literally doors as a Cligli
   product? I've assumed channels.
3. **Filament and farm management** — I checked properly rather than guessing. It is not
   in this repository (empty at the start of this session, two commits now, both mine) and
   there is **no repository in your GitHub account with a filament or farm-management name**.
   So either it lives somewhere that isn't GitHub, or it was an idea rather than a build.
   Which is it?
4. **The bank project** — is Nemo the NVIDIA NeMo framework, or Mistral's NeMo model?
   Different study plans entirely, and I'd rather ask than build you the wrong curriculum.
5. **Your friend** — does he need to write into the shared room, or only read it?
