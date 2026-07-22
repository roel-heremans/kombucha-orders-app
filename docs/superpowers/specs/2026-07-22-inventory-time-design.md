# Time-precise Inventory (date + time on actions) — Design Spec

Date: 2026-07-22
Status: design complete, implementation pending

## Goal

Make the available-to-sell / consumption reconciliation order actions by **date
+ time**, not just day — so a delivery, a stocktake, and a bottling on the same
day sort in exact order and the inventory stays correct. Fixes the previously
flagged same-day ambiguity.

## Decisions

- Each stock-affecting action gains a **`time`** ("HH:MM") alongside its existing
  **`date`** ("YYYY-MM-DD"). The `date` field is unchanged (so dashboard, recibo,
  revenue — all day-based — are untouched); `time` is new.
- **Actions with a time:** deliveries, stocktakes, bottling (batch `step4`), and
  270 ml conversions. Batch steps 1–3 stay day-only (they don't move sellable
  stock).
- **Time input:** a time box next to each date, **pre-filled with the current
  time**, editable.
- **Existing records** (no `time`) are treated as **00:00** (start of day) — they
  sort before any same-day stocktake. Editable if needed.
- **No Firestore rules change** — these are new fields on already-admin-only
  collections.

## `lib.js` — moment-based reconciliation

Add a comparable "moment" and switch the stock functions from comparing `date`
to comparing the moment:

- `actionMoment(rec)` → `rec.date + "T" + (rec.time || "00:00")` (e.g.
  `"2026-07-22T18:30"`), or `""` when there's no date. **Exported** (the view
  uses it too). Lexical string comparison of these is chronological.
- `producedPerSize(batches, afterMoment, throughMoment)` and
  `deliveredPerSize(deliveries, afterMoment, throughMoment)` — compare each
  event's `actionMoment(...)` with `> afterMoment` (exclusive) / `<= throughMoment`
  (inclusive). **Args are now moments**, not dates.
- `latestStocktake(stocktakes, asOfMoment)` — greatest `actionMoment(s)` `<=
  asOfMoment` (or greatest when falsy).
- `availableToSell(stocktakes, batches, deliveries)` — base = latest stocktake;
  `produced`/`delivered` since `actionMoment(base)`. Signature unchanged.
- `consumptionPeriods(stocktakes, batches, deliveries)` — sort stocktakes by
  `actionMoment` asc; each period computes over `(actionMoment(prev),
  actionMoment(cur)]`, and now carries **`toMoment: actionMoment(cur)`** (plus the
  existing `fromDate`/`toDate` for display) so the view can match a period to its
  stocktake precisely even when two stocktakes share a day.

**Backward compatibility:** with date-only data, every moment ends in `T00:00`,
so all comparisons and the existing higher-level tests (`availableToSell`,
`consumptionPeriods`, `sumConsumption`) produce identical results — the change
only adds precision when times are present. The direct `producedPerSize` /
`deliveredPerSize` unit tests are updated to pass moment strings (`…T00:00`) to
match the new arg contract, plus a new test proving same-day ordering (e.g. a
delivery at 14:00 counts before a stocktake at 18:00; one at 20:00 does not).

## UI — time inputs (default now, editable)

A small `nowTime()` → `"HH:MM"` helper (local time) seeds the defaults.

- **New delivery form** (delivery-form IIFE): add a **Time** input (`#dtime`)
  next to the date, default `nowTime()`; `readForm` returns `time`. `A.editDelivery`
  populates `#dtime` from `d.time`; `A.fulfilOrder` leaves it at the default (now).
  The Deliveries list shows the time next to the date.
- **Record stocktake** (production IIFE): add a **Time** input (`#stTime`), default
  `nowTime()`; the saved stocktake includes `time`. Stocktake rows show the time.
- **Batch edit** (production IIFE): add a **Time** to **Step 4 (bottling)** and to
  each **270 ml conversion row**, default `nowTime()` for new ones; `readForm`
  includes `step4.time` and each `conversion.time`; the edit card populates them
  from existing values. The 270 ml auto-fill of "1 L used" is unchanged.

All values escaped as today; time parsed as the raw `"HH:MM"` input value.

## Testing

- `lib.js`: `actionMoment` (date+time, missing time → `T00:00`, no date → `""`);
  moment-based `producedPerSize`/`deliveredPerSize` incl. exclusive-start /
  inclusive-end at the same day with differing times; `availableToSell` and
  `consumptionPeriods` unchanged on date-only fixtures, and a new same-day
  time-ordering scenario; `consumptionPeriods` carries `toMoment`.
- Manual (admin, browser): enter a delivery, a stocktake, and a bottling on the
  same day with different times → Available to sell and consumption reflect the
  correct order; editing shows the saved time; date-only historical records still
  reconcile; the dashboard/recibo are unaffected.

## Out of scope

- Time on batch steps 1–3, or on any day-based view (dashboard windows, recibo).
- Timezone handling beyond the browser's local time (single-region use).
- Back-filling times on existing records automatically (they default to 00:00;
  edit to set a time).
