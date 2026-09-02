import { page, escapeHtml } from "./layout.js";
import { query } from "../db/index.js";
import { listTasks } from "../memory/tasks.js";
import { listProjects } from "../memory/projects.js";
import { listWatchlist } from "../memory/watchlist.js";
import { listReminders } from "../memory/reminders.js";
import { recall, recent } from "../memory/recall.js";
import { findGoal, listTopics, progress, dueCards, listMaterials } from "../memory/study.js";
import { summary as moneySummary, outstanding, affordability, recentEntries, listBills,
         money, fromMinor } from "../memory/money.js";
import { listTopics as listResearchTopics, recentFindings, listCandidates } from "../memory/research.js";

function when(d: Date | string | null): string {
  if (!d) return "";
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function daysLeft(d: Date | string | null): string {
  if (!d) return "";
  const n = Math.ceil((new Date(d).getTime() - Date.now()) / 864e5);
  return n < 0 ? `${-n}d overdue` : n === 0 ? "today" : `${n}d left`;
}

export async function dashboard(): Promise<string> {
  const [tasks, projects, reminders, latest, counts] = await Promise.all([
    listTasks(),
    listProjects(),
    listReminders(),
    recent(8),
    query<{ captures: string; rooms: string }>(
      `SELECT (SELECT count(*) FROM captures) AS captures,
              (SELECT count(DISTINCT context_id) FROM capture_enrichment) AS rooms`,
    ),
  ]);

  const overdue = projects.filter((p) => p.deadline && new Date(p.deadline) < new Date());
  const upcoming = projects.filter((p) => p.deadline && new Date(p.deadline) >= new Date());
  // Sorted by due date, but undated tasks still show — most of his tasks have no
  // date, and a dashboard that hides them is worse than no dashboard.
  const soon = tasks.slice(0, 8);

  return page("Today", "/", `
<h1>Today</h1>
<p class="muted">${counts[0]?.captures ?? 0} captures across ${counts[0]?.rooms ?? 0} rooms ·
${tasks.length} open tasks · ${projects.length} live projects</p>

<form method="post" action="/capture">
  <textarea name="text" rows="3" placeholder="Throw something in — an idea, a number, a thing to do…" required></textarea>
  <button type="submit">Capture</button>
</form>

${overdue.length ? `<h2>Overdue</h2>${overdue.map((p) => `
<div class="card"><div class="row"><h3>${escapeHtml(p.name)}</h3>
<span class="tag due">${daysLeft(p.deadline)}</span></div>
<p>${escapeHtml(p.client ?? p.context_key ?? "")}</p></div>`).join("")}` : ""}

${upcoming.length ? `<h2>Deadlines</h2>${upcoming.map((p) => `
<div class="card"><div class="row"><h3>${escapeHtml(p.name)}</h3>
<span class="tag">${daysLeft(p.deadline)}</span></div>
<p>${escapeHtml(p.client ?? p.context_key ?? "")}</p></div>`).join("")}` : ""}

<h2>Next up</h2>
${soon.length === 0 ? '<p class="empty">Nothing open.</p>' : soon.map((t) => `
<div class="card"><div class="row"><h3>${escapeHtml(t.title)}</h3>
${t.due_at ? `<span class="tag${new Date(t.due_at) < new Date() ? " due" : ""}">${daysLeft(t.due_at)}</span>`
  : `<span class="tag">${escapeHtml(t.context_key ?? "")}</span>`}</div>
${t.due_at ? `<p>${escapeHtml(t.context_key ?? "")}</p>` : ""}</div>`).join("")}

${reminders.length ? `<h2>Reminders</h2>${reminders.slice(0, 5).map((r) => `
<div class="card"><div class="row"><h3>${escapeHtml(r.text)}</h3>
<span class="tag">${when(r.fire_at)}</span></div></div>`).join("")}` : ""}

<h2>Latest in</h2>
${latest.map((h) => `<div class="hit"><time>${when(h.captured_at)}${h.kind === "voice" ? " · voice" : ""}</time>
${escapeHtml(h.text.slice(0, 260))}</div>`).join("") || '<p class="empty">Nothing captured yet.</p>'}
`);
}

export async function tasksPage(): Promise<string> {
  const tasks = await listTasks();
  const byRoom = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const key = t.context_key ?? "unfiled";
    byRoom.set(key, [...(byRoom.get(key) ?? []), t]);
  }
  return page("Tasks", "/tasks", `
<h1>Tasks</h1><p class="muted">${tasks.length} open</p>
${tasks.length === 0 ? '<p class="empty">Nothing open.</p>' : ""}
${[...byRoom.entries()].map(([room, items]) => `
<h2>${escapeHtml(room)}</h2>
${items.map((t) => `<div class="card"><div class="row"><h3>${escapeHtml(t.title)}</h3>
${t.due_at ? `<span class="tag${new Date(t.due_at) < new Date() ? " due" : ""}">${daysLeft(t.due_at)}</span>` : ""}</div>
${t.detail ? `<p>${escapeHtml(t.detail)}</p>` : ""}</div>`).join("")}`).join("")}
`);
}

