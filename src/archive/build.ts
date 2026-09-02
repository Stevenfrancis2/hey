import { query } from "../db/index.js";
import { loadProfile } from "../agent/prompt.js";

/**
 * The plain-text mirror.
 *
 * The database is the working store; these files are the durable copy. They
 * open in any text editor on any device with no software, no server and no
 * account — which is the whole point. If everything else is lost, this is what
 * survives, and none of the thinking has to happen twice.
 */

type Row = Record<string, unknown>;

function heading(text: string): string {
  return `\n\n## ${text}\n`;
}

function day(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10);
}

function stamp(d: Date | string): string {
  return new Date(d).toISOString().replace("T", " ").slice(0, 16);
}

/**
 * A capture with no text still has to appear. A voice note whose transcription
 * failed used to be filtered out of the readable archive entirely — the file said
 * nothing was there, which is worse than saying the words were lost.
 */
function bodyOf(c: Row): string {
  const text = (c.raw_text as string | null) ?? "";
  if (text.trim()) return text;
  const kind = (c.kind as string) ?? "capture";
  const why = c.error ? `: ${c.error}` : c.status === "pending" ? ", not yet processed" : "";
  return `_[${kind} with no text${why}]_`;
}

export async function buildMarkdown(): Promise<string> {
  const generatedAt = new Date().toISOString();

  const [profile, captures, tasks, reminders, projects, watch, convo, rooms] = await Promise.all([
    loadProfile(),
    query<Row>(
      `SELECT c.captured_at, c.kind, c.raw_text, c.status, c.error,
              ctx.key AS room, e.intent, e.summary, e.tags
       FROM captures c
       LEFT JOIN capture_enrichment e ON e.capture_id = c.id
       LEFT JOIN contexts ctx ON ctx.id = e.context_id
       ORDER BY c.captured_at ASC`,
    ),
    query<Row>(
      `SELECT t.title, t.detail, t.status, t.priority, t.due_at, t.created_at, t.completed_at,
              ctx.key AS room, p.name AS project
       FROM tasks t
       LEFT JOIN contexts ctx ON ctx.id = t.context_id
       LEFT JOIN projects p ON p.id = t.project_id
       ORDER BY (t.status IN ('open','doing')) DESC, t.due_at NULLS LAST, t.created_at`,
    ),
    query<Row>(`SELECT text, fire_at, status FROM reminders ORDER BY fire_at`),
    query<Row>(
      `SELECT p.key, p.name, p.client, p.description, p.status, p.deadline, p.started_at,
              ctx.key AS room
       FROM projects p LEFT JOIN contexts ctx ON ctx.id = p.context_id
       ORDER BY (p.status = 'active') DESC, p.deadline NULLS LAST`,
    ),
    query<Row>(
      `SELECT kind, symbol, name, thesis, added_at FROM watchlist
       WHERE active ORDER BY kind, name`,
    ),
    query<Row>(
      `SELECT m.role, m.content, m.created_at FROM messages m ORDER BY m.created_at ASC`,
    ),
    query<Row>(`SELECT key, name, description FROM contexts WHERE active ORDER BY key`),
  ]);

  const out: string[] = [];

  out.push(`# Second Steven — full archive

Generated ${generatedAt}

This file is the durable copy of everything in the system. It is plain text on
purpose: it opens anywhere, on anything, with no software and no account. If the
database, the server and the bot all disappear tomorrow, this file is enough to
pick up exactly where you left off — and none of the thinking has to happen twice.

Contents: your profile, every project, every capture grouped by room and by day,
all tasks and reminders, the watchlist, and the full conversation history.
A machine-readable copy of the same data ships alongside it as JSON.`);

  out.push(heading("Profile"));
  out.push(profile);

  out.push(heading("Rooms"));
  for (const r of rooms) out.push(`- **${r.key}** — ${r.name}. ${r.description ?? ""}`);

  out.push(heading("Projects"));
  if (projects.length === 0) out.push("_None yet._");
  for (const p of projects) {
    out.push(
      `\n### ${p.name} \`${p.key}\`\n` +
        `- Status: ${p.status}${p.deadline ? ` · **Deadline ${stamp(p.deadline as string)}**` : ""}\n` +
        `- Room: ${p.room ?? "—"}${p.client ? ` · Client: ${p.client}` : ""}\n` +
        (p.description ? `\n${p.description}\n` : ""),
    );
  }

  out.push(heading("Tasks"));
  const open = tasks.filter((t) => t.status === "open" || t.status === "doing");
  const closed = tasks.filter((t) => t.status !== "open" && t.status !== "doing");
  out.push(`\n### Open (${open.length})\n`);
  for (const t of open) {
    out.push(
      `- [ ] **${t.title}**${t.room ? ` \`${t.room}\`` : ""}` +
        `${t.due_at ? ` — due ${stamp(t.due_at as string)}` : ""}` +
        `${t.project ? ` — ${t.project}` : ""}` +
        `${t.detail ? `\n      ${t.detail}` : ""}`,
    );
  }
  out.push(`\n### Closed (${closed.length})\n`);
  for (const t of closed) out.push(`- [x] ${t.title}${t.room ? ` \`${t.room}\`` : ""}`);

  out.push(heading("Reminders"));
  for (const r of reminders) out.push(`- ${stamp(r.fire_at as string)} — ${r.text} _(${r.status})_`);

  out.push(heading("Watchlist"));
  if (watch.length === 0) out.push("_Nothing tracked yet._");
  for (const w of watch) {
    out.push(
      `- **${w.name}**${w.symbol ? ` (${w.symbol})` : ""} — _${w.kind}_` +
        `${w.thesis ? `\n      Why: ${w.thesis}` : ""}`,
    );
  }

  // ── captures, grouped two ways so either question is answerable ──
  out.push(heading("Everything captured, by room"));
  const byRoom = new Map<string, Row[]>();
  for (const c of captures) {
    const key = (c.room as string) ?? "unfiled";
    byRoom.set(key, [...(byRoom.get(key) ?? []), c]);
  }
  for (const [room, items] of [...byRoom.entries()].sort()) {
    out.push(`\n### ${room} (${items.length})\n`);
    for (const c of items) {
      out.push(
        `**${stamp(c.captured_at as string)}**${c.kind === "voice" ? " 🎙" : ""}` +
          `${c.intent ? ` · ${c.intent}` : ""}\n\n${bodyOf(c)}\n`,
      );
    }
  }

  out.push(heading("Everything captured, by day"));
  const byDay = new Map<string, Row[]>();
  for (const c of captures) {
    const key = day(c.captured_at as string);
    byDay.set(key, [...(byDay.get(key) ?? []), c]);
  }
  for (const [d, items] of [...byDay.entries()].sort()) {
    out.push(`\n### ${d}\n`);
    for (const c of items) {
      out.push(`- \`${stamp(c.captured_at as string).slice(11)}\` ${c.summary ?? bodyOf(c)}`);
    }
  }

  out.push(heading("Conversations"));
  for (const m of convo) {
    const blocks = m.content as unknown;
    let text = "";
    if (typeof blocks === "string") text = blocks;
    else if (Array.isArray(blocks)) {
      text = blocks
        .filter((b) => (b as Row).type === "text")
        .map((b) => (b as Row).text)
        .join("\n");
    }
    if (!text.trim()) continue;
    out.push(`\n**${m.role === "user" ? "Steven" : "Second Steven"}** · ${stamp(m.created_at as string)}\n\n${text}\n`);
  }

  return out.join("\n");
}

