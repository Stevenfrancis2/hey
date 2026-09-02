import { Bot, type Context } from "grammy";
import { config } from "../config.js";
import { log } from "../log.js";
import { recordCapture, stats, type CaptureKind } from "../memory/capture.js";
import { enqueueEnrich } from "../jobs/index.js";
import { recall, recent } from "../memory/recall.js";
import { listTasks } from "../memory/tasks.js";
import { costSummary } from "../agent/client.js";
import { sendBrief } from "../jobs/brief.js";
import { runArchive } from "../jobs/archive.js";
import { listProjects } from "../memory/projects.js";
import { issueLoginToken } from "../web/auth.js";
import { flyability, formatFlyability } from "../integrations/weather.js";
import { listGear } from "../memory/gear.js";
import { findGoal, listTopics, progress, dueCards } from "../memory/study.js";
import { summary as moneySummary, outstanding, affordability, money } from "../memory/money.js";
import { runResearch, runScout } from "../jobs/research.js";

export const bot = new Bot(config.telegram.token);

// ── Single user. Everyone else gets silence. ──────────────
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== config.telegram.ownerId) {
    log.warn({ from: ctx.from?.id, username: ctx.from?.username }, "ignored stranger");
    return;
  }
  await next();
});

/**
 * Who actually said this. A forwarded voice note from his father or a supplier is
 * someone else's words — attributing it means he can send it instead of retyping
 * what they told him.
 */
function authorOf(message: { forward_origin?: unknown }): string | null {
  const origin = message.forward_origin as
    | { type: string; sender_user?: { first_name: string; last_name?: string };
        sender_user_name?: string; sender_chat?: { title?: string }; chat?: { title?: string } }
    | undefined;
  if (!origin) return null;
  switch (origin.type) {
    case "user":
      return [origin.sender_user?.first_name, origin.sender_user?.last_name]
        .filter(Boolean).join(" ") || "someone";
    case "hidden_user":
      return origin.sender_user_name ?? "someone";
    case "chat":
      return origin.sender_chat?.title ?? "a group";
    case "channel":
      return origin.chat?.title ?? "a channel";
    default:
      return "someone";
  }
}

/** A reaction is the lowest-friction acknowledgement: no message clutter. */
async function ack(ctx: Context): Promise<void> {
  try {
    await ctx.react("👌");
  } catch {
    // Reactions can fail (older clients, edited messages). Not worth surfacing.
  }
}