export async function projectsPage(): Promise<string> {
  const projects = await listProjects(true);
  return page("Projects", "/projects", `
<h1>Projects</h1><p class="muted">${projects.filter((p) => p.status === "active").length} active</p>
${projects.length === 0 ? '<p class="empty">No projects yet. Tell the bot about one.</p>' : ""}
${projects.map((p) => `<div class="card">
<div class="row"><h3>${escapeHtml(p.name)}</h3>
<span class="tag${p.status === "done" ? " ok" : p.deadline && new Date(p.deadline) < new Date() ? " due" : ""}">${
    p.status === "done" ? "done" : p.deadline ? daysLeft(p.deadline) : "no deadline"}</span></div>
<p>${escapeHtml([p.client, p.context_key].filter(Boolean).join(" · "))}</p>
${p.description ? `<p style="margin-top:6px">${escapeHtml(p.description)}</p>` : ""}</div>`).join("")}
`);
}

export async function roomsPage(): Promise<string> {
  const rooms = await query<{ key: string; name: string; description: string; n: string }>(
    `SELECT c.key, c.name, c.description, count(e.capture_id) AS n
     FROM contexts c LEFT JOIN capture_enrichment e ON e.context_id = c.id
     WHERE c.active GROUP BY c.id ORDER BY count(e.capture_id) DESC, c.key`,
  );
  return page("Rooms", "/rooms", `
<h1>Rooms</h1><p class="muted">Every capture lands in exactly one.</p>
<div class="grid">${rooms.map((r) => `<a class="card" href="/room/${r.key}">
<div class="row"><h3>${escapeHtml(r.name)}</h3><span class="tag">${r.n}</span></div>
<p>${escapeHtml(r.description ?? "")}</p></a>`).join("")}</div>
`);
}

export async function roomPage(key: string): Promise<string> {
  const [meta] = await query<{ name: string }>(`SELECT name FROM contexts WHERE key = $1`, [key]);
  if (!meta) return page("Not found", "/rooms", "<h1>No such room</h1>");

  const [items, tasks, projects] = await Promise.all([
    query<{ captured_at: Date; kind: string; raw_text: string; author: string | null; intent: string | null }>(
      `SELECT c.captured_at, c.kind, c.raw_text, c.author, e.intent
       FROM captures c JOIN capture_enrichment e ON e.capture_id = c.id
       JOIN contexts ctx ON ctx.id = e.context_id
       WHERE ctx.key = $1 AND c.raw_text IS NOT NULL
       ORDER BY c.captured_at DESC LIMIT 100`, [key]),
    listTasks({ contextKey: key }),
    listProjects(),
  ]);
  const roomProjects = projects.filter((p) => p.context_key === key);

  return page(meta.name, "/rooms", `
<h1>${escapeHtml(meta.name)}</h1><p class="muted">${items.length} captures · ${tasks.length} open tasks</p>
${roomProjects.length ? `<h2>Projects</h2>${roomProjects.map((p) => `
<div class="card"><div class="row"><h3>${escapeHtml(p.name)}</h3>
<span class="tag${p.deadline && new Date(p.deadline) < new Date() ? " due" : ""}">${p.deadline ? daysLeft(p.deadline) : "—"}</span></div></div>`).join("")}` : ""}
${tasks.length ? `<h2>Open</h2>${tasks.map((t) => `
<div class="card"><h3>${escapeHtml(t.title)}</h3></div>`).join("")}` : ""}
<h2>Captured</h2>
${items.length === 0 ? '<p class="empty">Nothing here yet.</p>' : items.map((c) => `
<div class="hit"><time>${when(c.captured_at)}${c.kind === "voice" ? " · voice" : ""}${
    c.author ? ` · ${escapeHtml(c.author)}` : ""}${c.intent ? ` · ${c.intent}` : ""}</time>
${escapeHtml(c.raw_text)}</div>`).join("")}
`);
}

