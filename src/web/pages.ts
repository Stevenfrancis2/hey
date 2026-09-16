import { page, escapeHtml, back } from "./layout.js";
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
import { listDecisions, findDecision, listOptions, listAssumptions, payback } from "../memory/decisions.js";
import { today as bodyToday, week as bodyWeek, recentBody } from "../memory/body.js";
import { netWorth } from "../memory/networth.js";
import { farmStatus, filament as farmFilament, low as lowFilament, failures as farmFailures,
         products as farmProducts, globals as farmGlobals, priceList } from "../memory/farm.js";
import { listEvents, connectedAccount } from "../integrations/google.js";
import { snapshots, isConfigured as bambuConfigured, connected as bambuConnected } from "../integrations/bambu.js";

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
  const [tasks, projects, reminders] = await Promise.all([listTasks(), listProjects(), listReminders()]);

  // Printers first. It is the only thing on this page that is happening right
  // now, and the reason he opens it on a phone in the workshop.
  const shots = bambuConfigured() ? snapshots() : [];
  const printing = shots.filter((s) => s.state === "RUNNING");
  const broken = shots.filter((s) => s.hms.length > 0);
  const soonest = [...printing].sort((a, b) => a.remainingMin - b.remainingMin)[0];

  let events: { summary?: string; start: { dateTime?: string; date?: string } }[] = [];
  try {
    if (await connectedAccount()) {
      events = await listEvents({ to: new Date(Date.now() + 864e5), limit: 6 });
    }
  } catch { /* calendar being down must not take the dashboard with it */ }

  const overdue = projects.filter((p) => p.deadline && new Date(p.deadline) < new Date());
  const upcoming = projects.filter((p) => p.deadline && new Date(p.deadline) >= new Date());
  const hhmm = (m: number) => (m <= 0 ? "" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);

  return page("Today", "/", `
<h1>Today</h1>
<p class="muted">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>

${shots.length ? `<a class="card hero" href="/printers">
  <div class="row"><h3>${printing.length} of ${shots.length} printing</h3>
  <span class="tag${broken.length ? " due" : printing.length ? " ok" : ""}">${
    broken.length ? `${broken.length} with errors` : printing.length ? "all good" : "idle"}</span></div>
  ${soonest ? `<p>Next off the plate: <b>${escapeHtml(soonest.name)}</b> in ${hhmm(soonest.remainingMin)}</p>` : `<p>Nothing running.</p>`}
</a>` : ""}

${events.length ? `<h2>Next 24 hours</h2>${events.map((e) => `
<div class="card"><div class="row"><h3>${escapeHtml(e.summary ?? "(no title)")}</h3>
<span class="tag">${e.start.dateTime
  ? new Date(e.start.dateTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  : "all day"}</span></div></div>`).join("")}` : ""}

${overdue.length ? `<h2>Overdue</h2>${overdue.map((p) => `
<div class="card"><div class="row"><h3>${escapeHtml(p.name)}</h3>
<span class="tag due">${daysLeft(p.deadline)}</span></div>
<p>${escapeHtml(p.client ?? p.context_key ?? "")}</p></div>`).join("")}` : ""}

${upcoming.length ? `<h2>Deadlines</h2>${upcoming.slice(0, 5).map((p) => `
<div class="card"><div class="row"><h3>${escapeHtml(p.name)}</h3>
<span class="tag">${daysLeft(p.deadline)}</span></div>
<p>${escapeHtml(p.client ?? p.context_key ?? "")}</p></div>`).join("")}` : ""}

<h2>Next up</h2>
${tasks.length === 0 ? '<p class="empty">Nothing open. Tell him something to do and it lands here.</p>'
  : tasks.slice(0, 8).map((t) => `
<div class="card"><div class="row"><h3>${escapeHtml(t.title)}</h3>
${t.due_at ? `<span class="tag${new Date(t.due_at) < new Date() ? " due" : ""}">${daysLeft(t.due_at)}</span>`
  : `<span class="tag">${escapeHtml(t.context_key ?? "")}</span>`}</div></div>`).join("")}

${reminders.length ? `<h2>Reminders</h2>${reminders.slice(0, 5).map((r) => `
<div class="card"><div class="row"><h3>${escapeHtml(r.text)}</h3>
<span class="tag">${when(r.fire_at)}</span></div></div>`).join("")}` : ""}

<h2>Throw something in</h2>
<p class="muted">Files it away silently — no reply. To actually talk to him, use
<a href="/chat">Chat</a>.</p>
<form method="post" action="/capture">
  <textarea name="text" rows="2" placeholder="An idea, a number, a thing to do…" required></textarea>
  <button type="submit">Capture</button>
</form>
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
  if (!meta) return page("Not found", "/rooms", `${back("/rooms", "Rooms")}<h1>No such room</h1>`);

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
${back("/rooms", "Rooms")}
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
     ORDER BY m.created_at DESC LIMIT 40`, [threadChatId],
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
<span class="who">${m.role === "user" ? "You" : "Jarvis"} · ${when(m.created_at)}</span>
<div class="bubble">${escapeHtml(text)}</div></div>`;
  }).join("");

  return page("Chat", "/chat", `
<div class="chat">
  <div class="log" id="log">${rendered || `<p class="empty">Say something.</p>`}</div>
  <form class="composer" method="post" action="/chat" id="f">
    <textarea name="text" id="ta" rows="1" placeholder="Ask anything…" required autofocus></textarea>
    <div class="tools">
      <button type="button" id="mic" class="icon" title="Tap to talk" aria-label="Record">🎙</button>
      <button type="button" id="spk" class="icon" title="Read replies aloud" aria-label="Speak">🔈</button>
      <span class="grow"></span>
      <button type="submit" id="send">Send</button>
    </div>
  </form>
</div>
<script>
(function(){
  var log=document.getElementById('log'),f=document.getElementById('f');
  var ta=document.getElementById('ta'),send=document.getElementById('send');
  var mic=document.getElementById('mic'),spk=document.getElementById('spk');

  log.scrollTop=log.scrollHeight;

  // He typed a long message, the page reloaded, and he could not tell whether it
  // had gone anywhere. The draft is kept until the message is actually visible
  // in the log, so a failed send, a stray refresh or a closed laptop cannot eat
  // it. Losing what he typed is the one thing this box must never do.
  var DRAFT='chatdraft';
  function lastMine(){
    var all=log.querySelectorAll('.msg.me .bubble');
    return all.length?(all[all.length-1].textContent||'').trim():'';
  }
  try{
    var d=localStorage.getItem(DRAFT);
    if(d){
      if(d.trim()===lastMine()) localStorage.removeItem(DRAFT);
      else ta.value=d;
    }
  }catch(e){}

  function grow(){ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,220)+'px';}
  ta.addEventListener('input',function(){
    grow();
    try{localStorage.setItem(DRAFT,ta.value);}catch(e){}
  });
  grow();
  ta.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(ta.value.trim())f.requestSubmit();}
  });
  // A reply can take ten seconds. Without a pending state that looks identical
  // to a dead page, and he presses Send again and it asks twice.
  f.addEventListener('submit',function(e){
    if(send.disabled){e.preventDefault();return;}
    send.disabled=true;send.textContent='Thinking…';
    // Left enabled but read-only: a disabled field is not submitted, which
    // would post an empty message and lose everything he wrote.
    ta.readOnly=true;
  });

  function clip(){var a=new Audio('/jarvis.mp3');a.play().catch(function(){});}
  if(location.search.indexOf('jarvis=1')>-1){clip();history.replaceState({},'','/chat');}

  // Voice out is the browser's own synthesis: free, instant, offline, and it
  // does not bill him every time the thing opens its mouth.
  var on=false;try{on=localStorage.getItem('speak')==='1';}catch(e){}
  function paint(){spk.textContent=on?'🔊':'🔈';spk.classList.toggle('active',on);}
  function pickVoice(){
    var vs=speechSynthesis.getVoices().filter(function(v){return /^en/i.test(v.lang);});
    var good=vs.filter(function(v){return /natural|neural|google|aria|jenny|guy/i.test(v.name);});
    return good[0]||vs[0]||null;
  }
  function speakLast(){
    var all=log.querySelectorAll('.msg:not(.me) .bubble');
    var last=all[all.length-1];if(!last)return;
    speechSynthesis.cancel();
    var u=new SpeechSynthesisUtterance((last.textContent||'').slice(0,1500));
    var v=pickVoice();if(v)u.voice=v;u.rate=1.02;
    speechSynthesis.speak(u);
  }
  if(!window.speechSynthesis){spk.style.display='none';}else{
    paint();
    spk.addEventListener('click',function(){
      if(speechSynthesis.speaking){speechSynthesis.cancel();}
      on=!on;try{localStorage.setItem('speak',on?'1':'0');}catch(e){}
      paint();if(on)speakLast();
    });
    if(on){
      if(speechSynthesis.getVoices().length===0){
        speechSynthesis.addEventListener('voiceschanged',speakLast,{once:true});
      } else { setTimeout(speakLast,150); }
    }
  }

  var rec=null,chunks=[];
  if(!navigator.mediaDevices||!window.MediaRecorder){mic.style.display='none';}
  mic.addEventListener('click',function(){
    if(rec&&rec.state==='recording'){rec.stop();return;}
    navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
      chunks=[];rec=new MediaRecorder(stream);
      rec.ondataavailable=function(e){if(e.data.size)chunks.push(e.data);};
      rec.onstop=function(){
        stream.getTracks().forEach(function(t){t.stop();});
        mic.textContent='…';mic.disabled=true;mic.classList.remove('rec');
        var fr=new FileReader();
        fr.onloadend=function(){
          fetch('/chat/voice',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({audio:String(fr.result).split(',')[1]})})
            .then(function(r){return r.json();})
            .then(function(d){
              if(d&&d.jarvis)clip();
              setTimeout(function(){location.reload();},d&&d.jarvis?900:0);
            })
            .catch(function(){mic.textContent='🎙';mic.disabled=false;alert('Could not send that.');});
        };
        fr.readAsDataURL(new Blob(chunks,{type:'audio/webm'}));
      };
      rec.start();mic.textContent='⏹';mic.classList.add('rec');
      // A runaway recording is a large upload and a real bill.
      setTimeout(function(){if(rec&&rec.state==='recording')rec.stop();},120000);
    }).catch(function(){alert('Microphone permission denied.');});
  });
})();
</script>
`);
}

export function loginPage(message: string, withPassword = false): string {
  return page("Sign in", "", `
