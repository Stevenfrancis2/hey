import { config } from "../config.js";

/**
 * Which model answers this message.
 *
 * Almost nothing he sends needs Opus. "Hey", "remind me at 3", "how much PLA is
 * left" are lookups and a tool call — Haiku does them correctly and costs a
 * fifth as much. Opus earns its price on research, costing, planning and
 * anything where being wrong is expensive.
 *
 * Deliberately a rule and not a router model: a routing call would add latency
 * and another bill to every single message, to decide something a regular
 * expression gets right.
 *
 * $5/$25 vs $2/$10 vs $1/$5 per million. On a normal day this is most of the
 * difference between a ten-dollar month and a hundred-dollar one.
 */

export type Tier = "fast" | "mid" | "deep";

/** Anything where being wrong costs real money or real time. */
const DEEP = new RegExp([
  "research", "analys", "analyz", "compare", "strategy", "strategi",
  "should i", "worth it", "why (is|does|did|are)", "explain why",
  "plan\\b", "plann", "decide", "decision", "trade-?off", "pros and cons",
  "underpric", "overpric", "margin", "costing", "profit",
  "net worth", "afford", "invest", "portfolio", "bitcoin", "btc\\b", "market",
  "write (me )?a", "draft", "design", "architect", "review",
  "what do you know about me", "everything you know",
].join("|"), "i");

/** Conversational noise and one-line lookups. */
const FAST = new RegExp([
  "^\\s*(hey|hi|hello|yo|sup|wassup|thanks|thank you|ok|okay|cool|nice|got it|yes|no|sure)\\b",
  // Any short question DEEP has already declined is a lookup. Requiring the verb
  // immediately after the question word missed "how much PLA is left", which is
  // close to the most common thing he asks.
  "^\\s*(what|when|where|which|who|how much|how many|how long|is|are|do|does|did|can)\\b.{0,70}$",
  "^\\s*(remind|add|log|record|note|set|cancel|delete|done|complete)\\b",
  "^\\s*/[a-z]+",
].join("|"), "i");

export function tierFor(text: string): Tier {
  const t = text.trim();

  // Two requests joined together is not a lookup, however short it is.
  const compound = /\band\s+(then\s+|also\s+)?(tell|give|check|show|work|find|see)\b|,\s*then\b/i.test(t);

  // He can always force it, and saying so should be enough.
  if (/\b(think hard|deep dive|use opus|take your time|properly)\b/i.test(t)) return "deep";

  // Length is the strongest single signal: a paragraph is a briefing, and a
  // briefing is where getting it wrong actually costs him.
  if (t.length > 600) return "deep";
  if (DEEP.test(t)) return "deep";
  if (!compound && t.length < 90 && FAST.test(t)) return "fast";
  return "mid";
}

export function modelFor(tier: Tier): string {
  switch (tier) {
    case "fast": return config.anthropic.fastModel;
    case "deep": return config.anthropic.model;
    default: return config.anthropic.midModel;
  }
}

/**
 * Effort is the second lever after model choice. A lookup does not need the
 * model to deliberate about it, and deliberation is billed.
 */
export function effortFor(tier: Tier): "low" | "medium" | "high" {
  return tier === "deep" ? "high" : tier === "mid" ? "medium" : "low";
}
