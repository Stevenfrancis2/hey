# -*- coding: utf-8 -*-
"""Builds the everything-Steven-said dossier as a PDF."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, PageBreak, Table, TableStyle, KeepTogether)

INK   = colors.HexColor("#141D1B")
INK2  = colors.HexColor("#4D5A57")
INK3  = colors.HexColor("#7A8884")
ACC   = colors.HexColor("#0A6B74")
SIG   = colors.HexColor("#A9500B")
LINE  = colors.HexColor("#C9D2CF")
SOFT  = colors.HexColor("#EDF4F4")

S = lambda **kw: ParagraphStyle(**kw)
title   = S(name="t", fontName="Helvetica-Bold", fontSize=30, leading=32, textColor=INK, spaceAfter=6)
sub     = S(name="s", fontName="Helvetica", fontSize=11.5, leading=16, textColor=INK2, spaceAfter=16)
h1      = S(name="h1", fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=INK, spaceBefore=20, spaceAfter=7)
h2      = S(name="h2", fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=ACC, spaceBefore=13, spaceAfter=4)
h3      = S(name="h3", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=INK, spaceBefore=9, spaceAfter=2)
body    = S(name="b", fontName="Helvetica", fontSize=9.8, leading=14.2, textColor=INK, spaceAfter=6, alignment=TA_LEFT)
bullet  = S(name="li", parent=body, leftIndent=12, bulletIndent=3, spaceAfter=2.5)
quote   = S(name="q", fontName="Helvetica-Oblique", fontSize=9.6, leading=14, textColor=INK2,
            leftIndent=12, borderPadding=0, spaceAfter=6)
eyebrow = S(name="e", fontName="Helvetica-Bold", fontSize=7.6, leading=11, textColor=INK3, spaceAfter=3)
note    = S(name="n", fontName="Helvetica", fontSize=8.8, leading=12.6, textColor=SIG, spaceAfter=5)

doc = BaseDocTemplate("/home/user/hey/docs/export/second-steven-dossier.pdf", pagesize=A4,
                      leftMargin=20*mm, rightMargin=20*mm, topMargin=18*mm, bottomMargin=18*mm,
                      title="Second Steven — Full Dossier", author="Second Steven")

def decorate(canvas, d):
    canvas.saveState()
    canvas.setStrokeColor(LINE); canvas.setLineWidth(0.5)
    canvas.line(20*mm, A4[1]-13*mm, A4[0]-20*mm, A4[1]-13*mm)
    canvas.setFont("Helvetica", 7.4); canvas.setFillColor(INK3)
    canvas.drawString(20*mm, A4[1]-11*mm, "SECOND STEVEN  ·  EVERYTHING YOU'VE TOLD ME")
    canvas.drawRightString(A4[0]-20*mm, A4[1]-11*mm, "1 Sept 2026")
    canvas.drawCentredString(A4[0]/2, 11*mm, str(canvas.getPageNumber()))
    canvas.restoreState()

frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=decorate)])

def P(text, style=body): return Paragraph(text, style)
def LI(text): return Paragraph(text, bullet, bulletText="•")
def Q(text): return Paragraph(f'"{text}"', quote)

def box(rows, widths, header=True):
    t = Table(rows, colWidths=widths, hAlign="LEFT")
    style = [
        ("FONTNAME", (0,0), (-1,-1), "Helvetica"),
        ("FONTSIZE", (0,0), (-1,-1), 8.6),
        ("LEADING", (0,0), (-1,-1), 12),
        ("TEXTCOLOR", (0,0), (-1,-1), INK),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LINEBELOW", (0,0), (-1,-2), 0.4, LINE),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("LEFTPADDING", (0,0), (-1,-1), 0),
        ("RIGHTPADDING", (0,0), (-1,-1), 8),
    ]
    if header:
        style += [("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
                  ("TEXTCOLOR", (0,0), (-1,0), INK3),
                  ("FONTSIZE", (0,0), (-1,0), 7.6),
                  ("LINEBELOW", (0,0), (-1,0), 0.8, INK3)]
    t.setStyle(TableStyle(style))
    return t

F = []
A = F.append

# ── COVER ───────────────────────────────────────────────────
A(Spacer(1, 40*mm))
A(P("Second Steven", title))
A(P("Everything you've told me, organised so you never have to say it twice.", sub))
A(Spacer(1, 4*mm))
A(box([
    ["", ""],
    ["Compiled", "1 September 2026"],
    ["Source", "Every message in the build conversation, verbatim"],
    ["Repository", "github.com/Stevenfrancis2/hey"],
    ["Branch", "claude/telegram-personal-assistant-vodi6o"],
    ["Also lives at", "docs/ in the repo, and the nightly Telegram archive"],
], [38*mm, 110*mm], header=False))
A(Spacer(1, 10*mm))
A(P("How to use this", h2))
A(P("If this project ever has to restart — a new session, a new machine, a different assistant, "
    "or six months from now when the detail has gone — hand over this file. It carries the whole "
    "context: who you are, what you're running, every decision made and why, what's built, and "
    "your own words verbatim at the back.", body))
A(P("Nothing in here needs to be brainstormed again.", h3))
A(PageBreak())

# ── 1. WHO ──────────────────────────────────────────────────
A(P("1 · Who Steven is", h1))
A(P("Based in Lebanon. Runs several things at once and thinks in fragments — ideas arrive "
    "mid-task, hands full, and are worth about ninety seconds before they're gone.", body))
A(P("Lebanon shapes almost every practical answer: parts and machines often aren't available "
    "locally, importing is the normal path, and shipping cost and lead time matter as much as "
    "price. Never assume a local supplier exists.", body))
A(P("Background", h2))
A(P("Engineering — public repositories include an autonomous car, a blind stick, Arduino work, "
    "an accent detector, and (December 2025) <b>ragagent</b> and <b>ragagent1</b>: "
    "retrieval-augmented agent work. That last one matters — it's the same shape as the bank "
    "project and as this system's memory.", body))

A(P("2 · What he's running", h1))
A(box([
    ["Room", "What it is", "Weight"],
    ["Cligli", "3D printing and assembly business. Products, orders, suppliers,\nprint farm, filament. Wants more sales and better suppliers.", "Heavy"],
    ["Bank AI", "Side project with a friend building AI agents for banks.\nFriend owns the platform; Steven deploys the local LLM.", "Deadline"],
    ["Drones / FPV", "Building, repairing, training, DCL racing, content.", "Heavy"],
    ["Remote work", "The day job — automation. Client projects with deadlines\nand their own material and data.", "Medium"],
    ["Royal Pizza", "His father's business. Helps with the dough.", "Keep light —\nhis instruction"],
    ["Land", "600 sqm plot. Guesthouse, own house, or hold.", "Open question"],
    ["Finance", "The books across every business. Starting to invest.", "High value"],
    ["Body", "Gym, training, food, calories.", "Small"],
], [26*mm, 92*mm, 30*mm]))

A(PageBreak())

# ── 3. THE BANK PROJECT ─────────────────────────────────────
A(P("3 · The bank AI project", h1))
A(P("The only thing here with a date on it, and the only one where someone else is depending "
    "on him. It outranks everything.", note))
A(P("What it is", h2))
A(LI("Building AI agents for banks, with a friend."))
A(LI("The friend owns the platform. Steven's part: deploying a <b>local LLM</b>, <b>Docker</b>, "
     "and <b>L1 / L2 agent tiers</b>."))
A(LI("Confirmed: <b>NVIDIA NeMo</b> (the framework, not Mistral's model)."))
A(LI("Roughly one month of study needed, from 1 September 2026."))
A(LI("Wants a shared space — Google Drive or similar — where either of them can drop anything."))
A(P("What that means for the study plan", h2))
A(P("NVIDIA NeMo makes this infrastructure-led rather than model science: containerised GPU "
    "inference, NIM microservices, retrieval, and — because it's a bank — <b>guardrails and "
    "evaluation</b>. That last part is what most people skip and exactly what a bank will audit.", body))
A(P("Start from ragagent, not from zero.", h3))
A(P("The December 2025 retrieval-agent work is the same shape. Reading it first is worth days.", body))

# ── 4. THE FLEET ────────────────────────────────────────────
A(P("4 · The fleet", h1))
A(P("Quads", h2))
A(box([
    ["Aircraft", "Class", "Wind limit", "Gust limit"],
    ["iFlight Nazgûl F5 V3", "5-inch freestyle", "32 km/h", "38 km/h"],
    ["Flywoo DarkStar 22", "2.2\" micro long range", "16 km/h", "22 km/h"],
    ["BetaFPV Meteor 75", "75 mm whoop", "8 km/h", "12 km/h"],
], [55*mm, 45*mm, 24*mm, 24*mm]))
A(Spacer(1, 3*mm))
A(P("These limits drive the flyability answers and are editable. They matter because the three "
    "aircraft are not comparable: on a real forecast day the 5-inch got 19 flyable hours, the "
    "micro 11, and the whoop 2. One weather score for all three would be useless.", body))
A(P("Radios", h2))
A(LI("RadioMaster TX16S MAX"))
A(LI("RadioMaster Boxer"))
A(P("Printers", h2))
A(LI("Bambu Lab A1 &times; 7 — the farm"))
A(LI("Bambu Lab H2C &times; 1"))
A(P("Wants to be kept updated on firmware releases and known glitches for these.", body))
A(P("Assumptions to confirm", h2))
A(P("&bull; \"tx15 max\" read as <b>TX16S MAX</b> — there is no TX15.<br/>"
    "&bull; DarkStar 22 brand assumed <b>Flywoo</b>.<br/>"
    "&bull; \"h2c\" read as Bambu Lab <b>H2C</b> — confirm the exact model.<br/>"
    "&bull; Batteries not yet given — he said he'd supply them.", note))

A(PageBreak())

# ── 5. DECISIONS ────────────────────────────────────────────
A(P("5 · Decisions made, and why", h1))
A(P("Locked", h2))
A(box([
    ["Decision", "Choice", "Reasoning"],
    ["Language", "TypeScript, Node 22", "grammY is the best Telegram library; one\nlanguage across bot, jobs, API and console"],
    ["Hosting", "Fly.io + Neon Postgres", "~$5–30/mo, one command to deploy;\nmigratable to own hardware later"],
    ["Voice notes", "Yes, day one", "Hands are usually full. Groq Whisper, ~$2/mo"],
    ["Calendar", "Google Calendar", "Read and write; lands in Phase 3"],
    ["Embeddings", "Voyage voyage-3.5-lite", "Anthropic has no embeddings endpoint;\nVoyage is who they recommend"],
    ["Database", "Postgres + pgvector", "Relational, vectors, graph edges and the job\nqueue in one store"],
    ["Graph", "edges table, recursive CTE", "No Neo4j — real cost, no benefit at this size"],
    ["Jobs", "pg-boss", "No Redis. Cron + delayed jobs with ACID"],
    ["Weather", "Open-Meteo", "Free, no key, hourly gusts"],
    ["Timezone", "Asia/Beirut", "Lebanon"],
], [26*mm, 40*mm, 82*mm]))

A(P("Telegram or a UI? — both, with a split", h2))
A(P("His question: <i>the farm manager is a UI full of things and this has twenty times more — "
    "so is Telegram right at all?</i>", body))
A(P("The answer isn't chat versus UI. It's which direction the information is moving. Chat wins "
    "for unstructured input while moving, and for one fact coming back. A UI wins for anything "
    "dense or comparative — thirty print jobs, a cash position, a calendar. A print queue is a "
    "table: you scan it and spot the stalled row. Nobody can scan a table read out to them.", body))
A(P("<b>So more features don't mean more chat.</b> The chat box stays the same size no matter how "
    "many rooms exist. The UI is where the growth goes.", body))
A(P("And the failure mode he was sensing: a chat-only system gets <i>worse</i> as it grows, because "
    "discovery collapses. With three features you remember the commands; with sixty you use the "
    "same five and the rest may as well not exist. A UI is self-documenting.", body))
A(P("<b>Telegram is the microphone. The console is the cockpit.</b>", h3))

A(P("The Raspberry Pi farm manager stays on the Pi", h2))
A(P("He built a filament and print-farm manager earlier with Claude Code; it lives on a Raspberry "
    "Pi and is not on GitHub (checked — no repository in his account by that name). It should not "
    "be ported: <b>the printers are on his local network and a cloud container cannot reach them.</b> "
    "Instead the Pi keeps local control and gets a small outbound sync pushing job state and "
    "filament levels up. Its screens get embedded as the Cligli room.", body))
A(P("That federation is what produces sentences like <i>\"that job was underpriced\"</i> — which the "
    "farm manager alone can never say, because it doesn't know what he charged.", body))

A(PageBreak())

# ── 6. EVERYTHING ASKED FOR ─────────────────────────────────
A(P("6 · Everything asked for, by topic", h1))

def topic(name, items, extra=None):
    A(P(name, h2))
    for i in items: A(LI(i))
    if extra: A(P(extra, note))

topic("Capture and memory", [
    "One inbox for everything — ideas, tasks, links, photos, voice.",
    "Voice and chat both. Zero friction, no categorising.",
    "Graph memory — knows how everything connects.",
    "Should know everything he knows: drones, 3D printing, marketing, social media, restaurants, stocks, crypto.",
    "Attach other people's messages and voice notes instead of re-explaining.",
])
topic("Organisation — his stated top priority", [
    "\"Everything organised where it should be.\"",
    "Compartments that stand alone, plus one shared place to throw things at.",
    "Projects with deadlines, and each project's material and data attached.",
])
topic("Durability — insisted on twice", [
    "Store all the chat, structured, in a file.",
    "\"If something bad happens I don't need to brainstorm again.\"",
    "A PDF with everything, organised.",
])
topic("Finance", [
    "Manage savings, billing, what he can and cannot buy.",
    "Report in plain language: \"we got this, we sold this, we bought this\" — for all businesses.",
    "~4k from one retail store — confirmed already paid, so it books as revenue.",
])
topic("Investing", [
    "Starting to invest from salary.",
    "Watch drone company stocks, nuclear, water, AI.",
    "Investment opportunities in the news.",
    "Crypto — good time to buy, which coins, which projects.",
], "Built to research and track his thesis, not to recommend trades — it can't see his full "
   "position, and a confident call from a system he trusts would be worse than useless.")
topic("Sourcing and suppliers", [
    "Knows the brand and part; not available in Lebanon.",
    "Find it — Amazon or elsewhere — with full details and images.",
    "Example given: an oven part for Royal Pizza.",
    "More suppliers, and more sales online.",
    "May give access to Instagram Ads and the Cligli catalogue.",
], "Meta's Ads API takes weeks to approve — request access early, build it late.")
topic("Flying", [
    "\"The only thing I need is if the weather is good to fly my drones.\"",
    "Per-aircraft, because the three quads are not comparable.",
    "Quick tips and technique from the bot.",
])
topic("3D printing", [
    "Print farm and filament inventory feeding job costing.",
    "Bambu Lab firmware updates and known glitches.",
    "New machines worth buying.",
    "Trending 3D-printed products and the wider toy market.",
])
topic("Study", [
    "He supplies the material; it works out how to learn it as fast as possible.",
    "Primarily for the bank project, but general.",
])
topic("Daily research", [
    "AI news, stocks, crypto.",
    "Trending 3D-printed toys and the major toy market.",
    "How to improve Cligli, new machines, \"new doors\".",
], "\"New doors\" assumed to mean new sales channels and openings — still unconfirmed.")
topic("Body", ["Gym reminders, gym tips, calorie tracking."])
topic("Land", [
    "600 m<super>2</super> plot, recently acquired.",
    "Guesthouse or build his own house.",
    "Wants feedback, research and a market study.",
])
topic("Automation", [
    "Find things it can automate on his behalf, or produce a plan to automate them.",
])
topic("Access", [
    "Multi-device: laptop, PC, iPad, phone.",
    "A shared space with the bank-project friend.",
], "Sharing is per-room and default-deny — the friend gets the bank room only, never finances "
   "or health.")

A(PageBreak())

# ── 7. BUILT ────────────────────────────────────────────────
A(P("7 · What's built and working", h1))
A(box([
    ["What", "State"],
    ["Capture — text, voice, photo, document, forwards. Reaction ack in under\ntwo seconds, Whisper transcription, forwarded messages attributed.", "Built"],
    ["The brain — nine rooms, Claude Opus 5 with adaptive thinking, 43 tools,\nhosted web search, daily and weekly briefs.", "Built"],
    ["Archive — plain-text Markdown + JSON, nightly over Telegram and /export.", "Built"],
    ["Projects with deadlines. Watchlist that stores the thesis.", "Built"],
    ["The console — twelve pages, every device, installable, magic-link login.", "Built"],
    ["Fleet registry and per-aircraft flyability from wind, gusts and daylight.", "Built"],
    ["Study planner — prerequisite ordering, hours-needed maths, SM-2 review.", "Built"],
    ["Finance ledger — one book per business, receivables, can-I-afford.", "Built"],
    ["Research desk — six standing topics, told what changed since last time.", "Built"],
    ["Automation scout — monthly, finds work done by hand and proposes fixes.", "Built"],
    ["Decision dossier — options with payback, assumptions written as such.", "Built"],
    ["Body — training, weight, calories.", "Built"],
    ["Pi farm-manager sync", "Needs his code"],
    ["Google Drive and Calendar", "Needs OAuth"],
    ["Instagram Ads", "Needs approval"],
], [116*mm, 32*mm]))

A(P("The design rule everything follows", h2))
A(P("<b>The write path is dumb and instant. The read path is smart and slow.</b> A message is one "
    "database insert plus a queued job, then it acknowledges. Transcription, classification and "
    "embedding happen seconds later in the background. He never waits on a model — which is the "
    "only reason this survives being used one-handed.", body))
A(P("And: he never chooses between noting something and asking something. Everything is stored; "
    "it replies only when he actually asked. There is no mode to switch.", body))

A(P("Commands", h2))
A(box([
    ["Command", "Does"],
    ["/money", "The books, and what's actually free to spend"],
    ["/study", "The plan, and whether he's on track"],
    ["/fly    /gear", "Can I fly, per quad; the fleet"],
    ["/body   /land", "Training and food; the 600 sqm dossier"],
    ["/desk   /scout", "Run the research desk; find automations"],
    ["/recall <query>", "Search everything ever said"],
    ["/tasks  /projects", "What's open; deadlines"],
    ["/brief  /export", "Today's brief; everything as files"],
    ["/login  /costs", "Open the console here; what it's spending"],
], [36*mm, 112*mm]))

A(P("8 · Still open", h1))
A(LI("\"New doors\" — sales channels, or doors as a product?"))
A(LI("Does the friend need write access to the shared room, or read only?"))
A(LI("Exact flying location — currently defaulting to Beirut coordinates."))
A(LI("What Cligli is exactly — assumed printing and assembly of a physical product."))
A(LI("Battery inventory — he said he'd supply it."))
A(LI("Confirm TX16S MAX, DarkStar 22 brand, and the Bambu H2C model."))
A(LI("The Pi farm-manager code, when he's home."))

A(PageBreak())

# ── 9. VERBATIM ─────────────────────────────────────────────
A(P("9 · His own words, verbatim", h1))
A(P("Kept exactly as sent, in order, typos and all. This is the primary source — everything above "
    "is derived from it. Where the two ever disagree, this wins.", body))

msgs = [
 ("Message 1 — the original brief",
  "Build a personal assistant linked to telegram where I send everything in my mind like what if an "
  "idea crossed my mind about one my businesses or. To do thing or everything like I want a 2nd brain "
  "with me anytime reminds me of things solves things for me web research stocks reminders calendar "
  "meeting like literally. Second brain maybe link it to. Graphical memory low like think bout what we "
  "can build I m running cligli t the same time mingling atefpv content ne drones nd building repairing "
  "trining for Dcl helping father in making the dough for royal pizza mingling cligli printing "
  "assembling working my remote I utomtion I want news about ai war wether id I ant to fly like "
  "literally. Second Steven smarter way more cpbilities md moyen duplicate ,y time nd Sven lot of my "
  "time why do your ink put. Plan first what frameworks what everything"),
 ("Message 2 — the expansion",
  "In addition I remembered in a month I have to learn a lot nd lots of stuff because I took a side "
  "project with my friend buildignngents for banks he has the platform I will be deploying it local "
  "llm Nemo docker l1 l2 agent ,aube have. Google Drive or so,e sharpening where I can drop info bout "
  "lieerqlly everything and he has ccess to those everything's you know? ... I want everything one "
  "place of we can make it a web app for phone or maybe an app like idk you think bout it I want "
  "easibility structure like each compartment alone maybe nd one share dplace we I throw things at the "
  "agent ... I want to get more sales whether online or get to know more supplier like I have around 4k "
  "from one retail store I sold stuff to like it maybe help me get finance right ... Study organized or "
  "planner I give the material he knows how I can earn them s fast s ossible ... this is why iam "
  "brainstorming with you for the bot"),
 ("Message 3 — on the interface (answering the four questions)",
  "I built it with Claude code earlier it is on my raspberry pi when I am back home I can share the "
  "code with you so you add it but u think the best way is telegram or a ui with many things like the "
  "fame manager is. I with lots of stuff this agent has 20x more things so think about it"),
 ("Message 4 — remote work, durability, investing",
  "Maybe we addd for remote work I maybe talk about projects and deadlines I also share each projects "
  "material and data maybe I need something in so the assistant how to fix it how to build it but "
  "organization is my top thing I want everything organized where it should be and as mentioned I want "
  "you to store allllt he chat I send like each e,saga sent structure those and put them in a file if "
  "something bad happen I don't need to brainstorm gain. Will get into stocks soon from my salary and "
  "stuff keep eye on drone company stocks nuclear water ai investment opportunities in the news thing "
  "or crypto good time to buy maybe what coins what projects"),
 ("Message 5 — Lebanon, sourcing, multi-device",
  "I am reading what astounding r talking I agree there is plenty of things bout cligli the restaurant "
  "don't stress it a lot ok for example to have an oven I nknow th ebbrand the parts ar Neto available "
  "in Lebanon maybe the bro can find them on Amazon with all details and images tâches you know? I can "
  "attach other people. Lice's instead of explaining this is still rbaistorming dn adding to the bot I "
  "was thinking if I am siting on th e desktop how can I check the up? Work on that on laptop and pc "
  "and iPad and phone compatibility and access"),
 ("Message 6 — the fleet",
  "U also mentioned something in cost about fly .io only thing I need is if the weather is good to fly "
  "my drones I have 5 inch Nazgûl f5 v3 iflifght I have meteor 75 betafpv and dark star 22 will also "
  "tell batteries and maybe I need quick tips or stuff from the bot i have 2 controllers radio master "
  "tx15 max and radio master boxer I have 7 Bambi lab a1 keep upadtaed on updates and glitches and h2c "
  "Bambi lab 1"),
 ("Message 7 — where to work",
  "wasnt me to poen it in vscode and claude code ther and continue or hereis good? if yes guide me what "
  "do you weqant m,e to do and i insinst on the pdf having all the chat io sent i want them organized so "
  "wehenevr i ned to build or somehtign happen no need to repeat my self"),
 ("Message 8 — build everything",
  "you built eveyrhting keep building until you run out of crtedits bro i wan tevreythign built "
  "aftye tthta we put our credits"),
]
for h, m in msgs:
    A(KeepTogether([P(h, h3), Q(m.replace("&", "&amp;").replace("<", "&lt;"))]))

A(Spacer(1, 6*mm))
A(P("End of dossier. Regenerate any time — the live version is the nightly archive "
    "delivered over Telegram, and docs/ in the repository.", eyebrow))

doc.build(F)
print("built")