export async function watchlistPage(): Promise<string> {
  const items = await listWatchlist();
  return page("Watchlist", "/watchlist", `
<h1>Watchlist</h1><p class="muted">Tracked with the reasoning, not just the ticker.</p>
${items.length === 0 ? '<p class="empty">Nothing tracked yet.</p>' : ""}
${items.map((i) => `<div class="card"><div class="row">
<h3>${escapeHtml(i.name)}${i.symbol ? ` <span class="tag">${escapeHtml(i.symbol)}</span>` : ""}</h3>
<span class="tag">${i.kind}</span></div>
<p>${i.thesis ? escapeHtml(i.thesis) : "<em>No thesis recorded — worth adding one.</em>"}</p></div>`).join("")}
`);
}

export async function searchPage(q: string | undefined): Promise<string> {
  // Search depends on an external embedding call. If it is down, say so —
  // never 500, because the rest of the console is still perfectly usable.
  let hits: Awaited<ReturnType<typeof recall>> = [];
  let failed = false;
  if (q && q.trim()) {
    try {
      hits = await recall(q, 20);
    } catch {
      failed = true;
    }
  }
  return page("Search", "/search", `
<h1>Search</h1>
<form method="get" action="/search">
  <input type="search" name="q" placeholder="Anything you've ever said…" value="${escapeHtml(q ?? "")}" autofocus>
  <button type="submit">Search</button>
</form>
${failed ? '<div class="flash">Search is unavailable right now — everything is still being captured, nothing is lost.</div>' : ""}
${q && !failed ? `<p class="muted" style="margin-top:18px">${hits.length} result${hits.length === 1 ? "" : "s"} for “${escapeHtml(q)}”</p>` : ""}
${hits.map((h) => `<div class="hit"><time>${when(h.captured_at)}${h.kind === "voice" ? " · voice" : ""}</time>
${escapeHtml(h.text)}</div>`).join("")}
${q && !failed && hits.length === 0 ? '<p class="empty">Nothing found.</p>' : ""}
`);
}

export async function chatPage(threadChatId: number): Promise<string> {
  const msgs = await query<{ role: string; content: unknown; created_at: Date }>(
    `SELECT m.role, m.content, m.created_at FROM messages m
     JOIN threads t ON t.id = m.thread_id WHERE t.chat_id = $1
     ORDER BY m.created_at DESC LIMIT 30`, [threadChatId],
  );

  const rendered = msgs.reverse().map((m) => {
    const c = m.content;
    let text = typeof c === "string" ? c : "";
    if (Array.isArray(c)) {
      text = c.filter((b) => (b as { type: string }).type === "text")
              .map((b) => (b as { text: string }).text).join("\n");
    }
    if (!text.trim()) return "";
    return `<div class="msg ${m.role === "user" ? "me" : ""}">
<span class="who">${m.role === "user" ? "You" : "Sven"} · ${when(m.created_at)}</span>
<div class="bubble">${escapeHtml(text)}</div></div>`;
  }).join("");

  return page("Ask", "/chat", `
<h1>Ask</h1>
<p class="muted">Same brain as Telegram. Same conversation, from whichever device you're on.</p>
<form method="post" action="/chat">
  <textarea name="text" rows="3" placeholder="Ask it something…" required></textarea>
  <button type="submit">Send</button>
</form>
<div style="margin-top:24px">${rendered || '<p class="empty">Nothing yet.</p>'}</div>
`);
}

export function loginPage(message: string): string {
  return page("Sign in", "", `
<h1>Sign in</h1>
<p class="muted">Send <b>/login</b> to the bot on Telegram. It replies with a link — open it
on this device and you're in for 90 days.</p>
<div class="flash">${escapeHtml(message)}</div>
`);
}


