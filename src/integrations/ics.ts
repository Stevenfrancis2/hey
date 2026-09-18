/**
 * Just enough iCalendar to read a published Outlook feed. Not a general parser:
 * VEVENTs, their times, recurrence rules and cancellations — the parts a
 * one-way mirror needs. No dependency, because the format is line-based and
 * the only hard part (Windows time zone names) is a lookup table.
 */

export type IcsEvent = {
  uid: string;
  /** Set on a moved or edited single occurrence of a recurring series. */
  recurrenceId: string | null;
  summary: string;
  location: string | null;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  recurrence: string[];
  cancelled: boolean;
};

/**
 * Outlook writes Windows zone names; Google wants IANA. These are the zones his
 * work calendar can plausibly carry — Chicago for the employer, Beirut for him.
 */
const WINDOWS_TZ: Record<string, string> = {
  "Central Standard Time": "America/Chicago",
  "Eastern Standard Time": "America/New_York",
  "Pacific Standard Time": "America/Los_Angeles",
  "Mountain Standard Time": "America/Denver",
  "Middle East Standard Time": "Asia/Beirut",
  "GTB Standard Time": "Europe/Bucharest",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "India Standard Time": "Asia/Kolkata",
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
};

function ianaZone(tzid: string | undefined): string | undefined {
  if (!tzid) return undefined;
  const clean = tzid.replace(/^"|"$/g, "");
  return WINDOWS_TZ[clean] ?? (clean.includes("/") ? clean : undefined);
}

/** Lines longer than 75 octets are folded with a leading space; undo that first. */
function unfold(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

/** 20260918T140000 (+Z or TZID) → Google's {dateTime,timeZone}; 20260918 → {date}. */
function toTime(value: string, params: Record<string, string>): IcsEvent["start"] {
  if (params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
    return { date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) return {};
  const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (m[7] === "Z") return { dateTime: `${local}Z` };
  return { dateTime: local, timeZone: ianaZone(params.TZID) ?? "America/Chicago" };
}

export function parseIcs(text: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  let cur: Partial<IcsEvent> & { recurrence?: string[] } | null = null;

  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") { cur = { recurrence: [], cancelled: false, recurrenceId: null, location: null }; continue; }
    if (line === "END:VEVENT") {
      if (cur?.uid && cur.start && (cur.start.date || cur.start.dateTime)) {
        out.push({
          uid: cur.uid,
          recurrenceId: cur.recurrenceId ?? null,
          summary: cur.summary ?? "(busy)",
          location: cur.location ?? null,
          start: cur.start,
          end: cur.end && (cur.end.date || cur.end.dateTime) ? cur.end : cur.start,
          recurrence: cur.recurrence ?? [],
          cancelled: cur.cancelled ?? false,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [name, ...paramParts] = line.slice(0, colon).split(";");
    const value = line.slice(colon + 1);
    const params: Record<string, string> = {};
    for (const p of paramParts) {
      const [k, v] = p.split("=");
      if (k && v !== undefined) params[k.toUpperCase()] = v;
    }

    switch (name?.toUpperCase()) {
      case "UID": cur.uid = value; break;
      case "SUMMARY": cur.summary = unescape(value); break;
      case "LOCATION": cur.location = unescape(value) || null; break;
      case "DTSTART": cur.start = toTime(value, params); break;
      case "DTEND": cur.end = toTime(value, params); break;
      case "RECURRENCE-ID": cur.recurrenceId = value; break;
      case "STATUS": if (value.toUpperCase() === "CANCELLED") cur.cancelled = true; break;
      // Google takes RRULE and EXDATE lines verbatim, so the series stays one
      // event there rather than a hundred copies.
      case "RRULE": cur.recurrence!.push(`RRULE:${value}`); break;
      case "EXDATE": {
        const tz = ianaZone(params.TZID);
        cur.recurrence!.push(`EXDATE${tz ? `;TZID=${tz}` : params.VALUE ? `;VALUE=${params.VALUE}` : ""}:${value}`);
        break;
      }
    }
  }
  return out;
}
