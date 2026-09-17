import { config } from "../config.js";
import { log } from "../log.js";

/**
 * A reminder that rings.
 *
 * He asked for this at 04:41 after sleeping through a 10:00 dough start. A
 * Telegram notification cannot wake him — his phone is on silent while he
 * works a Chicago shift, and silent is exactly when the reminders that matter
 * fire. A phone call is the one thing iOS lets through.
 *
 * Twilio reads the text aloud with <Say> rather than fetching a recording, so
 * there is nothing to host and every reminder can say its own words.
 */

const API = "https://api.twilio.com/2010-04-01";

export function isConfigured(): boolean {
  const t = config.twilio;
  return Boolean(t.accountSid && t.authToken && t.from && t.to);
}

/** Twilio speaks TwiML; anything unescaped in his own words breaks the XML. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function call(text: string): Promise<{ ok: boolean; detail: string }> {
  if (!isConfigured()) return { ok: false, detail: "Twilio not configured" };
  const t = config.twilio;

  // Said twice, with a pause. Once is missed by someone half awake, and the
  // whole point of this path is that he is asleep.
  const spoken = escapeXml(text.slice(0, 400));
  const twiml =
    `<Response>` +
    `<Pause length="1"/>` +
    `<Say voice="Polly.Brian">${spoken}</Say>` +
    `<Pause length="2"/>` +
    `<Say voice="Polly.Brian">Again. ${spoken}</Say>` +
    `</Response>`;

  const body = new URLSearchParams({
    To: t.to, From: t.from, Twiml: twiml,
    // Ring for a full minute; a five-second attempt is a missed call, not a wake-up.
    Timeout: "60",
  });

  try {
    const res = await fetch(`${API}/Accounts/${t.accountSid}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const json = (await res.json()) as { sid?: string; message?: string };
    if (!res.ok) {
      log.warn({ status: res.status, message: json.message }, "twilio call failed");
      return { ok: false, detail: json.message ?? `Twilio ${res.status}` };
    }
    log.info({ sid: json.sid }, "call placed");
    return { ok: true, detail: json.sid ?? "placed" };
  } catch (err) {
    log.warn({ err }, "twilio unreachable");
    return { ok: false, detail: err instanceof Error ? err.message : "unreachable" };
  }
}