<h1>Sign in</h1>
<div class="flash">${escapeHtml(message)}</div>
${withPassword ? `
<form method="post" action="/login" style="margin-bottom:22px">
  <input type="password" name="password" placeholder="Password" autocomplete="current-password"
         required autofocus>
  <button type="submit">Sign in</button>
</form>
<p class="muted">Or send <b>/login</b> to the bot on Telegram for a one-tap link.</p>` : `
<p class="muted">Send <b>/login</b> to the bot on Telegram. It replies with a link — open it
on this device and you're in for 90 days.</p>`}
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
  const [n, all, month, owed, afford, entries, bills] = await Promise.all([
    netWorth(), moneySummary({}), moneySummary({ days: 30 }), outstanding(),
    affordability("USD"), recentEntries(25), listBills(),
  ]);

  const owedToHim = owed.filter((o) => o.direction === "in");
  const owedByHim = owed.filter((o) => o.direction === "out");
  const usd = (v: number) => `$${v.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
  const KINDS: Record<string, string> = {
    bank: "Bank", cash: "Cash", crypto: "Crypto", stock: "Stocks", other: "Other",
  };

  return page("Money", "/money", `
<h1>Money</h1>

<div class="card hero">
  <div class="row"><h3>Net worth</h3>
    <span class="tag ok">${usd(n.totalUsd)}</span></div>
  <p>${n.holdings.length === 0
      ? `Nothing recorded yet. Tell him what you have — or send a screenshot of your portfolio and he'll read every line off it.`
      : n.byKind.map((k) => `${KINDS[k.kind] ?? k.kind} ${usd(k.usd)}`).join(" · ")}</p>
  ${n.other.length ? `<p>Not converted: ${n.other.map((o) =>
    `${o.currency} ${o.amount.toLocaleString("en-GB")}`).join(" · ")} — no exchange rate worth trusting.</p>` : ""}
