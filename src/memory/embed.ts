import { config } from "../config.js";

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const BATCH = 96;

type VoyageResponse = {
  data: { embedding: number[]; index: number }[];
  usage?: { total_tokens: number };
};

/**
 * Voyage distinguishes between indexing text ("document") and searching with
 * it ("query"), and gives noticeably better retrieval when you tell it which.
 */
export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  if (texts.length === 0) return [];

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.voyage.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.voyage.model,
        input: batch,
        input_type: inputType,
        output_dimension: config.voyage.dimensions,
      }),
    });

    if (!response.ok) {
      throw new Error(`Voyage embeddings failed (${response.status}): ${await response.text()}`);
    }

    const body = (await response.json()) as VoyageResponse;
    // Voyage does not promise ordering, so place each vector by its index.
    const ordered: number[][] = new Array(batch.length);
    for (const item of body.data) ordered[item.index] = item.embedding;
    out.push(...ordered);
  }

  return out;
}

export async function embedOne(text: string, inputType: "document" | "query"): Promise<number[]> {
  const [vector] = await embed([text], inputType);
  if (!vector) throw new Error("Voyage returned no embedding");
  return vector;
}
