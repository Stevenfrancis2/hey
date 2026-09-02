import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { recall } from "../memory/recall.js";
import { createTask, listTasks, completeTask, snoozeTask } from "../memory/tasks.js";
import { createReminder, listReminders, cancelReminder } from "../memory/reminders.js";
import { createProject, listProjects, updateProject } from "../memory/projects.js";
import { addToWatchlist, listWatchlist, removeFromWatchlist } from "../memory/watchlist.js";
import { listGear, addGear, setGearStatus } from "../memory/gear.js";
import { flyability, formatFlyability } from "../integrations/weather.js";
import {
  record as recordMoney, summary as moneySummary, outstanding, settle,
  recentEntries, affordability, addBill, listBills, money, fromMinor,
} from "../memory/money.js";
import {
  createGoal, findGoal, setTopics, listTopics, completeTopic, addMaterial, listMaterials,
  logSession, progress, addCard, dueCards, gradeCard,
} from "../memory/study.js";
import { CONTEXT_KEYS } from "./classify.js";
import { log } from "../log.js";

const ContextKey = z.enum(CONTEXT_KEYS);

function formatDate(d: Date | null): string {
  return d ? d.toISOString().replace("T", " ").slice(0, 16) : "no date";
}

export const recallTool = betaZodTool({
  name: "recall",
  description:
    "Search everything Steven has ever captured — notes, voice notes, logs. " +
    "Use this before answering anything about his businesses, projects, past decisions " +
    "or anything he has told you before. Prefer searching over guessing.",
  inputSchema: z.object({
    query: z.string().describe("What to look for, in natural language"),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  run: async ({ query, limit }) => {
    const hits = await recall(query, limit ?? 8);
    if (hits.length === 0) return "Nothing found.";
    return hits
      .map((h) => `[${new Date(h.captured_at).toISOString().slice(0, 10)}] ${h.text}`)
      .join("\n---\n");
  },
});

export const createTaskTool = betaZodTool({
  name: "create_task",
  description:
    "Record something Steven has to do. Use for anything actionable he mentions, " +
    "even in passing. Do not use for reminders at a specific time — use set_reminder.",
  inputSchema: z.object({
    title: z.string().describe("Short, imperative, in his words"),
    detail: z.string().optional(),
    context: ContextKey.optional().describe("Which room it belongs to"),
    priority: z.number().int().min(0).max(3).optional().describe("0 whenever, 3 today"),
    due_date: z.string().optional().describe("ISO 8601 date or datetime, if there is a deadline"),
  }),
  run: async (input) => {
    const task = await createTask({
      title: input.title,
      detail: input.detail ?? null,
      contextKey: input.context ?? null,
      priority: input.priority ?? 1,
      dueAt: input.due_date ? new Date(input.due_date) : null,
    });
    return `Created task "${task.title}" (${task.context_key ?? "no room"}, due ${formatDate(task.due_at)}).`;
  },
});

export const listTasksTool = betaZodTool({
  name: "list_tasks",
  description: "List Steven's open tasks, optionally filtered by room or by what is due soon.",
  inputSchema: z.object({
    context: ContextKey.optional(),
    due_within_days: z.number().int().min(0).max(365).optional(),
  }),
  run: async (input) => {
    const tasks = await listTasks({
      contextKey: input.context ?? null,
      dueWithinDays: input.due_within_days ?? null,
    });
    if (tasks.length === 0) return "No open tasks.";
    return tasks
      .map((t) => `- [${t.context_key ?? "—"}] ${t.title} (due ${formatDate(t.due_at)}, p${t.priority})`)
      .join("\n");
  },
});

export const completeTaskTool = betaZodTool({
  name: "complete_task",
  description: "Mark a task done. Matches loosely on the title, so Steven's phrasing is enough.",
  inputSchema: z.object({ title: z.string() }),
  run: async ({ title }) => {
    const task = await completeTask(title);
    return task ? `Done: "${task.title}".` : `No open task matching "${title}".`;
  },
});

export const snoozeTaskTool = betaZodTool({
  name: "snooze_task",
  description: "Hide a task until a later date.",
  inputSchema: z.object({ title: z.string(), until: z.string().describe("ISO 8601 datetime") }),
  run: async ({ title, until }) => {
    const task = await snoozeTask(title, new Date(until));
    return task ? `Snoozed "${task.title}" until ${until}.` : `No open task matching "${title}".`;
  },
});

export const setReminderTool = betaZodTool({
  name: "set_reminder",
  description:
    "Send Steven a message at a specific time. Resolve relative times ('tomorrow morning', " +
    "'in 3 hours') against the current time given in your context, and pass an absolute time.",
  inputSchema: z.object({
    text: z.string().describe("What to say to him when it fires"),
    fire_at: z.string().describe("Absolute ISO 8601 datetime with timezone offset"),
  }),
  run: async ({ text, fire_at }) => {
    const when = new Date(fire_at);
    if (Number.isNaN(when.getTime())) return `"${fire_at}" is not a valid datetime.`;
    if (when.getTime() < Date.now() - 60_000) return `${fire_at} is in the past.`;
    const reminder = await createReminder(text, when);
    return `Reminder set for ${formatDate(reminder.fire_at)}: "${reminder.text}".`;
  },
});

export const listRemindersTool = betaZodTool({
  name: "list_reminders",
  description: "List reminders that have not fired yet.",
  inputSchema: z.object({}),
  run: async () => {
    const reminders = await listReminders();
    if (reminders.length === 0) return "No reminders scheduled.";
    return reminders.map((r) => `- ${formatDate(r.fire_at)} — ${r.text}`).join("\n");
  },
});

export const cancelReminderTool = betaZodTool({
  name: "cancel_reminder",
  description: "Cancel a scheduled reminder, matched loosely on its text.",
  inputSchema: z.object({ text: z.string() }),
  run: async ({ text }) => {
    const reminder = await cancelReminder(text);
    return reminder ? `Cancelled: "${reminder.text}".` : `No reminder matching "${text}".`;
  },
});


// ── projects ──────────────────────────────────────────────
export const createProjectTool = betaZodTool({
  name: "create_project",
  description:
    "Record a piece of work with a name and usually a deadline — a client job, a build, " +
    "a study goal. Use whenever Steven mentions a project, so tasks and notes can hang off it. " +
    "Calling it again with the same name updates that project rather than duplicating it.",
  inputSchema: z.object({
    name: z.string(),
    context: ContextKey.optional(),
    client: z.string().optional(),
    description: z.string().optional().describe("What it is and what done looks like"),
    deadline: z.string().optional().describe("ISO 8601 date or datetime"),
  }),
  run: async (input) => {
    const project = await createProject({
      name: input.name,
      contextKey: input.context ?? null,
      client: input.client ?? null,
      description: input.description ?? null,
      deadline: input.deadline ? new Date(input.deadline) : null,
    });
    return `Project "${project.name}" (${project.key}) in ${project.context_key ?? "no room"}` +
      `${project.deadline ? `, due ${formatDate(project.deadline)}` : ", no deadline"}.`;
  },
});

export const listProjectsTool = betaZodTool({
  name: "list_projects",
  description: "List Steven's projects and their deadlines.",
  inputSchema: z.object({ include_finished: z.boolean().optional() }),
  run: async ({ include_finished }) => {
    const projects = await listProjects(include_finished ?? false);
    if (projects.length === 0) return "No projects.";
    return projects
      .map((p) => {
        const days =
          p.deadline != null
            ? Math.ceil((new Date(p.deadline).getTime() - Date.now()) / 864e5)
            : null;
        const when = days === null ? "no deadline" : days < 0 ? `${-days}d OVERDUE` : `${days}d left`;
        return `- ${p.name} [${p.status}] ${when}${p.client ? ` · ${p.client}` : ""}` +
          `${p.context_key ? ` · ${p.context_key}` : ""}`;
      })
      .join("\n");
  },
});

export const updateProjectTool = betaZodTool({
  name: "update_project",
  description: "Change a project's status, deadline or description. Matches loosely on the name.",
  inputSchema: z.object({
    name: z.string(),
    status: z.enum(["active", "paused", "done", "dropped"]).optional(),
    deadline: z.string().optional().describe("ISO 8601"),
    description: z.string().optional(),
  }),
  run: async (input) => {
    const project = await updateProject(input.name, {
      status: input.status,
      deadline: input.deadline ? new Date(input.deadline) : null,
      description: input.description,
    });
    return project
      ? `Updated "${project.name}": ${project.status}, due ${formatDate(project.deadline)}.`
      : `No project matching "${input.name}".`;
  },
});

// ── watchlist ─────────────────────────────────────────────
export const addWatchTool = betaZodTool({
  name: "add_to_watchlist",
  description:
    "Track a stock, a crypto asset, or a broad theme (drones, nuclear, water, AI). " +
    "Always capture WHY he is watching it — the thesis is the part worth having later, " +
    "because it is what lets him check whether he was right.",
  inputSchema: z.object({
    kind: z.enum(["stock", "crypto", "theme"]),
    name: z.string(),
    symbol: z.string().optional().describe("Ticker or coin symbol; omit for a theme"),
    thesis: z.string().optional().describe("Why he is watching it, in his own reasoning"),
  }),
  run: async (input) => {
    const item = await addToWatchlist(input);
    return `Watching ${item.name}${item.symbol ? ` (${item.symbol})` : ""} as a ${item.kind}.` +
      `${item.thesis ? ` Thesis noted.` : " No thesis recorded — worth adding one."}`;
  },
});

export const listWatchTool = betaZodTool({
  name: "list_watchlist",
  description: "What Steven is currently tracking, and why.",
  inputSchema: z.object({}),
  run: async () => {
    const items = await listWatchlist();
    if (items.length === 0) return "Watchlist is empty.";
    return items
      .map((i) => `- [${i.kind}] ${i.name}${i.symbol ? ` (${i.symbol})` : ""}` +
        `${i.thesis ? ` — ${i.thesis}` : ""}`)
      .join("\n");
  },
});

export const removeWatchTool = betaZodTool({
  name: "remove_from_watchlist",
  description: "Stop tracking something.",
  inputSchema: z.object({ name: z.string() }),
  run: async ({ name }) => {
    const item = await removeFromWatchlist(name);
    return item ? `Stopped watching ${item.name}.` : `Nothing on the watchlist matching "${name}".`;
  },
});

// ── money ─────────────────────────────────────────────────
export const recordMoneyTool = betaZodTool({
  name: "record_money",
  description:
    "Record money in or out for any business. He reports casually — 'we sold 3 housings to " +
    "the retail store for 450', 'bought filament for 120' — so extract the amount, direction, " +
    "which business, and who it was with. If it has not actually been paid yet, set settled " +
    "false and a due date: that is what turns 'they owe me' into something that chases itself.",
  inputSchema: z.object({
    direction: z.enum(["in", "out"]),
    amount: z.number().positive(),
    currency: z.string().optional().describe("USD default; LBP also common for him"),
    context: ContextKey.optional().describe("Which business this belongs to"),
    counterparty: z.string().optional().describe("Who it was with"),
    category: z.enum(["sale","purchase","salary","bill","fee","transfer","other"]).optional(),
    note: z.string().optional(),
    occurred_on: z.string().optional().describe("ISO date; defaults to today"),
    settled: z.boolean().optional().describe("False if not yet actually paid"),
    due_on: z.string().optional().describe("ISO date, when unsettled"),
  }),
  run: async (input) => {
    const entry = await recordMoney({
      direction: input.direction, amount: input.amount, currency: input.currency ?? "USD",
      contextKey: input.context ?? null, counterparty: input.counterparty ?? null,
      category: input.category ?? null, note: input.note ?? null,
      occurredOn: input.occurred_on ? new Date(input.occurred_on) : null,
      settled: input.settled ?? true,
      dueOn: input.due_on ? new Date(input.due_on) : null,
    });
    return `${input.direction === "in" ? "In" : "Out"} ${money(entry.amount_minor, entry.currency)}` +
      `${entry.counterparty ? ` · ${entry.counterparty}` : ""}` +
      `${entry.context_key ? ` · ${entry.context_key}` : ""}` +
      `${entry.settled ? "" : " · NOT yet settled"}.`;
  },
});

export const moneySummaryTool = betaZodTool({
  name: "money_summary",
  description:
    "In, out and net per business over a period. Use for any question about how a business " +
    "is doing, what was spent, or what came in.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(3650).optional().describe("Defaults to all time"),
    context: ContextKey.optional(),
  }),
  run: async (input) => {
    const rows = await moneySummary({ days: input.days, contextKey: input.context ?? null });
    if (rows.length === 0) return "No settled entries yet.";
    return rows.map((r) =>
      `${(r.context_key ?? "unfiled").padEnd(12)} in ${money(r.in_minor, r.currency)}` +
      ` · out ${money(r.out_minor, r.currency)} · net ${money(r.net_minor, r.currency)}`
    ).join("\n");
  },
});

