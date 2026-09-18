import type { Api } from "grammy";
import { generate } from "../agent/run.js";
import { claimDueReminders } from "../memory/reminders.js";
import { query } from "../db/index.js";
import { log } from "../log.js";
import { call as placeCall } from "../integrations/call.js";
import { push } from "../integrations/push.js";
import { isProviderError, notifyOutage } from "../integrations/provider-errors.js";

export async function fireDueReminders(api: Api, chatId: number): Promise<number> {
  const due = await claimDueReminders();
  for (const reminder of due) {
    await api.sendMessage(chatId, `⏰ ${reminder.text}`).catch((err) =>
      log.error({ err, id: reminder.id }, "reminder send failed"),
    );
    void push("Reminder", reminder.text, "/reminders");
    // A notification cannot wake him: his phone is silent while he works, and
    // silent is exactly when the reminders that matter fire. A call is the one
    // thing iOS lets through.
    if (reminder.call) {
      const r = await placeCall(reminder.text);
      if (!r.ok) {
        log.warn({ id: reminder.id, detail: r.detail }, "wake-up call failed");
        await api.sendMessage(chatId, `(I tried to ring you about that and couldn't: ${r.detail})`)
          .catch(() => {});
      }
    }
  }
  return due.length;
}

const MORNING = `It is early morning. Write Steven's daily brief.

Look at his open tasks, reminders and calendar for today. Search his recent captures for open
loops and anything he said he would do. Do not check the web.

Do not bring up studying, a study plan, topics or review cards. He studies when he decides to
and tells you; being told every morning that he is behind on a plan he never asked for is
exactly what he does not want.

Keep it short enough to read on a phone while making coffee. Lead with what actually
matters today. If today is quiet, say so in one line rather than padding it out.
No headers, no bullet spam. Write it the way a sharp assistant would say it out loud.`;

const WEEKLY = `It is Sunday evening. Write Steven's weekly review.

Go room by room over what moved and what did not: Cligli, drones, Royal Pizza, the bank AI
project, finance, land, body. Use his tasks, ledger and his captures from the past week.

Be direct about what slipped. Name anything he has been avoiding. End with the two or
three things that would matter most next week — not a list of ten.

The bank AI project has a real deadline and someone depending on him. Weight it accordingly.`;

export async function sendBrief(
  api: Api,
  chatId: number,
  kind: "morning" | "weekly",
): Promise<void> {
  const instruction = kind === "morning" ? MORNING : WEEKLY;

  let body: string;
  try {
    // Sonnet, not Opus: a morning summary of his own tasks is not a judgement call.
    body = await generate(instruction, kind === "weekly" ? "high" : "low", "mid");
  } catch (err) {
    // A brief that just never arrives reads as the bot being dead. He should
    // find out from the 06:30 slot itself, not by noticing it stopped.
    log.error({ err, kind }, "brief failed");
    if (isProviderError(err)) await notifyOutage(api, chatId, err);
    return;
  }
  if (!body.trim()) return;

  await query(`INSERT INTO briefs (kind, body_md, sent_at) VALUES ($1, $2, now())`, [kind, body]);
  await api.sendMessage(chatId, body).catch((err) => log.error({ err, kind }, "brief send failed"));
  void push(kind === "morning" ? "Morning brief" : "Weekly review", body, "/");
  log.info({ kind }, "brief sent");
}
