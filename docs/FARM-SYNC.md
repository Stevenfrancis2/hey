# The farm sync — design

**Status: proposed, not built.** Read this and tell me what's wrong before I write code.

The print farm stays on the Raspberry Pi. The printers are on the local network, a
container in Paris cannot reach them, and nothing here asks you to forward a port or
expose the Pi. The Pi pushes; Second Steven never calls in.

---

## What the farm manager already has

Read from `C:\dev-cligli` (deployed to the Pi as `~/bambufarm`). Three stores:

| Store | Shape | Holds |
|---|---|---|
| `data/history.db` | SQLite, table `jobs` | 268 rows, 5–30 July. `dev_id`, `printer_name`, `job_name`, `start_ts`, `end_ts`, `outcome` (`FINISH`/`FAILED`), `duration_s`, `percent_at_end`, `task_id` |
| `data/filament.json` | JSON, 47 lines | `brand`, `material`, `color`, `spool_weight_g`, `quantity`, `threshold_g`, `open_spools` (grams left in each opened spool) |
| `data/pricing.json` | JSON | products with **estimated** `filament_g`, `days`/`hours`, `units_per_print`, `my_price`; globals — filament `$20/kg`, `0.4 kW`, `$0.65/kWh`, H2C `0.5x` (solar), addon `$0.15`, packaging `$0.20`, fail rate `0.15` |

Eight printers: `A1Combo1`, `A1Combo2`, `A1combo3`, `A1combo4`, `A1Combo5`, `A1Combo6`,
`A1Combo7`, `H2C-JP`. Seven A1s and the H2C — CLAUDE.md is right; the farm manager's
own project notes claim eight A1s and are wrong.

> The casing is inconsistent (`A1Combo3` vs `A1combo3`). Any grouping by name that is
> case-sensitive will split those two printers apart. Worth normalising at the source.

## What nothing currently knows

**Grams consumed per job.** `jobs` records duration and outcome; it never records
filament used. `filament.json` records stock but not what depleted it.

**What filament actually cost.** `filament.json` has no price field at all, and
`pricing.json` assumes a flat `$20/kg` for everything. In Lebanon, landed cost varies
per order and that assumption is the whole ballgame.

## Why this belongs in Second Steven rather than on the Pi

Second Steven has the **ledger** — what you actually paid, in the currency you paid it,
when you said *"we bought this"*. The Pi has **what actually ran** — real durations, real
failures. Neither can answer the costing question alone, and that is exactly the crossing
worth building:

- *"The clicker is priced at 6h a print. Across 47 real prints it averaged 2h07m —
  your electricity line is wrong in your favour."*
- *"Pricing assumes $20/kg. The last PLA you booked landed at $26/kg. Every clicker
  is 9c thinner than the sheet says."*
- *"37 of 268 jobs failed, at 24.5% through on average. That is ~3.4% of filament
  wasted — you are charging a 15% failure uplift. You are pricing yourself high."*

The last one is not what you asked for. You asked whether jobs are **under**priced. On
this data the failure line looks **over**costed, and I would rather say so.

---

## The sync

**Outbound only.** A systemd timer on the Pi POSTs every 15 minutes. If the Pi is off,
nothing breaks; the next push carries what was missed.

```
Pi (~/bambufarm)  ──POST /farm/push──►  Second Steven (Fly)
   history.db          bearer token         farm_jobs
   filament.json       gzip JSON            farm_filament
```

**Auth.** A single `FARM_PUSH_TOKEN` secret, compared with `timingSafeEqual`, same as
the webhook secret is today. Not the session secret, not the Telegram secret — a third
key with its own job.

**Idempotent.** Each job is keyed by `(dev_id, task_id, end_ts)`. Re-sending the same
window is a no-op, so the Pi can push a rolling seven days every time and never track
what it has already sent. A watermark that drifts is how sync systems lose rows.

**Payload** (the Pi only reads its own files; no new dependency, `requests` is already
in `requirements.txt`):

```json
{
  "sent_at": 1788000000,
  "jobs": [{"dev_id":"...","printer_name":"A1Combo1","job_name":"Keycaps Clicker",
            "start_ts":1787900000,"end_ts":1787907600,"outcome":"FINISH",
            "duration_s":7600,"percent_at_end":100,"task_id":"..."}],
  "filament": [{"id":"c57e15d0d63c","brand":"Bambu Lab","material":"PLA Basic",
                "color":"Black","spool_weight_g":1000,"quantity":2,"open_spools":[50.0]}]
}
```

**New tables** in `db/schema.sql`, additive and idempotent like everything else:

- `farm_jobs` — the rows above, plus `unique (dev_id, task_id, end_ts)`
- `farm_filament` — current stock per line, replaced wholesale each push
- `farm_pushes` — when the Pi last spoke, so the Cligli room can say "the farm has
  been quiet for two days" instead of quietly showing stale numbers

**New agent tools**, in the Cligli room:

- `farm_status` — what is printing, what stock is low
- `job_costing(product)` — estimated vs actual duration, estimated vs ledger filament
  price, and the honest margin
- `farm_failures(days)` — failure rate and the wasted-grams estimate

## What I need from you before building

1. **Is `C:\dev-cligli` the farm manager you meant?** It matches, but you said you would
   point me at it and I found it myself.
2. **Is the Pi currently running?** The history stops on 30 July.
3. **Does the Pi have outbound internet** to a Fly URL, or only Cloudflare Tunnel inbound?
4. **Filament cost** — do you want to start booking spool purchases into the ledger with
   material and grams, so the costing has real prices to work from? Without that, the
   crossing still works on duration but the filament half stays an assumption.
5. **Grams per job** — Bambu Cloud may expose per-job filament usage over MQTT that the
   current code does not store. Worth me checking, or is estimating from `pricing.json`
   plus `percent_at_end` good enough?