/**
 * Never leaves the database.
 *
 * `oauth_tokens` holds live Google refresh tokens and this file is delivered over
 * Telegram — archiving it would post working credentials into a chat. The other two
 * are bookkeeping about the system rather than anything of his.
 */
const NEVER_ARCHIVE = new Set(["oauth_tokens", "llm_calls", "archive_runs"]);

/**
 * The same data, machine-restorable. Markdown is for you; this is for a rebuild.
 *
 * The table list is read from the database rather than hand-maintained. It used to
 * be a literal array, which had silently fallen 22 tables behind the schema — the
 * ledger, every study table, gear, decisions and the dough log were all absent from
 * the one file that is supposed to guarantee nothing is trapped. A new table now
 * joins the archive by existing.
 */
export async function buildJson(): Promise<string> {
  const tableRows = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  const tables = tableRows.map((r) => r.table_name).filter((t) => !NEVER_ARCHIVE.has(t));

  const dump: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    note: "Restorable dump. Embeddings are omitted — they are derived and can be rebuilt.",
    tables: tables.length,
  };

  for (const table of tables) {
    // Embeddings are large and regenerable; leaving them out keeps this readable.
    // `jsonb - key` is a no-op on tables that have no embedding column.
    dump[table] = (
      await query<{ row: unknown }>(`SELECT to_jsonb(t) - 'embedding' AS row FROM "${table}" t`)
    ).map((r) => r.row);
  }

  return JSON.stringify(dump, null, 2);
}
