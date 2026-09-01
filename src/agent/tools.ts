import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { recall } from "../memory/recall.js";
import { createTask, listTasks, completeTask, snoozeTask } from "../memory/tasks.js";
import { createReminder, listReminders, cancelReminder } from "../memory/reminders.js";
import { createProject, listProjects, updateProject } from "../memory/projects.js";
import { addToWatchlist, listWatchlist, removeFromWatchlist } from "../memory/watchlist.js";
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
];

export const allTools = [...clientTools, webSearchTool];

log.debug({ tools: clientTools.length }, "tool belt assembled");
