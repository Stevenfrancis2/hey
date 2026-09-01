import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { recall } from "../memory/recall.js";
import { createTask, listTasks, completeTask, snoozeTask } from "../memory/tasks.js";
import { createReminder, listReminders, cancelReminder } from "../memory/reminders.js";
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
];

export const allTools = [...clientTools, webSearchTool];

log.debug({ tools: clientTools.length }, "tool belt assembled");
