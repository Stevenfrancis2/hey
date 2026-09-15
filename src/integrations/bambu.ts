import mqtt, { type MqttClient } from "mqtt";
import { readFile } from "node:fs/promises";
import { config } from "../config.js";
import { log } from "../log.js";

/**
 * Live printer status straight from Bambu Cloud.
 *
 * The Raspberry Pi is not in this path and does not need to be. Bambu's
 * January 2025 Authorization Control System put *control* behind a login wall —
 * starting a print, moving an axis, changing a temperature — but explicitly
 * left the printer's own MQTT status push alone, which is all this reads. So a
 * container in Frankfurt can watch eight printers in Batroun without a tunnel,
 * a forwarded port, or anything running at home.
 *
 * Ported from his own Python farm manager, deliberately field for field, so the
 * numbers on the page are the numbers he already trusts.
 */

const HOST = "mqtts://us.mqtt.bambulab.com:8883";
const PUSHALL = JSON.stringify({
  pushing: { sequence_id: "1", command: "pushall", version: 1, push_target: 1 },
});
// The printers push deltas. A periodic pushall asks for the whole object again,
// which is how a field that stopped changing hours ago is still correct.
const PUSHALL_EVERY_MS = 5 * 60_000;
const STALE_AFTER_MS = 3 * 60_000;

export type Tray = { id: string; color: string; type: string; remain: number; active: boolean };
export type Hms = { code: string; severity: string; text: string };
export type Snapshot = {
  devId: string; name: string; model: string;
  state: string; stale: boolean; online: boolean;
  percent: number; remainingMin: number; layer: number; totalLayers: number;
  job: string; hasCover: boolean; nozzle: number; nozzleTarget: number; bed: number; bedTarget: number;
  trays: Tray[]; hms: Hms[]; lastUpdate: number;
};

type Device = { dev_id: string; name: string; dev_product_name: string; online: boolean };

const state = new Map<string, Record<string, unknown>>();
const lastMsg = new Map<string, number>();
let devices: Device[] = [];
let client: MqttClient | null = null;
let hmsCodes: Record<string, string> = {};

export function isConfigured(): boolean {
  return Boolean(config.bambu.username && config.bambu.accessToken);
}

/** Bambu rejects generic user agents, so these headers are not optional. */
const HEADERS = {
  "User-Agent": "bambu_network_agent/01.09.05.01",
  "X-BBL-Client-Name": "OrcaSlicer",
  "X-BBL-Client-Type": "slicer",
  "X-BBL-Client-Version": "01.09.05.51",
  "X-BBL-Language": "en-US",
  "X-BBL-OS-Type": "linux",
  "X-BBL-OS-Version": "6.1",
  "Content-Type": "application/json",
};

async function fetchDevices(): Promise<Device[]> {
  const res = await fetch("https://api.bambulab.com/v1/iot-service/api/user/bind", {
    headers: { ...HEADERS, Authorization: `Bearer ${config.bambu.accessToken}` },
  });
  if (!res.ok) throw new Error(`Bambu bind ${res.status}`);
  const body = (await res.json()) as { devices?: Device[] };
  return body.devices ?? [];
}

/** The printers send partial objects; anything not merged is lost. */
function deepMerge(dst: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(src)) {
    const cur = dst[k];
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) {
      deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      dst[k] = v;
    }
  }
}

function hmsCode(attr: number, code: number): string {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(8, "0");
  const a = hex(attr), c = hex(code);
  return `${a.slice(0, 4)}_${a.slice(4)}_${c.slice(0, 4)}_${c.slice(4)}`;
}

/** Bambu encodes severity in bits 16-31 of the code. */
function severity(code: number): string {
  return ({ 1: "fatal", 2: "serious", 3: "common", 4: "info" } as Record<number, string>)[
    (code >> 16) & 0xffff
  ] ?? "unknown";
}

export async function start(): Promise<void> {
  if (!isConfigured()) {
    log.info("bambu not configured — skipping live printer status");
    return;
  }
  try {
    hmsCodes = JSON.parse(
      await readFile(new URL("../../assets/hms_codes.json", import.meta.url), "utf-8"),
    );
    devices = await fetchDevices();
  } catch (err) {
    log.warn({ err }, "bambu device list failed — live status unavailable");
    return;
  }

  client = mqtt.connect(HOST, {
    username: config.bambu.username,
    password: config.bambu.accessToken,
    reconnectPeriod: 15_000,
    keepalive: 30,
    protocolVersion: 4,
  });

  client.on("connect", () => {
    log.info({ printers: devices.length }, "bambu mqtt connected");
    for (const d of devices) {
      client!.subscribe(`device/${d.dev_id}/report`);
      client!.publish(`device/${d.dev_id}/request`, PUSHALL);
    }
  });

  client.on("message", (topic, payload) => {
    const devId = topic.split("/")[1];
    if (!devId) return;
    try {
      const body = JSON.parse(payload.toString()) as { print?: Record<string, unknown> };
      if (!body.print) return;
      const cur = state.get(devId) ?? {};
      deepMerge(cur, body.print);
      state.set(devId, cur);
      lastMsg.set(devId, Date.now());
    } catch {
      // A malformed frame is not worth a log line every few seconds.
    }
  });

  client.on("error", (err) => log.warn({ err: err.message }, "bambu mqtt error"));

  setInterval(() => {
    if (!client?.connected) return;
    for (const d of devices) client.publish(`device/${d.dev_id}/request`, PUSHALL);
  }, PUSHALL_EVERY_MS).unref();
}

