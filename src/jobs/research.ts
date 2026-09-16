import type { Api } from "grammy";
import { generate } from "../agent/run.js";
import { dueTopics, saveFinding, markRun, lastFinding } from "../memory/research.js";
import { log } from "../log.js";
import { config } from "../config.js";
import { isProviderError, notifyOutage } from "../integrations/provider-errors.js";

/**
 * Standing questions, answered on a cadence. The previous answer is fed back in
 * so a digest reports what changed rather than restating the same landscape —
 * a feed that repeats itself stops being read within a week.
 */
export async function runResearch(
  api: Api,
  chatId: number,
  cadence: "daily" | "weekly",
): Promise<void> {
  const topics = await dueTopics(cadence);
  if (topics.length === 0) return;

  const sections: string[] = [];
  let providerFailures = 0;

  for (const topic of topics) {
    const previous = await lastFinding(topic.id);
    const instruction = [
      `Research this for Steven and write a short digest.`,
      ``,
      `TOPIC: ${topic.name}`,
      `WHAT HE WANTS: ${topic.brief}`,
      ``,
      previous
        ? `Your previous digest is below. Report what has CHANGED since then. Do not restate ` +
          `anything already covered unless it has genuinely moved.\n\n---\n${previous.slice(0, 3000)}\n---`
        : `This is the first digest for this topic, so a short baseline is fine.`,
      ``,
      `Use web search. Rules:`,
      cadence === "daily"
        // The whole desk has to read in about two minutes across every topic, so
        // the daily budget per topic is deliberately brutal. Silence is the
        // correct answer on a quiet day — a digest that manufactures items to
        // look busy stops being read, and then the desk is worth nothing.
        ? `- AT MOST TWO items, and only genuinely important ones. Most days a topic has ` +
          `nothing and the right answer is "nothing worth reporting" — say exactly that and stop.`
        : `- Three to six items maximum. If nothing real happened, say "nothing worth reporting" and stop.`,
      cadence === "daily"
        ? `- ONE LINE per item: what happened, then a dash, then why it matters to him. ` +
          `Hard limit 200 characters.`
        : `- Each item: what happened, and why it matters to him specifically. One or two lines.`,
      `- Start each item with a bullet character and a space. Nothing else.`,
      `- No hype, no funding rounds, no press-release language.`,
      `- Never predict prices or tell him to buy or sell. Facts and consequences only.`,
      `- Plain text for Telegram. No markdown, no headers, no bold, no asterisks.`,
      `- He will ask you to expand anything he cares about, so do not pre-explain.`,
    ].join("\n");

    try {
      const body = await generate(instruction, "low");
      if (body.trim() && !/nothing worth reporting/i.test(body.slice(0, 120))) {
        await saveFinding(topic.id, body);
        sections.push(`${topic.name.toUpperCase()}\n${body.trim()}`);
      } else {
        await markRun(topic.id);
      }
    } catch (err) {
      log.error({ err, topic: topic.name }, "research topic failed");
      if (isProviderError(err)) { providerFailures++; await notifyOutage(api, chatId, err); }
    }
  }

  // The desk fired at 14:00 into an empty account, every topic failed, and
  // because the schedule runs once a day that was his news gone until tomorrow.
  // Throwing hands it back to pg-boss, which retries with backoff — an outage
  // or an empty balance should cost him an hour, not a day.
  if (sections.length === 0 && providerFailures > 0) {
    throw new Error(`desk: all ${providerFailures} topics failed on the provider; retrying`);
  }

  if (sections.length === 0) {
    log.info({ cadence }, "research: nothing worth sending");
    return;
  }

  // A blank line between every topic. He reads this on a phone, and a wall of
  // text does not get read at all.
  const date = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: config.timezone,
  });
  const header = cadence === "daily" ? `Desk · ${date}` : `Desk · week to ${date}`;
  const message =
    `${header}\n\n${sections.join("\n\n\n")}\n\nAsk me about any of these and I'll give you the whole story.`;

  // Telegram caps a message at 4096 characters.
  for (let i = 0; i < message.length; i += 3900) {
    await api.sendMessage(chatId, message.slice(i, i + 3900)).catch((err) =>
      log.error({ err }, "research send failed"),
    );
  }
  log.info({ cadence, topics: sections.length }, "research sent");
}

const SCOUT = `Look through Steven's recent captures, tasks and ledger entries for work he keeps
doing BY HAND — the same message retyped, the same number copied somewhere, the same check
performed, the same file renamed. Use recall to look, and look at the last month.

For each pattern you actually find evidence of, call propose_automation with: what you
observed (be specific — quote the repetition), what to automate, the effort, and roughly what
it saves.

Rules:
- Only propose things you have evidence for. Do not invent plausible-sounding automations.
- Three at most. One good one beats three speculative ones.
- If you find nothing genuinely repetitive, say so and propose nothing. That is a fine answer.

Then write him two or three sentences summarising what you found. If you proposed nothing,
say that in one line.`;

export async function runScout(api: Api, chatId: number): Promise<void> {
  try {
    const body = await generate(SCOUT, "high");
    if (body.trim()) await api.sendMessage(chatId, `Automation scout\n\n${body.trim()}`);
    log.info("automation scout ran");
  } catch (err) {
    log.error({ err }, "automation scout failed");
    if (isProviderError(err)) await notifyOutage(api, chatId, err);
  }
}
