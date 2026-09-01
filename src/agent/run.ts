import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, recordUsage } from "./client.js";
import { allTools } from "./tools.js";
import { buildSystem } from "./prompt.js";
import { config } from "../config.js";
import { one, query } from "../db/index.js";
import { log } from "../log.js";

const HISTORY_TURNS = 24;
const MAX_ITERATIONS = 12;

async function getThread(chatId: number): Promise<string> {
  const existing = await one<{ id: string }>(
    `SELECT id FROM threads WHERE chat_id = $1 ORDER BY last_active_at DESC LIMIT 1`,
    [chatId],
  );
  if (existing) {
    await query(`UPDATE threads SET last_active_at = now() WHERE id = $1`, [existing.id]);
    return existing.id;
  }
  const created = await one<{ id: string }>(
    `INSERT INTO threads (chat_id) VALUES ($1) RETURNING id`,
    [chatId],
  );
  if (!created) throw new Error("thread insert returned no row");
  return created.id;
}

async function loadHistory(threadId: string): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const rows = await query<{ role: string; content: unknown }>(
    `SELECT role, content FROM (
       SELECT role, content, created_at FROM messages
       WHERE thread_id = $1 ORDER BY created_at DESC LIMIT $2
     ) recent ORDER BY created_at ASC`,
    [threadId, HISTORY_TURNS],
  );
  return rows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content as Anthropic.Beta.BetaMessageParam["content"],
  }));
}

async function saveMessage(threadId: string, role: string, content: unknown): Promise<void> {
  await query(`INSERT INTO messages (thread_id, role, content) VALUES ($1, $2, $3)`, [
    threadId,
    role,
    JSON.stringify(content),
  ]);
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * One turn of conversation. The SDK's tool runner drives the tool loop; we own
 * history, cost accounting, and resuming a turn that the server paused.
 */
export async function respond(chatId: number, userText: string): Promise<string> {
  const threadId = await getThread(chatId);
  const history = await loadHistory(threadId);
  const system = await buildSystem();

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history,
    { role: "user", content: userText },
  ];

  const started = Date.now();
  const runner = anthropic.beta.messages.toolRunner({
    model: config.anthropic.model,
    max_tokens: 8192,
    system,
    messages,
    tools: allTools,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    max_iterations: MAX_ITERATIONS,
  });

  let final: Anthropic.Beta.BetaMessage | null = null;
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheRead = 0;

  for await (const message of runner) {
    final = message;
    tokensIn += message.usage.input_tokens ?? 0;
    tokensOut += message.usage.output_tokens ?? 0;
    cacheRead += message.usage.cache_read_input_tokens ?? 0;

    // A server tool (web search) can pause the turn. The runner only resumes
    // after a *client* tool result, so without this the answer is silently
    // truncated — no error, no warning.
    if (message.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: message.content });
    }
  }

  await recordUsage(
    "chat",
    config.anthropic.model,
    { input_tokens: tokensIn, output_tokens: tokensOut, cache_read_input_tokens: cacheRead },
    Date.now() - started,
  );

  if (!final) return "";

  if (final.stop_reason === "refusal") {
    log.warn({ details: final.stop_details }, "model declined");
    return "I can't help with that one.";
  }

  const reply = textOf(final.content);

  await saveMessage(threadId, "user", userText);
  // Persist the full blocks, not just text, so tool use stays in the history.
  await saveMessage(threadId, "assistant", final.content);

  log.info(
    { chatId, tokensIn, tokensOut, cacheRead, ms: Date.now() - started },
    "responded",
  );
  return reply;
}

/** A one-shot generation with no history and no persistence — used by the briefs. */
export async function generate(instruction: string, effort: "low" | "high" = "high"): Promise<string> {
  const started = Date.now();
  const system = await buildSystem();
  const runner = anthropic.beta.messages.toolRunner({
    model: config.anthropic.model,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: instruction }],
    tools: allTools,
    thinking: { type: "adaptive" },
    output_config: { effort },
    max_iterations: MAX_ITERATIONS,
  });

  let final: Anthropic.Beta.BetaMessage | null = null;
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheRead = 0;

  for await (const message of runner) {
    final = message;
    tokensIn += message.usage.input_tokens ?? 0;
    tokensOut += message.usage.output_tokens ?? 0;
    cacheRead += message.usage.cache_read_input_tokens ?? 0;
    if (message.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: message.content });
    }
  }

  await recordUsage(
    "brief",
    config.anthropic.model,
    { input_tokens: tokensIn, output_tokens: tokensOut, cache_read_input_tokens: cacheRead },
    Date.now() - started,
  );

  return final ? textOf(final.content) : "";
}