export const affordTool = betaZodTool({
  name: "can_i_afford",
  description:
    "Answer whether he can afford something, against real numbers. Money owed TO him is " +
    "reported but deliberately not counted as available — it is not his until it lands, and " +
    "treating it as spendable is how people get caught short. Be straight about the gap.",
  inputSchema: z.object({
    amount: z.number().positive().optional().describe("What he wants to spend"),
    currency: z.string().optional(),
  }),
  run: async ({ amount, currency }) => {
    const cur = currency ?? "USD";
    const a = await affordability(cur);
    const lines = [
      `Cash (settled):      ${money(a.cashMinor, cur)}`,
      `Owed to him:         ${money(a.owedToHimMinor, cur)}  (not counted below)`,
      `Owed by him:         ${money(a.owedByHimMinor, cur)}`,
      `Monthly bills:       ${money(a.monthlyBillsMinor, cur)}`,
      `Free to spend:       ${money(a.freeMinor, cur)}`,
    ];
    if (amount !== undefined) {
      const want = Math.round(amount * 100);
      const after = a.freeMinor - want;
      lines.push(
        "",
        after >= 0
          ? `Yes — ${money(want, cur)} leaves ${money(after, cur)}.`
          : `No — short by ${money(-after, cur)}.` +
            (a.owedToHimMinor >= -after
              ? ` It works only once the ${money(a.owedToHimMinor, cur)} owed to him lands.`
              : ""),
      );
    }
    return lines.join("\n");
  },
});