export async function studyPage(): Promise<string> {
  const goal = await findGoal(null);
  if (!goal) {
    return page("Study", "/study", `
<h1>Study</h1>
<p class="muted">No plan yet. Tell the bot what you need to learn and by when, and it will
build one — ordered by prerequisite, sized to the hours you actually have.</p>`);
  }

  const [topics, p, due, materials] = await Promise.all([
    listTopics(goal.id), progress(goal.id), dueCards(goal.id, 50), listMaterials(goal.id),
  ]);
  const pct = p.totalHours > 0 ? Math.round((p.doneHours / p.totalHours) * 100) : 0;
  const behind = p.requiredHoursPerDay !== null &&
                 p.requiredHoursPerDay > Number(goal.hours_per_day);

  return page("Study", "/study", `
<h1>${escapeHtml(goal.name)}</h1>
<p class="muted">${p.topicsDone}/${p.topicsTotal} topics · ${p.doneHours}/${p.totalHours}h · ${pct}% done
${p.daysLeft !== null ? ` · ${p.daysLeft} days left` : ""}</p>

${behind ? `<div class="flash" style="background:var(--signal-soft);border-color:var(--signal);color:var(--signal)">
Needs ${p.requiredHoursPerDay}h/day from here, but the plan assumes ${goal.hours_per_day}h.
Either find more hours, cut scope, or move the date.</div>` : ""}

<div class="grid">
  <div class="card"><div class="row"><h3>Needed per day</h3>
    <span class="tag${behind ? " due" : " ok"}">${p.requiredHoursPerDay ?? "—"}h</span></div>
    <p>against ${goal.hours_per_day}h planned</p></div>
  <div class="card"><div class="row"><h3>Last 7 days</h3>
    <span class="tag">${Math.round(p.studiedHours7d * 10) / 10}h</span></div>
    <p>actually studied</p></div>
  <div class="card"><div class="row"><h3>Due for review</h3>
    <span class="tag${due.length > 0 ? " due" : ""}">${due.length}</span></div>
    <p>ask the bot to quiz you</p></div>
</div>

<h2>The plan</h2>
${topics.map((t) => `<div class="card"><div class="row">
<h3>${t.status === "done" ? "✓ " : `${t.position}. `}${escapeHtml(t.name)}</h3>
<span class="tag${t.status === "done" ? " ok" : ""}">${t.est_hours}h</span></div>
${t.detail ? `<p>${escapeHtml(t.detail)}</p>` : ""}
${t.confidence ? `<p>confidence ${t.confidence}/5</p>` : ""}</div>`).join("")}

${materials.length ? `<h2>Material</h2>${materials.map((m) => `
<div class="card"><div class="row"><h3>${escapeHtml(m.title)}</h3>
<span class="tag">${m.kind}</span></div>
${m.url ? `<p>${escapeHtml(m.url)}</p>` : ""}</div>`).join("")}` : ""}
`);
}