function formatHits(hits: Awaited<ReturnType<typeof recall>>): string {
  if (hits.length === 0) return "Nothing in there yet about that.";
  return hits
    .map((hit) => {
      const when = new Date(hit.captured_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const mark = hit.kind === "voice" ? "🎙" : "·";
      const body = hit.text.length > 400 ? `${hit.text.slice(0, 400)}…` : hit.text;
      return `${mark} <b>${when}</b>\n${escapeHtml(body)}`;
    })
    .join("\n\n");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Commands ──────────────────────────────────────────────
bot.command("start", async (ctx) => {
  await ctx.reply(
    [
      "<b>Second Steven</b> — phase 0.",
      "",
      "Send me anything: type it, or hold the mic and talk. Ideas, tasks, links,",
      "photos of a broken arm, a dough batch that worked. I store all of it and",
      "make it findable. I won't ask you to categorise anything.",
      "",
      "You never have to choose between noting something and asking something.",
      "I keep everything, and I answer when you actually asked.",
      "",
      "<b>/recall</b> &lt;anything&gt; — search everything you've ever sent",
      "<b>/desk</b> — run the research desk now",
      "<b>/money</b> — the books, and what you can spend",
      "<b>/study</b> — the plan, and whether you're on track",
      "<b>/fly</b> — can I fly, per quad",
      "<b>/gear</b> — the fleet",
      "<b>/tasks</b> — what's open, by room",
      "<b>/projects</b> — projects and deadlines",
      "<b>/export</b> — everything, as files, right now",
      "<b>/login</b> — open the console on this device",
      "<b>/brief</b> — today's brief now",
      "<b>/recent</b> — the last ten things",
      "<b>/stats</b> — what's in the brain",
      "<b>/costs</b> — what it's spending",
    ].join("\n"),
    { parse_mode: "HTML" },
  );
});

bot.command("help", (ctx) =>
  ctx.reply("/money · /study · /fly · /gear · /desk · /recall <q> · /tasks · /projects · /brief · /export · /login"),
);

bot.command("desk", async (ctx) => {
  await ctx.replyWithChatAction("typing");
  await runResearch(ctx.api, ctx.chat.id, "daily");
});

bot.command("scout", async (ctx) => {
  await ctx.replyWithChatAction("typing");
  await runScout(ctx.api, ctx.chat.id);
});

bot.command("money", async (ctx) => {
  const [rows, owed, afford] = await Promise.all([
    moneySummary({}), outstanding(), affordability("USD"),
  ]);
  if (rows.length === 0) {
    await ctx.reply('Nothing recorded yet. Just tell me: "sold 3 housings to the retail store for 450".');
    return;
  }
  await ctx.reply(
    [
      `<b>Free to spend  ${money(afford.freeMinor)}</b>`,
      `cash ${money(afford.cashMinor)} · you owe ${money(afford.owedByHimMinor)} · bills ${money(afford.monthlyBillsMinor)}/mo`,
      afford.owedToHimMinor > 0
        ? `owed to you ${money(afford.owedToHimMinor)} <i>(not counted)</i>` : "",
      "",
      ...rows.map((r) =>
        `<b>${escapeHtml(r.context_key ?? "unfiled")}</b> ${money(r.net_minor, r.currency)}` +
        `  <i>in ${money(r.in_minor, r.currency)} · out ${money(r.out_minor, r.currency)}</i>`),
      owed.length ? `\n${owed.length} outstanding — /login to see them` : "",
    ].filter(Boolean).join("\n"),
    { parse_mode: "HTML" },
  );
});

bot.command("study", async (ctx) => {
  const goal = await findGoal(null);
  if (!goal) {
    await ctx.reply("No study plan yet. Tell me what you need to learn and by when.");
    return;
  }
  const [topics, p, due] = await Promise.all([
    listTopics(goal.id), progress(goal.id), dueCards(goal.id, 50),
  ]);
  const next = topics.filter((t) => t.status !== "done").slice(0, 3);
  const behind = p.requiredHoursPerDay !== null &&
                 p.requiredHoursPerDay > Number(goal.hours_per_day);
  await ctx.reply(
    [
      `<b>${escapeHtml(goal.name)}</b>`,
      `${p.topicsDone}/${p.topicsTotal} topics · ${p.doneHours}/${p.totalHours}h` +
        `${p.daysLeft !== null ? ` · ${p.daysLeft}d left` : ""}`,
      `${Math.round(p.studiedHours7d * 10) / 10}h studied this week · ${due.length} cards due`,
      behind
        ? `\n⚠️ needs <b>${p.requiredHoursPerDay}h/day</b> but the plan assumes ${goal.hours_per_day}h`
        : `\nneeds ${p.requiredHoursPerDay ?? "—"}h/day — on track`,
      "",
      "<b>Next</b>",
      ...next.map((t) => `· ${escapeHtml(t.name)} (${t.est_hours}h)`),
    ].join("\n"),
    { parse_mode: "HTML" },
  );
});

bot.command("fly", async (ctx) => {
  await ctx.replyWithChatAction("typing");
  try {
    await ctx.reply(formatFlyability(await flyability(2)));
  } catch (err) {
    log.error({ err }, "flyability failed");
    await ctx.reply("Couldn't reach the weather service just now.");
  }
});

bot.command("gear", async (ctx) => {
  const gear = await listGear();
  const byKind = new Map<string, string[]>();
  for (const g of gear) {
    const line =
      `· ${escapeHtml(`${g.brand ?? ""} ${g.model}`.trim())}` +
      `${g.quantity > 1 ? ` ×${g.quantity}` : ""}` +
      `${g.status !== "active" ? ` <i>(${g.status})</i>` : ""}` +
      `${g.specs.wind_limit_kmh ? ` — wind ≤${g.specs.wind_limit_kmh}` : ""}`;
    byKind.set(g.kind, [...(byKind.get(g.kind) ?? []), line]);
  }
  const body = [...byKind.entries()]
    .map(([kind, lines]) => `<b>${kind}</b>\n${lines.join("\n")}`)
    .join("\n\n");
  await ctx.reply(body || "Nothing recorded yet.", { parse_mode: "HTML" });
});

bot.command("projects", async (ctx) => {
  const projects = await listProjects();
  if (projects.length === 0) {
    await ctx.reply("No projects yet. Tell me about one and I'll set it up.");
    return;
  }
  const body = projects
    .map((p) => {
      const days =
        p.deadline != null
          ? Math.ceil((new Date(p.deadline).getTime() - Date.now()) / 864e5)
          : null;
      const when =
        days === null ? "no deadline" : days < 0 ? `<b>${-days}d overdue</b>` : `${days}d left`;
      return `· <b>${escapeHtml(p.name)}</b> — ${when}${p.client ? ` · ${escapeHtml(p.client)}` : ""}`;
    })
    .join("\n");
  await ctx.reply(body, { parse_mode: "HTML" });
});

bot.command("login", async (ctx) => {
  if (!config.publicUrl) {
    await ctx.reply("The console isn't deployed yet — PUBLIC_URL is not set.");
    return;
  }
  const url = `${config.publicUrl.replace(/\/$/, "")}/login?t=${issueLoginToken()}`;
  await ctx.reply(
    `Open this on whichever device you're on — phone, iPad, laptop, desktop.\n\n${url}\n\n` +
      `Good for 10 minutes, then you're signed in for 90 days.`,
    { link_preview_options: { is_disabled: true } },
  );
});

bot.command("export", async (ctx) => {
  await ctx.replyWithChatAction("upload_document");
  await runArchive(ctx.api, ctx.chat.id);
});

bot.command("tasks", async (ctx) => {
  const tasks = await listTasks();
  if (tasks.length === 0) {
    await ctx.reply("Nothing open.");
    return;
  }
  const byRoom = new Map<string, string[]>();
  for (const task of tasks) {
    const room = task.context_key ?? "unfiled";
    const due = task.due_at
      ? ` — ${new Date(task.due_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
      : "";
    byRoom.set(room, [...(byRoom.get(room) ?? []), `· ${escapeHtml(task.title)}${due}`]);
  }
  const body = [...byRoom.entries()]
    .map(([room, lines]) => `<b>${room}</b>\n${lines.join("\n")}`)
    .join("\n\n");
  await ctx.reply(body, { parse_mode: "HTML" });
});

bot.command("brief", async (ctx) => {
  await ctx.replyWithChatAction("typing");
  await sendBrief(ctx.api, ctx.chat.id, "morning");
});

bot.command("costs", async (ctx) => {
  const costs = await costSummary();
  await ctx.reply(
    [
      `today  <b>$${costs.today.toFixed(3)}</b> over ${costs.calls} calls`,
      `month  <b>$${costs.month.toFixed(2)}</b>`,
    ].join("\n"),
    { parse_mode: "HTML" },
  );
});

bot.command("recall", async (ctx) => {
  const question = ctx.match?.trim();
  if (!question) {
    await ctx.reply("What should I look for? e.g. <code>/recall dough hydration</code>", {
      parse_mode: "HTML",
    });
    return;
  }
  await ctx.replyWithChatAction("typing");
  try {
    const hits = await recall(question);
    await ctx.reply(formatHits(hits), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (err) {
    log.error({ err }, "recall failed");
    await ctx.reply("Search is down — the capture still works, nothing was lost.");
  }
});

bot.command("recent", async (ctx) => {
  const hits = await recent(10);
  await ctx.reply(formatHits(hits), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
});

bot.command("stats", async (ctx) => {
  const s = await stats();
  const since = s.oldest
    ? new Date(s.oldest).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";
  await ctx.reply(
    [
      `<b>${s.captures}</b> captures · <b>${s.voice}</b> spoken`,
      `<b>${s.chunks}</b> indexed chunks`,
      s.pending > 0 ? `<b>${s.pending}</b> still processing` : "all processed",
      `collecting since ${since}`,
    ].join("\n"),
    { parse_mode: "HTML" },
  );
});

// ── Capture ───────────────────────────────────────────────
async function capture(
  ctx: { message?: { message_id: number }; chat?: { id: number } },
  kind: CaptureKind,
  rawText: string | null,
  media?: { fileId: string; mime?: string; duration?: number },
  author?: string | null,
): Promise<void> {
  const messageId = ctx.message?.message_id;
  const chatId = ctx.chat?.id;
  if (messageId === undefined || chatId === undefined) return;

  const id = await recordCapture({
    telegramMessageId: messageId,
    chatId,
    kind,
    rawText,
    mediaFileId: media?.fileId ?? null,
    mediaMime: media?.mime ?? null,
    durationSeconds: media?.duration ?? null,
    author: author ?? null,
  });

  // Fire-and-forget: the acknowledgement must not wait on the queue.
  void enqueueEnrich(id).catch((err) => log.error({ err, id }, "enqueue failed"));
  log.info({ id, kind }, "captured");
}

bot.on("message:voice", async (ctx) => {
  await ack(ctx);
  await capture(ctx, "voice", ctx.message.caption ?? null, {
    fileId: ctx.message.voice.file_id,
    mime: ctx.message.voice.mime_type,
    duration: ctx.message.voice.duration,
  }, authorOf(ctx.message));
});

bot.on("message:audio", async (ctx) => {
  await ack(ctx);
  await capture(ctx, "voice", ctx.message.caption ?? null, {
    fileId: ctx.message.audio.file_id,
    mime: ctx.message.audio.mime_type,
    duration: ctx.message.audio.duration,
  }, authorOf(ctx.message));
});

bot.on("message:photo", async (ctx) => {
  await ack(ctx);
  const largest = ctx.message.photo.at(-1);
  await capture(ctx, "photo", ctx.message.caption ?? null,
    largest ? { fileId: largest.file_id } : undefined, authorOf(ctx.message));
});

bot.on("message:document", async (ctx) => {
  await ack(ctx);
  await capture(ctx, "document", ctx.message.caption ?? null, {
    fileId: ctx.message.document.file_id,
    mime: ctx.message.document.mime_type,
  }, authorOf(ctx.message));
});

bot.on("message:text", async (ctx) => {
  await ack(ctx);
  const author = authorOf(ctx.message);
  await capture(ctx, author ? "forward" : "text", ctx.message.text, undefined, author);
});

bot.catch((err) => log.error({ err: err.error, update: err.ctx.update.update_id }, "bot error"));