export const outstandingTool = betaZodTool({
  name: "outstanding_money",
  description: "Everything unsettled — what he is owed and what he owes.",
  inputSchema: z.object({}),
  run: async () => {
    const rows = await outstanding();
    if (rows.length === 0) return "Nothing outstanding.";
    return rows.map((r) =>
      `${r.direction === "in" ? "OWED TO HIM" : "HE OWES   "} ${money(r.amount_minor, r.currency)}` +
      `${r.counterparty ? ` · ${r.counterparty}` : ""}` +
      `${r.due_on ? ` · due ${new Date(r.due_on).toISOString().slice(0,10)}` : ""}`
    ).join("\n");
  },
});

export const settleTool = betaZodTool({
  name: "settle_money",
  description: "Mark an outstanding amount as actually paid. Matches on counterparty or note.",
  inputSchema: z.object({ match: z.string() }),
  run: async ({ match }) => {
    const entry = await settle(match);
    return entry
      ? `Settled ${money(entry.amount_minor, entry.currency)}${entry.counterparty ? ` from ${entry.counterparty}` : ""}.`
      : `Nothing outstanding matching "${match}".`;
  },
});

export const billTool = betaZodTool({
  name: "add_bill",
  description: "Record a recurring monthly outgoing, so affordability knows what is committed.",
  inputSchema: z.object({
    name: z.string(), amount: z.number().positive(),
    currency: z.string().optional(),
    day_of_month: z.number().int().min(1).max(31).optional(),
    context: ContextKey.optional(),
  }),
  run: async (input) => {
    await addBill({ name: input.name, amount: input.amount, currency: input.currency ?? "USD",
                    dayOfMonth: input.day_of_month ?? 1, contextKey: input.context ?? null });
    const bills = await listBills();
    const total = bills.reduce((sum, b) => sum + fromMinor(b.amount_minor), 0);
    return `Recorded. ${bills.length} bills totalling ${money(Math.round(total * 100))}/month.`;
  },
});

