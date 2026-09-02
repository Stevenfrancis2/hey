import { config } from "../config.js";
import { listGear } from "../memory/gear.js";

/**
 * Open-Meteo: free, no API key, no account, hourly gusts. The gust column is the
 * one that matters — mean wind looks fine on days that are unflyable.
 */
const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

export type Forecast = {
  hourly: {
    time: string[];
    wind_speed_10m: number[];
    wind_gusts_10m: number[];
    precipitation_probability: number[];
    temperature_2m: number[];
    cloud_cover: number[];
  };
  daily: { time: string[]; sunrise: string[]; sunset: string[] };
};

export type Window = { start: string; end: string; maxGust: number; maxWind: number };
export type AircraftOutlook = {
  aircraft: string;
  windLimit: number;
  gustLimit: number;
  windows: Window[];
  verdict: string;
};

export async function fetchForecast(days = 3): Promise<Forecast> {
  const url =
    `${ENDPOINT}?latitude=${config.location.latitude}&longitude=${config.location.longitude}` +
    `&hourly=wind_speed_10m,wind_gusts_10m,precipitation_probability,temperature_2m,cloud_cover` +
    `&daily=sunrise,sunset&timezone=${encodeURIComponent(config.timezone)}&forecast_days=${days}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo failed (${response.status})`);
  return (await response.json()) as Forecast;
}

function hourIsFlyable(
  f: Forecast,
  i: number,
  windLimit: number,
  gustLimit: number,
): boolean {
  return (
    (f.hourly.wind_speed_10m[i] ?? 99) <= windLimit &&
    (f.hourly.wind_gusts_10m[i] ?? 99) <= gustLimit &&
    (f.hourly.precipitation_probability[i] ?? 100) <= 30
  );
}

/**
 * One answer per aircraft, because they are not remotely comparable: a day the
 * 5-inch enjoys will pin the Meteor 75 to the ceiling indoors.
 */
/** `injected` exists so the window logic can be tested without the network. */
export async function flyability(days = 2, injected?: Forecast): Promise<{
  location: string;
  outlooks: AircraftOutlook[];
  daylight: { date: string; sunrise: string; sunset: string }[];
}> {
  const [forecast, drones] = await Promise.all([
    injected ? Promise.resolve(injected) : fetchForecast(days),
    listGear("drone"),
  ]);

  const daylight = forecast.daily.time.map((date, i) => ({
    date,
    sunrise: (forecast.daily.sunrise[i] ?? "").slice(11, 16),
    sunset: (forecast.daily.sunset[i] ?? "").slice(11, 16),
  }));

  // Only daylight hours count — you cannot fly line-of-sight in the dark.
  const isDaylight = (time: string): boolean => {
    const date = time.slice(0, 10);
    const day = daylight.find((d) => d.date === date);
    if (!day) return false;
    const hhmm = time.slice(11, 16);
    return hhmm >= day.sunrise && hhmm <= day.sunset;
  };

  const outlooks: AircraftOutlook[] = drones.map((drone) => {
    const windLimit = Number(drone.specs.wind_limit_kmh ?? 20);
    const gustLimit = Number(drone.specs.gust_limit_kmh ?? windLimit * 1.2);

    const windows: Window[] = [];
    let open: Window | null = null;

    forecast.hourly.time.forEach((time, i) => {
      const ok = isDaylight(time) && hourIsFlyable(forecast, i, windLimit, gustLimit);
      if (ok) {
        const gust = forecast.hourly.wind_gusts_10m[i] ?? 0;
        const wind = forecast.hourly.wind_speed_10m[i] ?? 0;
        if (open) {
          open.end = time;
          open.maxGust = Math.max(open.maxGust, gust);
          open.maxWind = Math.max(open.maxWind, wind);
        } else {
          open = { start: time, end: time, maxGust: gust, maxWind: wind };
        }
      } else if (open) {
        windows.push(open);
        open = null;
      }
    });
    if (open) windows.push(open);

    // A single isolated hour is not worth driving to a field for.
    const real = windows.filter((w) => w.start !== w.end);

    return {
      aircraft: `${drone.brand ?? ""} ${drone.model}`.trim(),
      windLimit,
      gustLimit,
      windows: real,
      verdict:
        real.length === 0
          ? "Nothing flyable in this window."
          : `${real.length} window${real.length === 1 ? "" : "s"}.`,
    };
  });

  return { location: config.location.name, outlooks, daylight };
}

export function formatFlyability(result: Awaited<ReturnType<typeof flyability>>): string {
  const day = (t: string): string =>
    new Date(t).toLocaleDateString("en-GB", { weekday: "short" });
  const hhmm = (t: string): string => t.slice(11, 16);

  const lines = [`${result.location}`];
  for (const o of result.outlooks) {
    if (o.windows.length === 0) {
      lines.push(`\n${o.aircraft} — nothing flyable (limit ${o.windLimit} km/h, gusts ${o.gustLimit}).`);
      continue;
    }
    lines.push(`\n${o.aircraft} — limit ${o.windLimit} km/h, gusts ${o.gustLimit}`);
    for (const w of o.windows.slice(0, 4)) {
      lines.push(
        `  ${day(w.start)} ${hhmm(w.start)}–${hhmm(w.end)} · wind ${Math.round(w.maxWind)}, gusts ${Math.round(w.maxGust)}`,
      );
    }
  }
  const today = result.daylight[0];
  if (today) lines.push(`\nSunset today ${today.sunset}.`);
  return lines.join("\n");
}
