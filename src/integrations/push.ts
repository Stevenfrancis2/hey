import webpush from "web-push";
import { query } from "../db/index.js";
import { log } from "../log.js";

/**
 * Notifications straight to his phone from the home-screen app, without
 * Telegram in between. iOS delivers Web Push only to a site added to the Home
 * Screen, and only after he taps "Turn on notifications" once — so this runs
 * alongside Telegram, never instead of it, until he has done that.
 */
const PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";

if (PUBLIC && PRIVATE) {
  webpush.setVapidDetails("mailto:owner@second-steven.fly.dev", PUBLIC, PRIVATE);
}

export function pushPublicKey(): string {
  return PUBLIC;
}

export async function saveSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
  await query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ($1,$2,$3)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [sub.endpoint, sub.keys.p256dh, sub.keys.auth],
  );
}

/** Fire and forget. A push that fails must never stop the Telegram message beside it. */
export async function push(title: string, body: string, url = "/"): Promise<number> {
  if (!PUBLIC || !PRIVATE) return 0;
  const subs = await query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions`,
  ).catch(() => []);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body: body.slice(0, 600), url }),
        { TTL: 3600 },
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 404/410: the phone dropped the subscription (app removed, permission revoked).
      if (status === 404 || status === 410) {
        await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [s.endpoint]);
      } else {
        log.warn({ err, status }, "push failed");
      }
    }
  }
  return sent;
}

/** Served at /sw.js. Shows the notification and opens the right page on tap. */
export const SERVICE_WORKER = `
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: "Second Steven", body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "Second Steven", {
    body: data.body || "", icon: "/icon-192.png", badge: "/icon-192.png", data: { url: data.url || "/" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url || "/"));
});
`;