// ── study ─────────────────────────────────────────────────
export const setStudyPlanTool = betaZodTool({
  name: "set_study_plan",
  description:
    "Create or replace a study plan. YOU work out the curriculum: order the topics by " +
    "prerequisite — the thing that must be understood first comes first — and estimate hours " +
    "honestly. Then this schedules it against the deadline. Use whenever he says he needs to " +
    "learn something by a date. Re-calling it re-plans without losing completed topics.",
  inputSchema: z.object({
    goal: z.string().describe("What he is learning, e.g. 'NVIDIA NeMo for the bank project'"),
    deadline: z.string().optional().describe("ISO date"),
    hours_per_day: z.number().optional().describe("Realistic hours he can actually give it"),
    context: ContextKey.optional(),
    topics: z.array(z.object({
      name: z.string(),
      detail: z.string().optional().describe("What 'understood' looks like for this topic"),
      est_hours: z.number().optional(),
    })).min(1).describe("In prerequisite order — earliest first"),
  }),
  run: async (input) => {
    const goal = await createGoal({
      name: input.goal,
      deadline: input.deadline ? new Date(input.deadline) : null,
      hoursPerDay: input.hours_per_day ?? 2,
      contextKey: input.context ?? null,
    });
    const n = await setTopics(goal.id, input.topics);
    const p = await progress(goal.id);
    const verdict =
      p.requiredHoursPerDay === null
        ? "No deadline set."
        : p.requiredHoursPerDay > Number(goal.hours_per_day)
          ? `Needs ${p.requiredHoursPerDay}h/day but he only has ${goal.hours_per_day}h. This plan does not fit — say so.`
          : `Needs ${p.requiredHoursPerDay}h/day against the ${goal.hours_per_day}h available. Fits.`;
    return `Planned "${goal.name}": ${n} topics, ${p.totalHours}h total, ${p.daysLeft ?? "?"} days left. ${verdict}`;
  },
});