</div>

${n.holdings.length ? `<h2>What you own</h2>
${n.holdings.map((h) => `<div class="card"><div class="row">
<h3>${escapeHtml(h.name)}</h3>
<span class="tag${h.stale ? " due" : ""}">${h.usd != null ? usd(h.usd)
  : h.amount_minor != null ? money(h.amount_minor, h.currency) : "—"}</span></div>
<p>${h.symbol && h.quantity != null
    ? `${Number(h.quantity)} ${escapeHtml(h.symbol.toUpperCase())}${h.price ? ` at ${usd(h.price)}` : " · no live price"}`
    : escapeHtml(KINDS[h.kind] ?? h.kind)}${
  h.stale ? " · not updated in over a month" : ""}</p></div>`).join("")}` : ""}

<h2>Cash flow</h2>
<p class="muted">Money owed to you is shown but never counted as available — it isn't yours
until it lands.</p>
<div class="grid">
  <div class="card"><div class="row"><h3>Free to spend</h3>
    <span class="tag${afford.freeMinor < 0 ? " due" : " ok"}">${money(afford.freeMinor)}</span></div>
    <p>cash minus what you owe and monthly bills</p></div>
  <div class="card"><div class="row"><h3>Ledger cash</h3><span class="tag">${money(afford.cashMinor)}</span></div>
    <p>settled, USD</p></div>
  <div class="card"><div class="row"><h3>Owed to you</h3>
    <span class="tag">${money(afford.owedToHimMinor)}</span></div>
    <p>${owedToHim.length} outstanding</p></div>
  <div class="card"><div class="row"><h3>You owe</h3>
    <span class="tag${afford.owedByHimMinor > 0 ? " due" : ""}">${money(afford.owedByHimMinor)}</span></div>
    <p>${owedByHim.length} outstanding · ${money(afford.monthlyBillsMinor)}/mo bills</p></div>
