import type { Api } from "grammy";
import { generate } from "../agent/run.js";
import { claimDueReminders } from "../memory/reminders.js";
import { query } from "../db/index.js";
import { log } from "../log.js";

export async function fireDueReminders(api: Api, chatId: number): Promise<number> {
  const due = await claimDueReminders();
  for (const reminder of due) {
    await api.sendMessage(chatId, `⏰ ${reminder.text}`).catch((err) =>
      log.error({ err, id: reminder.id }, "reminder send failed"),
    );
  }
  return due.length;
}

const MORNING = `It is early morning. Write Steven's daily brief.

Look at his open tasks and anything due. Search his recent captures for open loops and
anything he said he would do. Check the web only if something genuinely warrants it.

Keep it short enough to read on a phone while making coffee. Lead with what actually
matters today. If today is quiet, say so in one line rather than padding it out.
No headers, no bullet spam. Write it the way a sharp assistant would say it out loud.`;

const WEEKLY = `It is Sunday evening. Write Steven's weekly review.

Go room by room over what moved and what did not: Cligli, drones, Royal Pizza, the bank AI
project, finance, land, body. Use his tasks and his captures from the past week.

Be direct about what slipped. Name anything he has been avoiding. End with the two or
three things that would matter most next week — not a list of ten.

The bank AI project has a real deadline and someone depending on him. Weight it accordingly.`;

export async function sendBrief(
  api: Api,
  chatId: number,
  kind: "morning" | "weekly",
): Promise<void> {
  const instruction = kind === "morning" ? MORNING : WEEKLY;
  const body = await generate(instruction, kind === "weekly" ? "high" : "low");
  if (!body.trim()) return;

  await query(`INSERT INTO briefs (kind, body_md, sent_at) VALUES ($1, $2, now())`, [kind, body]);
  await api.sendMessage(chatId, body).catch((err) => log.error({ err, kind }, "brief send failed"));
  log.info({ kind }, "brief sent");
}