export const studyStatusTool = betaZodTool({
  name: "study_status",
  description: "The plan, what is done, what is next, and whether he is on track.",
  inputSchema: z.object({ goal: z.string().optional() }),
  run: async ({ goal: fragment }) => {
    const goal = await findGoal(fragment ?? null);
    if (!goal) return "No study plan yet.";
    const [topics, p, due, materials] = await Promise.all([
      listTopics(goal.id), progress(goal.id), dueCards(goal.id, 50), listMaterials(goal.id),
    ]);
    const next = topics.filter((t) => t.status !== "done").slice(0, 4);
    return [
      `${goal.name} — ${p.topicsDone}/${p.topicsTotal} topics, ${p.doneHours}/${p.totalHours}h`,
      p.daysLeft !== null ? `${p.daysLeft} days left; needs ${p.requiredHoursPerDay}h/day from here` : "No deadline",
      `Studied ${Math.round(p.studiedHours7d * 10) / 10}h in the last 7 days`,
      `${due.length} cards due for review`,
      `${materials.length} pieces of material`,
      "",
      "Next up:",
      ...next.map((t) => `  ${t.position}. ${t.name} (${t.est_hours}h)${t.detail ? ` — ${t.detail}` : ""}`),
    ].join("\n");
  },
});

export const logStudyTool = betaZodTool({
  name: "log_study",
  description:
    "Record a study session. Also mark the topic done when he has finished it, with his own " +
    "confidence 1-5 — low confidence is a signal to schedule a revisit, not to move on.",
  inputSchema: z.object({
    minutes: z.number().int().min(1),
    topic: z.string().optional(),
    confidence: z.number().int().min(1).max(5).optional(),
    completed: z.boolean().optional().describe("True if he finished that topic"),
    notes: z.string().optional(),
    goal: z.string().optional(),
  }),
  run: async (input) => {
    const goal = await findGoal(input.goal ?? null);
    if (!goal) return "No study plan to log against.";
    await logSession({
      goalId: goal.id, topicFragment: input.topic ?? null, minutes: input.minutes,
      confidence: input.confidence ?? null, notes: input.notes ?? null,
    });
    let extra = "";
    if (input.completed && input.topic) {
      const topic = await completeTopic(goal.id, input.topic, input.confidence);
      extra = topic ? ` "${topic.name}" marked done.` : "";
    }
    const p = await progress(goal.id);
    return `Logged ${input.minutes}min.${extra} ${p.topicsDone}/${p.topicsTotal} topics; ` +
      `${p.requiredHoursPerDay ?? "?"}h/day needed from here.`;
  },
});

