import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, recordUsage } from "./client.js";
import { config } from "../config.js";
import { query } from "../db/index.js";

export const CONTEXT_KEYS = [
  "cligli",
  "drones",
  "royal_pizza",
  "work",
  "bank_ai",
  "finance",
  "land",
  "body",
  "personal",
] as const;

const Classification = z.object({
  context: z.enum(CONTEXT_KEYS).describe("Which room of Steven's life this belongs to"),
  intent: z
    .enum(["idea", "task", "question", "request", "log", "reminder", "decision", "feeling"])
    .describe(
      "question = he is asking something and expects an answer. " +
        "request = he wants an action taken. " +
        "task = something he must do later. " +
        "log = a record of something that happened. " +
        "idea = a thought worth keeping. Everything else stores silently.",
    ),
  summary: z.string().describe("One short line, in his own vocabulary, not a paraphrase"),
  urgency: z.number().int().min(0).max(3).describe("0 whenever, 3 today"),
  tags: z.array(z.string()).max(6),
});

export type Classification = z.infer<typeof Classification>;

const SYSTEM = `You sort Steven's captured thoughts into the right room of his life.

His rooms:
- cligli: his 3D printing and assembly business — products, orders, suppliers, print farm, filament
- drones: FPV building, repairs, training, DCL racing, drone content
- royal_pizza: his father's pizza business — dough, recipes, kitchen ops
- work: his remote automation job
- bank_ai: a side project building AI agents for banks with a friend, using NVIDIA NeMo, Docker and L1/L2 agent tiers
- finance: money across any business — sales, purchases, bills, savings, what he can afford
- land: a 600 m² plot; deciding between a guesthouse and building his own house
- body: gym, training, food, calories
- personal: everything else — news, weather, flying conditions, life

Pick the single best room. Money talk goes to finance even when it names another business.
Be decisive; do not explain yourself.`;

export async function classify(text: string): Promise<Classification | null> {
  const started = Date.now();
  try {
    const response = await anthropic.messages.parse({
      model: config.anthropic.fastModel,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: text.slice(0, 8000) }],
      output_config: { format: zodOutputFormat(Classification) },
    });
    await recordUsage("classify", config.anthropic.fastModel, response.usage, Date.now() - started);
    return response.parsed_output ?? null;
  } catch {
    // Classification is an enhancement. A capture is never lost because it failed.
    return null;
  }
}

export async function saveClassification(captureId: string, c: Classification): Promise<void> {
  await query(
    `INSERT INTO capture_enrichment (capture_id, context_id, intent, summary, urgency, tags, model)
     VALUES ($1, (SELECT id FROM contexts WHERE key = $2), $3, $4, $5, $6, $7)
     ON CONFLICT (capture_id) DO UPDATE SET
       context_id = EXCLUDED.context_id, intent = EXCLUDED.intent,
       summary = EXCLUDED.summary, urgency = EXCLUDED.urgency, tags = EXCLUDED.tags`,
    [captureId, c.context, c.intent, c.summary, c.urgency, c.tags, config.anthropic.fastModel],
  );
}
