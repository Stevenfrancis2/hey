import { anthropic, recordUsage } from "./client.js";
import { config } from "../config.js";
import { log } from "../log.js";

/**
 * Which model answers this message.
 *
 * Haiku reads the message and picks. That costs about two hundredths of a cent
 * and half a second, and it is worth both: the alternative is a regular
 * expression guessing at intent, which gets "should I buy a third printer"
 * right and "my father called, he wants to change the dough order and I am not
 * sure that works with Saturday" wrong. The second one needs judgement and no
 * pattern will ever see it.
 *
 * $5/$25 vs $2/$10 vs $1/$5 per million. On a normal day this is most of the
 * difference between a ten-dollar month and a hundred-dollar one — but the
 * point is not to be cheap, it is to spend Opus where Opus changes the answer.
 */

export type Tier = "fast" | "mid" | "deep";

const RUBRIC = `Pick which model should answer Steven's message. Reply with ONE word.

FAST — a greeting, an acknowledgement, or one fact to look up or write down.
  "hey jarvis" · "how much PLA is left" · "remind me at 3pm to call dad"
  · "log 40 dollars on filament" · "which printers are running"

MID — ordinary work. Several steps, a tool or two, some judgement, but the
  right answer is not really in doubt.
  "check the printers and tell me which finishes first" · "put the accounting in
  my calendar every day until the 23rd" · "my father changed the dough order"

DEEP — being wrong is expensive, or the answer is a judgement he will act on.
  Money, pricing, margin, what to buy, what to build, research, planning,
  comparing options, anything about his net worth or the bank project, anything
  where he is asking what you think rather than what you know.
  "is the corn clicker underpriced" · "should I buy a third printer" · "what is
  bitcoin doing" · "how should I structure the L2 agents"

Rules:
- If he asks what you THINK, whether something WORKS, whether he SHOULD, or if
  he says he is NOT SURE about something — that is DEEP. He is asking for
  judgement, not for a fact, and judgement is the whole reason to spend Opus.
- If the answer commits him to spending money or time, choose DEEP.
- If it is ambiguous between two, choose the more capable one. Being wrong
  cheaply is worse than being right for a fraction of a cent.
- Reply with exactly one word: FAST, MID or DEEP.`;

/** The fallback when the router itself is unavailable. Deliberately cautious. */
function guess(text: string): Tier {
  const t = text.trim();
  if (t.length > 400) return "deep";
  if (/^\s*(hey|hi|hello|yo|thanks|ok|okay|sure|\/[a-z]+)\b/i.test(t) && t.length < 40) return "fast";
  return "mid";
}

export async function tierFor(text: string): Promise<Tier> {
  const t = text.trim();

  // He can always force it, and saying so should be enough.
  if (/\b(think hard|deep dive|use opus|take your time)\b/i.test(t)) return "deep";

  const started = Date.now();
  try {
    const res = await anthropic.messages.create({
      model: config.anthropic.fastModel,
      max_tokens: 4,
      system: RUBRIC,
      messages: [{ role: "user", content: t.slice(0, 1500) }],
    });
    await recordUsage("route", config.anthropic.fastModel, res.usage, Date.now() - started);

    const word = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim().toUpperCase();
    const tier: Tier | null =
      word.startsWith("FAST") ? "fast" : word.startsWith("DEEP") ? "deep" : word.startsWith("MID") ? "mid" : null;

    if (!tier) {
      log.warn({ word }, "router returned something unexpected");
      return guess(t);
    }
    return tier;
  } catch (err) {
    // A router that cannot answer must not stop him being answered.
    log.warn({ err }, "router failed, falling back");
    return guess(t);
  }
}

export function modelFor(tier: Tier): string {
  switch (tier) {
    case "fast": return config.anthropic.fastModel;
    case "deep": return config.anthropic.model;
    default: return config.anthropic.midModel;
  }
}

/** Effort is the second lever after model choice. Deliberation is billed. */
export function effortFor(tier: Tier): "low" | "medium" | "high" {
  return tier === "deep" ? "high" : tier === "mid" ? "medium" : "low";
}

/**
 * Haiku 4.5 supports neither adaptive thinking nor output_config.effort — both
 * are 400s, not warnings. Sending them anyway broke every fast-tier message the
 * moment routing went live, and because a 400 is not a credit or auth failure it
 * reached him as "Anthropic is down". It was not. It was this.
 */
export function tuningFor(model: string, effort: "low" | "medium" | "high"): {
  thinking?: { type: "adaptive" };
  output_config?: { effort: "low" | "medium" | "high" };
} {
  if (model.startsWith("claude-haiku")) return {};
  return { thinking: { type: "adaptive" }, output_config: { effort } };
}