const num = (s: Record<string, unknown>, k: string): number => {
  const v = Number(s[k]);
  return Number.isFinite(v) ? v : 0;
};

export function snapshots(): Snapshot[] {
  return devices.map((d) => {
    const s = state.get(d.dev_id) ?? {};
    const last = lastMsg.get(d.dev_id) ?? 0;

    const hms: Hms[] = [];
    for (const h of (s.hms as { attr?: number; code?: number }[] | undefined) ?? []) {
      if (typeof h.attr !== "number" || typeof h.code !== "number") continue;
      const code = hmsCode(h.attr, h.code);
      hms.push({ code, severity: severity(h.code), text: hmsCodes[code] ?? code });
    }

    const trays: Tray[] = [];
    const ams = s.ams as { ams?: { tray?: Record<string, unknown>[] }[]; tray_now?: unknown } | undefined;
    const activeTray = ams?.tray_now != null ? String(ams.tray_now) : "";
    for (const unit of ams?.ams ?? []) {
      for (const t of unit.tray ?? []) {
        if (!t.tray_color) continue;
        const id = String(t.id ?? "");
        trays.push({
          id, color: String(t.tray_color).slice(0, 6), type: String(t.tray_type ?? ""),
          remain: Number(t.remain ?? -1), active: id === activeTray,
        });
      }
    }

    return {
      devId: d.dev_id, name: d.name, model: d.dev_product_name,
      state: String(s.gcode_state ?? "") || (last ? "IDLE" : "NO DATA"),
      stale: last > 0 && Date.now() - last > STALE_AFTER_MS,
      online: d.online,
      percent: num(s, "mc_percent"),
      remainingMin: num(s, "mc_remaining_time"),
      layer: num(s, "layer_num"),
      totalLayers: num(s, "total_layer_num"),
      job: String(s.subtask_name ?? s.gcode_file ?? ""),
      hasCover: Boolean(s.task_id) && String(s.task_id) !== "0",
      nozzle: Math.round(num(s, "nozzle_temper")),
      nozzleTarget: Math.round(num(s, "nozzle_target_temper")),
      bed: Math.round(num(s, "bed_temper")),
      bedTarget: Math.round(num(s, "bed_target_temper")),
      trays: trays.slice(0, 8), hms, lastUpdate: last,
    };
  });
}

export function connected(): boolean {
  return Boolean(client?.connected);
}

/**
 * The plate thumbnail for whatever a printer is currently running.
 *
 * The MQTT report only carries a real task_id for jobs sliced through the
 * cloud; a reprint from the SD card reports "0" and has no cloud record, so
 * there is simply no image for those. For a real id, Bambu's task history
 * already holds the job while it is still printing, with a short-lived
 * presigned cover URL — hence the cache and the proxy.
 */
const covers = new Map<string, { at: number; url: string | null }>();
const COVER_TTL_MS = 5 * 60_000;

export function taskIdOf(devId: string): string {
  return String((state.get(devId) ?? {}).task_id ?? "");
}

export async function coverUrl(devId: string, taskId: string): Promise<string | null> {
  if (!taskId || taskId === "0") return null;
  const key = `${devId}:${taskId}`;
  const hit = covers.get(key);
  if (hit && Date.now() - hit.at < COVER_TTL_MS) return hit.url;

  let url: string | null = null;
  try {
    const res = await fetch(
      `https://api.bambulab.com/v1/user-service/my/tasks?deviceId=${encodeURIComponent(devId)}&limit=5`,
      { headers: { ...HEADERS, Authorization: `Bearer ${config.bambu.accessToken}` } },
    );
    if (res.ok) {
      const body = (await res.json()) as { hits?: { id?: unknown; cover?: string }[] };
      url = body.hits?.find((h) => String(h.id) === String(taskId))?.cover ?? null;
    }
  } catch (err) {
    log.warn({ err, devId }, "thumbnail lookup failed");
  }
  covers.set(key, { at: Date.now(), url });
  return url;
}

/** Proxied so an <img> never carries Bambu credentials and never 403s on expiry. */
export async function coverBytes(devId: string): Promise<{ body: Buffer; type: string } | null> {
  const url = await coverUrl(devId, taskIdOf(devId));
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return {
      body: Buffer.from(await res.arrayBuffer()),
      type: res.headers.get("content-type") ?? "image/png",
    };
  } catch {
    return null;
  }
}