export async function moneyPage(): Promise<string> {
  const [all, month, owed, afford, entries, bills] = await Promise.all([
    moneySummary({}), moneySummary({ days: 30 }), outstanding(),
    affordability("USD"), recentEntries(25), listBills(),
  ]);

  const owedToHim = owed.filter((o) => o.direction === "in");
  const owedByHim = owed.filter((o) => o.direction === "out");

  return page("Money", "/money", `
<h1>Money</h1>
<p class="muted">One book per business, one view across all of them. Amounts owed to you are
shown but never counted as available — it isn't yours until it lands.</p>

<div class="grid">
  <div class="card"><div class="row"><h3>Free to spend</h3>
    <span class="tag${afford.freeMinor < 0 ? " due" : " ok"}">${money(afford.freeMinor)}</span></div>
    <p>cash minus what you owe and monthly bills</p></div>
  <div class="card"><div class="row"><h3>Cash</h3><span class="tag">${money(afford.cashMinor)}</span></div>
    <p>settled, USD</p></div>
  <div class="card"><div class="row"><h3>Owed to you</h3>
    <span class="tag">${money(afford.owedToHimMinor)}</span></div>
    <p>${owedToHim.length} outstanding</p></div>
  <div class="card"><div class="row"><h3>You owe</h3>
    <span class="tag${afford.owedByHimMinor > 0 ? " due" : ""}">${money(afford.owedByHimMinor)}</span></div>
    <p>${owedByHim.length} outstanding · ${money(afford.monthlyBillsMinor)}/mo bills</p></div>
</div>

<h2>By business</h2>
${all.length === 0 ? '<p class="empty">Nothing recorded yet. Tell the bot: "sold 3 housings for 450".</p>' : ""}
${all.map((r) => {
  const m = month.find((x) => x.context_key === r.context_key && x.currency === r.currency);
  return `<div class="card"><div class="row">
<h3>${escapeHtml(r.context_key ?? "unfiled")} <span class="tag">${r.currency}</span></h3>
<span class="tag${Number(r.net_minor) < 0 ? " due" : " ok"}">${money(r.net_minor, r.currency)}</span></div>
<p>in ${money(r.in_minor, r.currency)} · out ${money(r.out_minor, r.currency)}${
    m ? ` · last 30d net ${money(m.net_minor, r.currency)}` : ""}</p></div>`;
}).join("")}

${owed.length ? `<h2>Outstanding</h2>${owed.map((o) => `
<div class="card"><div class="row">
<h3>${escapeHtml(o.counterparty ?? o.note ?? "—")}</h3>
<span class="tag${o.direction === "out" ? " due" : ""}">${o.direction === "in" ? "owed to you" : "you owe"} ${money(o.amount_minor, o.currency)}</span></div>
<p>${o.due_on ? `due ${new Date(o.due_on).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "no date"}${
  o.context_key ? ` · ${escapeHtml(o.context_key)}` : ""}</p></div>`).join("")}` : ""}

${bills.length ? `<h2>Monthly bills</h2>${bills.map((b) => `
<div class="card"><div class="row"><h3>${escapeHtml(b.name)}</h3>
<span class="tag">${money(b.amount_minor, b.currency)}</span></div>
<p>day ${b.day_of_month}</p></div>`).join("")}` : ""}

<h2>Recent</h2>
${entries.length === 0 ? '<p class="empty">Nothing yet.</p>' : entries.map((e) => `
<div class="hit"><time>${new Date(e.occurred_on).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}${
  e.context_key ? ` · ${escapeHtml(e.context_key)}` : ""}${e.settled ? "" : " · UNSETTLED"}</time>
${e.direction === "in" ? "+" : "−"}${money(e.amount_minor, e.currency).replace("-", "")}${
  e.counterparty ? ` · ${escapeHtml(e.counterparty)}` : ""}${e.note ? ` — ${escapeHtml(e.note)}` : ""}</div>`).join("")}
`);
}


export async function deskPage(): Promise<string> {
  const [topics, findings, candidates] = await Promise.all([
    listResearchTopics(), recentFindings(15), listCandidates(true),
  ]);
  const open = candidates.filter((c) => c.status === "proposed");

  return page("Desk", "/desk", `
<h1>Desk</h1>
<p class="muted">Standing questions, answered on a cadence. Each digest is told what the last
one said, so it reports what changed instead of restating the same landscape.</p>

<h2>Tracking</h2>
${topics.map((t) => `<div class="card"><div class="row">
<h3>${escapeHtml(t.name)}</h3><span class="tag">${t.cadence}</span></div>
<p>${escapeHtml(t.brief)}</p>
<p style="margin-top:6px;font-size:.82rem">${t.last_run
  ? `last run ${when(t.last_run)}` : "not run yet"}</p></div>`).join("")}

<h2>Automation candidates${open.length ? ` · ${open.length} open` : ""}</h2>
${candidates.length === 0
  ? '<p class="empty">Nothing proposed yet. The scout runs monthly.</p>'
  : candidates.map((c) => `<div class="card"><div class="row">
<h3>${escapeHtml(c.title)}</h3>
<span class="tag${c.status === "proposed" ? "" : " ok"}">${c.status}${c.effort ? ` · ${c.effort}` : ""}</span></div>
<p><b>Saw:</b> ${escapeHtml(c.observation)}</p>
<p style="margin-top:4px"><b>Do:</b> ${escapeHtml(c.proposal)}</p>
${c.saves ? `<p style="margin-top:4px">Saves ${escapeHtml(c.saves)}</p>` : ""}</div>`).join("")}

<h2>Recent findings</h2>
${findings.length === 0 ? '<p class="empty">Nothing yet — the desk runs at 08:00 daily.</p>' : ""}
${findings.map((f) => `<div class="hit"><time>${when(f.created_at)} · ${escapeHtml(f.name)}</time>
${escapeHtml(f.body_md.slice(0, 900))}</div>`).join("")}
`);
}