export const addStudyMaterialTool = betaZodTool({
  name: "add_study_material",
  description: "File something he dropped to study — a PDF, link, repo, video or course.",
  inputSchema: z.object({
    title: z.string(),
    kind: z.enum(["pdf", "link", "repo", "video", "note", "course"]),
    url: z.string().optional(),
    notes: z.string().optional(),
    goal: z.string().optional(),
  }),
  run: async (input) => {
    const goal = await findGoal(input.goal ?? null);
    if (!goal) return "No study plan yet — create one first with set_study_plan.";
    await addMaterial({ goalId: goal.id, kind: input.kind, title: input.title,
                        url: input.url ?? null, notes: input.notes ?? null });
    return `Filed "${input.title}" under ${goal.name}.`;
  },
});

export const addCardsTool = betaZodTool({
  name: "add_study_cards",
  description:
    "Write review questions for what he just studied. Ask for the thing itself — a command, " +
    "a config value, why an approach fails — not for a definition he can recite without " +
    "understanding. Add these after any real study session.",
  inputSchema: z.object({
    cards: z.array(z.object({ question: z.string(), answer: z.string() })).min(1).max(15),
    topic: z.string().optional(),
    goal: z.string().optional(),
  }),
  run: async (input) => {
    const goal = await findGoal(input.goal ?? null);
    if (!goal) return "No study plan yet.";
    for (const card of input.cards) {
      await addCard({ goalId: goal.id, question: card.question, answer: card.answer,
                      topicFragment: input.topic ?? null });
    }
    return `Added ${input.cards.length} review card${input.cards.length === 1 ? "" : "s"}.`;
  },
});

export const quizTool = betaZodTool({
  name: "get_due_cards",
  description:
    "Pull the review questions that are due. Ask him one at a time and wait for his answer " +
    "before revealing yours — being asked is what makes it stick; re-reading only feels " +
    "productive. Then call grade_card with how he actually did.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(20).optional(), goal: z.string().optional() }),
  run: async (input) => {
    const goal = await findGoal(input.goal ?? null);
    if (!goal) return "No study plan yet.";
    const cards = await dueCards(goal.id, input.limit ?? 5);
    if (cards.length === 0) return "Nothing due for review.";
    return cards.map((c) =>
      `id=${c.id}\nQ: ${c.question}\nA: ${c.answer}${c.topic_name ? `\n(${c.topic_name})` : ""}`
    ).join("\n---\n");
  },
});

export const gradeCardTool = betaZodTool({
  name: "grade_card",
  description:
    "Record how he did on a review card. 5 perfect, 4 correct with effort, 3 correct but shaky, " +
    "2 or below wrong — which resets it to tomorrow. Grade honestly; a generous grade only " +
    "means he sees it again too late.",
  inputSchema: z.object({
    card_id: z.string(),
    grade: z.number().int().min(0).max(5),
  }),
  run: async ({ card_id, grade }) => {
    const card = await gradeCard(card_id, grade);
    if (!card) return "No such card.";
    return `Next review in ${card.interval_days} day${card.interval_days === 1 ? "" : "s"}.`;
  },
});

