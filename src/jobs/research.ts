import type { Api } from "grammy";
import { generate } from "../agent/run.js";
import { dueTopics, saveFinding, markRun, lastFinding } from "../memory/research.js";
import { log } from "../log.js";

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
      `- Three to six items maximum. If nothing real happened, say "nothing worth reporting" and stop.`,
      `- Each item: what happened, and why it matters to him specifically. One or two lines.`,
      `- No hype, no funding rounds, no press-release language.`,
      `- Never predict prices or tell him to buy or sell. Facts and consequences only.`,
      `- Plain text for Telegram. No markdown headers.`,
    ].join("\n");

    try {
      const body = await generate(instruction, "low");
      if (body.trim() && !/nothing worth reporting/i.test(body.slice(0, 120))) {
        await saveFinding(topic.id, body);
        sections.push(`— ${topic.name} —\n${body.trim()}`);
      } else {
        await markRun(topic.id);
      }
    } catch (err) {
      log.error({ err, topic: topic.name }, "research topic failed");
    }
  }

  if (sections.length === 0) {
    log.info({ cadence }, "research: nothing worth sending");
    return;
  }

  const header = cadence === "daily" ? "Today's desk" : "This week's desk";
  const message = `${header}\n\n${sections.join("\n\n")}`;

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
  }
}