</div>

<h2>By business</h2>
${all.length === 0 ? `<p class="empty">Nothing recorded yet. Tell him: "sold 3 housings for 450".</p>` : ""}
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
${entries.length === 0 ? `<p class="empty">Nothing yet.</p>` : entries.map((e) => `
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


export async function decisionsPage(): Promise<string> {
  const decisions = await listDecisions();
  const open = decisions.find((d) => d.status === "open");
  const detail = open ? await findDecision(open.name) : null;
  const [opts, assumptions] = detail
    ? await Promise.all([listOptions(detail.id), listAssumptions(detail.id)])
    : [[], []];

  return page("Decisions", "/decisions", `
<h1>Decisions</h1>
<p class="muted">The assumptions are the point. Numbers on a page look equally solid whether
they came from a quote or a guess — writing down which is which is what makes the dossier
worth having six months later.</p>

${decisions.length === 0 ? '<p class="empty">Nothing on file.</p>' : ""}
${decisions.map((d) => `<div class="card"><div class="row">
<h3>${escapeHtml(d.name)}</h3>
<span class="tag${d.status === "open" ? "" : " ok"}">${d.chosen ? escapeHtml(d.chosen) : d.status}</span></div>
<p>${escapeHtml(d.question)}</p></div>`).join("")}

${detail && opts.length ? `<h2>Options — ${escapeHtml(detail.name)}</h2>${opts.map((o) => `
<div class="card"><div class="row"><h3>${escapeHtml(o.name)}</h3>
<span class="tag">${payback(o)}</span></div>
${o.summary ? `<p>${escapeHtml(o.summary)}</p>` : ""}
${o.upside ? `<p style="margin-top:4px">+ ${escapeHtml(o.upside)}</p>` : ""}
${o.downside ? `<p style="margin-top:2px">− ${escapeHtml(o.downside)}</p>` : ""}
${o.confidence ? `<p style="margin-top:4px;font-size:.82rem">confidence in the numbers ${o.confidence}/5</p>` : ""}
</div>`).join("")}` : ""}

${detail && assumptions.length ? `<h2>Assumptions — weakest first</h2>${assumptions.map((a) => `
<div class="card" style="border-left:2px solid var(--${(a.confidence ?? 0) <= 2 ? "signal" : "line"})">
<div class="row"><h3>${escapeHtml(a.claim)}</h3>
<span class="tag${(a.confidence ?? 0) <= 2 ? " due" : ""}">${a.confidence ?? "?"}/5</span></div>
<p>${a.basis ? escapeHtml(a.basis) : "<b>No basis recorded — this is a guess.</b>"}</p></div>`).join("")}` : ""}
`);
}

export async function bodyPage(): Promise<string> {
  const [t, w, recent] = await Promise.all([bodyToday(), bodyWeek(), recentBody(30)]);
  return page("Body", "/body", `
<h1>Body</h1>
<div class="grid">
  <div class="card"><div class="row"><h3>Today</h3><span class="tag">${t.calories} cal</span></div>
    <p>${t.protein}g protein · ${t.workouts} workout${t.workouts === 1 ? "" : "s"} · ${t.minutes} min</p></div>
  <div class="card"><div class="row"><h3>This week</h3><span class="tag">${w.workouts} sessions</span></div>
    <p>${w.minutes} min total · ~${w.avgCalories} cal/day</p></div>
  <div class="card"><div class="row"><h3>Weight</h3>
    <span class="tag">${w.latestWeight !== null ? `${w.latestWeight} kg` : "—"}</span></div>
    <p>latest logged</p></div>
</div>
<h2>Recent</h2>
${recent.length === 0 ? '<p class="empty">Nothing logged. Tell the bot: "chest and back, 50 min".</p>' : ""}
${recent.map((r) => `<div class="hit"><time>${new Date(r.happened_on).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${r.kind}</time>
${escapeHtml(r.detail ?? "")}${r.calories ? ` · ${r.calories} cal` : ""}${r.protein_g ? ` · ${r.protein_g}g protein` : ""}${
  r.minutes ? ` · ${r.minutes} min` : ""}${r.weight_kg ? ` · ${r.weight_kg} kg` : ""}</div>`).join("")}
`);
}

export async function farmPage(): Promise<string> {
  const [lines, fails] = await Promise.all([farmFilament(), farmFailures(3650)]);
  const short = lowFilament(lines);
  const stock = lines.reduce((a, l) => a + l.total_g, 0);
  const g = (v: number) => `${Math.round(v)}g`;

  const byBrand = new Map<string, typeof lines>();
  for (const l of lines) {
    const b = l.brand || "Unbranded";
    byBrand.set(b, [...(byBrand.get(b) ?? []), l]);
  }

  const row = (l: (typeof lines)[number]) => `<div class="fil">
  <span class="sw" style="background:#${escapeHtml(l.color_hex || "888888")}"></span>
  <span class="n"><b>${escapeHtml(l.color ?? "")}</b>
    <span>${escapeHtml(l.material)} · ${l.sealed} sealed · ${g(l.open_g)} open</span></span>
  <span class="tag${l.total_g < 400 ? " due" : ""}">${g(l.total_g)}</span>
  <span class="fbtns">
    <form method="post" action="/filament/${l.id}"><input type="hidden" name="delta" value="-1">
      <button title="Used a spool">&minus;</button></form>
    <form method="post" action="/filament/${l.id}"><input type="hidden" name="delta" value="1">
      <button title="Bought a spool">+</button></form>
    <form method="post" action="/filament/${l.id}/open"><button title="Open a sealed spool">open</button></form>
    <form method="post" action="/filament/${l.id}">
      <input type="number" name="grams" placeholder="${Math.round(l.open_g)}g" step="10"
             title="Grams left in the open spool" inputmode="numeric">
      <button>set</button></form>
  </span>
</div>`;

  return page("Filament", "/farm", `
<h1>Filament</h1>
<p class="muted">${(stock / 1000).toFixed(1)} kg across ${lines.length} lines.
Minus when you use a spool, plus when you buy one, <b>open</b> to break the seal,
<b>set</b> to correct the grams left in the open one.</p>

${short.length ? `<h2>Running out</h2>${short.slice(0, 10).map(row).join("")}` : ""}

${[...byBrand.entries()].sort((a, b) => b[1].length - a[1].length).map(([brand, items]) => {
  const kg = items.reduce((a, l) => a + l.total_g, 0) / 1000;
  return `<div class="brand"><h2>${escapeHtml(brand)}</h2>
<span class="tag">${items.length} lines · ${kg.toFixed(1)} kg</span></div>
${items.sort((a, b) => b.total_g - a.total_g).map(row).join("")}`;
}).join("")}

<h2>What the jobs say</h2>
<div class="card">
  <div class="row"><h3>Failure uplift</h3>
  <span class="tag${fails.wasted < fails.assumed ? " due" : ""}">${(fails.assumed * 100).toFixed(0)}% assumed</span></div>
  <p>${fails.failed} of ${fails.jobs} prints failed (${(fails.rate * 100).toFixed(1)}%), dying on average
  ${fails.diedAt}% of the way through — so real filament waste is about
  <b>${(fails.wasted * 100).toFixed(1)}%</b>. Every unit carries roughly
  ${(fails.assumed / (fails.wasted || 1)).toFixed(1)}× more failure cost than it should.</p>
  <p style="margin-top:6px"><a href="/pricing">Change it on Pricing</a></p>
</div>
`);
}


export async function calendarPage(): Promise<string> {
  const account = await connectedAccount();
  if (!account) {
    return page("Calendar", "/calendar", `
<h1>Calendar</h1>
<div class="flash">Google isn't connected. Send <b>/connect</b> to the bot.</div>`);
  }

  let events: Awaited<ReturnType<typeof listEvents>> = [];
  let error = "";
  try {
    events = await listEvents({ to: new Date(Date.now() + 14 * 864e5), limit: 100 });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  // Grouped by day, because a flat list of fourteen days reads as noise and the
  // question is always "what does tomorrow look like", never "what is 31st".
  const days = new Map<string, typeof events>();
  for (const e of events) {
    const start = e.start.dateTime ?? e.start.date;
    if (!start) continue;
    const key = new Date(start).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    days.set(key, [...(days.get(key) ?? []), e]);
  }

  const clock = (e: (typeof events)[number]) =>
    e.start.dateTime
      ? new Date(e.start.dateTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : "all day";

  return page("Calendar", "/calendar", `
<h1>Calendar</h1>
<p class="muted">Next 14 days · ${escapeHtml(account)}</p>
${error ? `<div class="flash">${escapeHtml(error)}</div>` : ""}
${days.size === 0 ? '<p class="empty">Nothing scheduled.</p>' : [...days.entries()].map(([day, list]) => `
<h2>${escapeHtml(day)}</h2>
${list.map((e) => `<div class="card"><div class="row">
<h3>${escapeHtml(e.summary ?? "(no title)")}</h3><span class="tag">${clock(e)}</span></div>
${e.location ? `<p>${escapeHtml(e.location)}</p>` : ""}</div>`).join("")}`).join("")}
`);
}

export async function printersPage(): Promise<string> {
  if (!bambuConfigured()) {
    return page("Printers", "/printers", `
<h1>Printers</h1>
<div class="flash">Bambu Cloud isn't configured, so there's no live status.</div>`);
  }

  const shots = snapshots();
  const live = bambuConnected();
  const running = shots.filter((s) => s.state === "RUNNING").length;
  const errors = shots.filter((s) => s.hms.length > 0).length;

  // Time left is the one number he opens this page for, so it is the biggest
  // thing on the card and everything else is supporting detail.
  const left = (m: number) => {
    if (m <= 0) return "";
    const h = Math.floor(m / 60), r = m % 60;
    return h ? `${h}h ${String(r).padStart(2, "0")}m` : `${r}m`;
  };
  const doneAt = (m: number) =>
    m <= 0 ? "" : new Date(Date.now() + m * 60_000)
      .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const card = (s: (typeof shots)[number]) => {
    const cls = !s.online ? "off" : s.hms.length ? "err" : s.state === "RUNNING" ? "run" : "";
    const label = !s.online ? "offline" : s.stale ? "stale" : s.state.toLowerCase();
    const isRunning = s.state === "RUNNING";
    return `<div class="printer ${cls}">
  ${isRunning && s.hasCover ? `<img class="cover" src="/cover/${s.devId}" alt="" loading="lazy">` : ""}
  <div class="top"><span class="name">${escapeHtml(s.name)}</span>
    <span class="tag${s.hms.length ? " due" : isRunning ? " ok" : ""}">${escapeHtml(label)}</span></div>
  ${isRunning ? `<div class="left"><b>${left(s.remainingMin)}</b>
    <span>${doneAt(s.remainingMin) ? `done ${doneAt(s.remainingMin)}` : ""}</span></div>
  <div class="meter"><i style="width:${Math.max(0, Math.min(100, s.percent))}%"></i></div>` : ""}
  <p class="job">${escapeHtml(s.job || "—")}</p>
  <div class="stats">
    ${isRunning ? `<span>${s.percent}%</span><span>layer ${s.layer}/${s.totalLayers}</span>` : ""}
    <span>N ${s.nozzle}°${s.nozzleTarget ? `/${s.nozzleTarget}` : ""}</span>
    <span>B ${s.bed}°${s.bedTarget ? `/${s.bedTarget}` : ""}</span>
  </div>
  ${s.trays.length ? `<div class="trays">${s.trays.map((t) =>
    `<span class="sw${t.active ? " on" : ""}" style="background:#${escapeHtml(t.color)}"
      title="${escapeHtml(t.type)}${t.remain >= 0 ? ` · ${t.remain}%` : ""}"></span>`).join("")}</div>` : ""}
  ${s.hms.length ? `<div class="hms">${s.hms.slice(0, 3).map((h) =>
    `${escapeHtml(h.severity)}: ${escapeHtml(h.text)}`).join("<br>")}</div>` : ""}
</div>`;
  };

  return page("Printers", "/printers", `
<meta http-equiv="refresh" content="20">
<h1>Printers</h1>
<p class="muted">All eight at once, so you never open Handy to check one.
${running} printing · ${errors} with errors · ${live ? "live" : "reconnecting"} · refreshes every 20s</p>
${shots.length === 0 ? '<p class="empty">Waiting for the first report from Bambu Cloud…</p>'
  : `<div class="pgrid">${shots.map(card).join("")}</div>`}
`);
}

export async function pricingPage(): Promise<string> {
  const [g, items] = await Promise.all([farmGlobals(), priceList()]);
  const num = (name: string, label: string, value: number, step = "0.01") =>
    `<label class="cfg"><span>${label}</span>
      <input type="number" step="${step}" name="${name}" value="${value}" data-k="${name}"
             inputmode="decimal"></label>`;
  const field = (name: string, label: string, extra = "", value = "") =>
    `<label class="cfg"><span>${label}</span><input name="${name}" ${extra} value="${value}"></label>`;

  return page("Pricing", "/pricing", `
<h1>Pricing</h1>
<p class="muted">Every price recalculates as you type. Nothing is saved until you press Save,
so you can push the filament price around and watch the whole list move.</p>

<h2>Shop constants</h2>
<form method="post" action="/pricing/globals" id="g">
  <div class="cfgs">
    ${num("filament_price", "Filament $/kg", g.filament_price)}
    ${num("electricity_price", "Electricity $/kWh", g.electricity_price)}
    ${num("printer_power_kw", "Printer draw kW", g.printer_power_kw)}
    ${num("h2c_multiplier", "H2C multiplier", g.h2c_multiplier)}
    ${num("addon_part_cost", "Add-on part $", g.addon_part_cost)}
    ${num("packaging_cost", "Packaging $/unit", g.packaging_cost)}
    ${num("fail_rate", "Failure uplift", g.fail_rate)}
    ${num("low_markup", "Low markup", g.low_markup, "0.1")}
    ${num("mid_markup", "Mid markup", g.mid_markup, "0.1")}
    ${num("high_markup", "High markup", g.high_markup, "0.1")}
  </div>
  <button type="submit">Save constants</button>
</form>

<h2>Add a product</h2>
<form method="post" action="/pricing/product">
  <div class="cfgs">
    ${field("name", "Name", "type=text required")}
    ${field("filament_g", "Filament g (whole plate)", 'type=number step=1 required inputmode="numeric"')}
    ${field("units_per_print", "Units per plate", 'type=number step=1 required inputmode="numeric"')}
    ${field("days", "Days", 'type=number step=0.5 inputmode="decimal"', "0")}
    ${field("hours", "Hours", 'type=number step=0.5 inputmode="decimal"', "0")}
    ${field("addon_parts_per_unit", "Add-on parts/unit", 'type=number step=1 inputmode="numeric"', "0")}
    ${field("my_price", "Your price $", 'type=number step=0.1 inputmode="decimal"')}
    <label class="cfg" style="flex-direction:row;align-items:center;gap:9px">
      <input type="checkbox" name="h2c" style="width:auto;margin:0"><span>Prints on the H2C</span></label>
  </div>
  <button type="submit">Add it</button>
</form>

<h2>Price list <span class="tag">newest first</span></h2>
${items.length === 0 ? '<p class="empty">Nothing priced yet.</p>' : ""}
${items.map((p: { id: string; name: string; h2c: boolean; filament_g: unknown; units_per_print: unknown;
                  days: unknown; hours: unknown; addon_parts_per_unit: unknown; my_price: unknown }) => `<div class="card prod"
  data-f="${Number(p.filament_g ?? 0)}" data-u="${Number(p.units_per_print ?? 0)}"
  data-h="${Number(p.days ?? 0) * 24 + Number(p.hours ?? 0)}"
  data-a="${Number(p.addon_parts_per_unit ?? 0)}" data-p="${p.my_price == null ? "" : Number(p.my_price)}"
  data-c="${p.h2c ? 1 : 0}">
<div class="row"><h3>${escapeHtml(p.name)}${p.h2c ? " · H2C" : ""}</h3>
  <span class="tag mk">—</span></div>
<p>${String(p.units_per_print ?? "—")} units · ${String(p.filament_g ?? "—")}g ·
  ${Number(p.days ?? 0) * 24 + Number(p.hours ?? 0)}h</p>
<p class="calc">—</p>
<form method="post" action="/pricing/product/${p.id}/delete" style="margin-top:8px">
  <button type="submit" class="ghost">Delete</button></form></div>`).join("")}

<script>
// His formula from pricing.py, run in the browser so a constant can be dragged
// around and the whole list answers instantly. Nothing here persists anything —
// Save is still the only thing that writes.
(function(){
  var f=document.getElementById('g');
  function v(k){var e=f.querySelector('[data-k="'+k+'"]');return e?parseFloat(e.value)||0:0;}
  function money(x){return '$'+x.toFixed(2);}
  function paint(){
    var G={fil:v('filament_price'),kw:v('printer_power_kw'),el:v('electricity_price'),
           h2c:v('h2c_multiplier'),ad:v('addon_part_cost'),pk:v('packaging_cost'),
           fr:v('fail_rate'),m2:v('low_markup'),m3:v('mid_markup'),m4:v('high_markup')};
    document.querySelectorAll('.prod').forEach(function(el){
      var fg=+el.dataset.f,u=+el.dataset.u,h=+el.dataset.h,a=+el.dataset.a,c=+el.dataset.c;
      var price=el.dataset.p===''?null:+el.dataset.p;
      var out=el.querySelector('.calc'),mk=el.querySelector('.mk');
      if(!u||!fg){out.textContent='Needs filament grams and units per plate.';mk.textContent='—';return;}
      var total=((fg/1000*G.fil + h*G.kw*G.el*(c?G.h2c:1))/u + a*G.ad)*(1+G.fr)+G.pk;
      var s='cost '+money(total)+'/unit · 2x '+money(total*G.m2)+' · 3x '+money(total*G.m3)+
            ' · 4x '+money(total*G.m4);
      if(price){
        var markup=total?price/total:0;
        s+=' · you charge '+money(price)+', profit '+money(price-total);
        mk.textContent=markup.toFixed(1)+'x';
        mk.className='tag mk '+(markup<G.m2?'due':'ok');
      } else { mk.textContent='no price'; mk.className='tag mk'; }
      out.textContent=s;
    });
  }
  f.addEventListener('input',paint);
  paint();
})();
</script>
`);
}