// ── flying and gear ───────────────────────────────────────
export const flyabilityTool = betaZodTool({
  name: "flyability",
  description:
    "Whether Steven can fly, per aircraft. His quads are not comparable — a day the " +
    "5-inch enjoys will pin the Meteor 75 indoors — so this answers for each one " +
    "separately using wind, gusts, rain and daylight. Use it for any question about " +
    "flying, wind, or whether today or a given day is any good.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(7).optional().describe("How far ahead to look; default 2"),
  }),
  run: async ({ days }) => {
    try {
      return formatFlyability(await flyability(days ?? 2));
    } catch (err) {
      return `Weather lookup failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});

export const listGearTool = betaZodTool({
  name: "list_gear",
  description:
    "Steven's actual kit — quads, radios, 3D printers, batteries. Check this before " +
    "answering anything about his hardware, so advice is about what he owns rather " +
    "than a generic product.",
  inputSchema: z.object({
    kind: z.enum(["drone", "radio", "printer", "battery", "goggles", "tool", "other"]).optional(),
  }),
  run: async ({ kind }) => {
    const gear = await listGear(kind ?? null);
    if (gear.length === 0) return "Nothing recorded.";
    return gear
      .map((g) => `- [${g.kind}] ${g.brand ?? ""} ${g.model}${g.quantity > 1 ? ` x${g.quantity}` : ""}` +
        `${g.status !== "active" ? ` (${g.status})` : ""}${g.notes ? ` — ${g.notes}` : ""}`)
      .join("\n");
  },
});

export const addGearTool = betaZodTool({
  name: "add_gear",
  description:
    "Record a piece of kit he mentions owning. For a quad, set wind_limit_kmh and " +
    "gust_limit_kmh in specs so flyability can answer for it — a whoop is roughly 8/12, " +
    "a 2-inch 16/22, a 5-inch 32/38.",
  inputSchema: z.object({
    kind: z.enum(["drone", "radio", "printer", "battery", "goggles", "tool", "other"]),
    model: z.string(),
    brand: z.string().optional(),
    quantity: z.number().int().min(1).optional(),
    wind_limit_kmh: z.number().optional(),
    gust_limit_kmh: z.number().optional(),
    notes: z.string().optional(),
  }),
  run: async (input) => {
    const specs: Record<string, unknown> = {};
    if (input.wind_limit_kmh) specs.wind_limit_kmh = input.wind_limit_kmh;
    if (input.gust_limit_kmh) specs.gust_limit_kmh = input.gust_limit_kmh;
    const gear = await addGear({
      kind: input.kind, model: input.model, brand: input.brand ?? null,
      quantity: input.quantity ?? 1, specs, notes: input.notes ?? null,
    });
    return `Recorded ${gear.brand ?? ""} ${gear.model}${gear.quantity > 1 ? ` x${gear.quantity}` : ""}.`;
  },
});

export const setGearStatusTool = betaZodTool({
  name: "set_gear_status",
  description: "Mark a piece of kit broken, active again, or retired.",
  inputSchema: z.object({
    model: z.string(),
    status: z.enum(["active", "broken", "retired"]),
  }),
  run: async ({ model, status }) => {
    const gear = await setGearStatus(model, status);
    return gear ? `${gear.model} is now ${status}.` : `No kit matching "${model}".`;
  },
});

/** Runs on Anthropic's servers — no implementation, and no scraping code to own. */
export const webSearchTool = {
  type: "web_search_20260209" as const,
  name: "web_search" as const,
  max_uses: 6,
};

export const clientTools = [
  recallTool,
  createTaskTool,
  listTasksTool,
  completeTaskTool,
  snoozeTaskTool,
  setReminderTool,
  listRemindersTool,
  cancelReminderTool,
  createProjectTool,
  listProjectsTool,
  updateProjectTool,
  addWatchTool,
  listWatchTool,
  removeWatchTool,
  recordMoneyTool,
  moneySummaryTool,
  affordTool,
  outstandingTool,
  settleTool,
  billTool,
  setStudyPlanTool,
  studyStatusTool,
  logStudyTool,
  addStudyMaterialTool,
  addCardsTool,
  quizTool,
  gradeCardTool,
  flyabilityTool,
  listGearTool,
  addGearTool,
  setGearStatusTool,
];

export const allTools = [...clientTools, webSearchTool];

log.debug({ tools: clientTools.length }, "tool belt assembled");
