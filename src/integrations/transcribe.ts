import { config } from "../config.js";

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

/** Telegram voice notes are OGG/Opus, which Groq's Whisper accepts directly. */
export async function transcribe(audio: Uint8Array, filename = "voice.ogg"): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([audio]), filename);
  form.append("model", config.groq.model);
  form.append("response_format", "text");

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.groq.apiKey}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Groq transcription failed (${response.status}): ${await response.text()}`);
  }

  return (await response.text()).trim();
}
