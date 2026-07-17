# Available-to-Sell Stock & Consumption — Design Spec

Date: 2026-07-17
Status: design complete, implementation pending

## Goal

Replace the rough "family consumption = produced − sold" estimate with a proper
**stock model**: an admin records a physical count of sellable bottles ("Available
to sell", per size) on a date; the app tracks that stock forward (production adds,
deliveries subtract); and **private consumption is reconciled** from the gap
between expected and actual at each new stocktake.

Admin-only, on the Production tab. Builds on the existing production (batches) and
deliveries data.

## Model

### Stocktake
A physical count of sellable bottles per size on a date:
```
{ date: "YYYY-MM-DD", counts: { "1L": 30, "270ml": 12 }, createdAt }
```
Stored in a new **admin-only `stocktakes`** collection. Set once and re-recorded
(reset) whenever the admin recounts.

### Available to sell (now)
Computed from the **latest** stocktake + everything since (events dated **after**
the stocktake date; same-day events are considered already in the count):

- **1 L:** `counts["1L"]` + (Σ `step4.bottles1L` − Σ `conversion.used1L`) since − (1 L delivered since)
- **270 ml:** `counts["270ml"]` + (Σ `conversion.count270`) since − (270 ml delivered since)
- **Any other size:** `counts[size]` − (delivered since) (no production feeds it)

Empties (returned bottles) do **not** affect it — they're empties, not sellable
stock. Only **delivered** orders subtract (requested/open orders don't). Requires
at least one stocktake; before that the card prompts the admin to record one.

### Private consumption (reconciliation)
Between two consecutive stocktakes `prev` (date P) and `cur` (date C), for each
size:
```
expected = prev.counts[size] + producedSince(P,C)[size] − deliveredSince(P,C)[size]
consumed[size] = expected − cur.counts[size]
```
(events with `date > P && date <= C`). **Total private consumption** = the sum of
`consumed` across all consecutive stocktake pairs — per size, and in liters via
`sizeLiters`. This is the accurate figure; it **replaces** the windowed
"produced − sold" family line. Consumed can be negative (counted more than
expected = an untracked addition/miscount) — shown as-is.

## `lib.js` helpers (pure, unit-tested)

Date-range predicate: event date `> afterDate` (exclusive; skip if `afterDate`
falsy) and `<= throughDate` (inclusive; skip if `throughDate` falsy), comparing
`"YYYY-MM-DD"` strings.

- `producedPerSize(batches, afterDate, throughDate)` → `{ "1L": <bottled1L −
  used1L in range>, "270ml": <count270 in range> }`. (Production maps to the
  canonical size ids **`1L`** / **`270ml`** — the batch model bottles 1 L and
  converts to 270 ml; see Assumption.)
- `deliveredPerSize(deliveries, afterDate, throughDate)` → `{ sizeId: qty, … }`
  summing delivery `items` in range.
- `latestStocktake(stocktakes, asOfDate)` → the stocktake with the greatest
  `date` `<= asOfDate` (or greatest date when `asOfDate` falsy); `null` if none.
- `availableToSell(stocktakes, batches, deliveries)` → `{ sizeId: count, … }`
  using the latest stocktake as the base and production/deliveries since; `null`
  if there is no stocktake.
- `consumptionPeriods(stocktakes, batches, deliveries)` → `[{ fromDate, toDate,
  consumed: { sizeId: n, … } }]`, one entry per consecutive stocktake pair
  (stocktakes sorted ascending by date); `[]` if fewer than 2 stocktakes.
- `sumConsumption(periods)` → `{ sizeId: total, … }` (fold of the periods).

Reuses existing `sizeById` and `sizeLiters`.

### Assumption

Production feeds the two canonical sizes by id: **`1L`** (`+bottled1L −used1L`) and
**`270ml`** (`+count270`) — the app's default size ids. Deliveries feed whatever
size ids appear in delivery items. A renamed/added size still tracks via
deliveries + stocktakes; only production auto-feed is tied to `1L`/`270ml`.

## Data-layer wiring

- Admin `onLogin`: `watch("stocktakes", S.stocktakes)`; add `stocktakes: []` to
  state.
- CRUD on `A`: `addStocktake(o)` (addDoc), `deleteStocktake(id)` (deleteDoc).
  (No update — a correction is a new stocktake or a delete + re-add.)
- Not in the restaurant data layer (admin-only).

## Security rules

Add to `firestore.rules` (admin-only, like `batches`):
```
match /stocktakes/{id} {
  allow read, write: if isAdmin();
}
```
Requires a rules redeploy (console + playground check that a non-admin is
denied), provided at implementation time.

## Production tab UI

Keep the existing window control + the "Produced (window)" summary (1 L bottled,
270 ml made, 1 L used, Sold) but **remove the old "Family consumption (produced −
sold)" line**. Add below it:

- **Available to sell** card: if no stocktake → a prompt to record the first one;
  else the current expected count per size (from `availableToSell`), with the
  latest stocktake date shown for context.
- **Record stocktake** form: a count input per size (from settings sizes) + a
  date (default today) + Save → `addStocktake({ date, counts, createdAt })`.
- **Stocktakes & consumption** card: the list of stocktakes (date + per-size
  counts), each interval annotated with its reconciled `consumed` per size; a
  **Total private consumption** line (per size + liters via `sizeLiters`); and a
  Delete per stocktake.

All data escaped with `A.esc(...)`; counts parsed with `parseInt` (default 0).

## Testing

- `lib.js`: unit tests for the date-range behavior of `producedPerSize` /
  `deliveredPerSize` (exclusive start, inclusive end, open-ended), `latestStocktake`
  (picks max date ≤ asOf; null when none), `availableToSell` (opening + produced −
  delivered per size; null when no stocktake; other-size via deliveries only), and
  `consumptionPeriods` + `sumConsumption` (expected − actual per interval, negative
  allowed, `[]` for <2 stocktakes). A `STOCKTAKES` fixture + reuse of `BATCHES`
  and a small deliveries fixture.
- Manual (admin, after rules redeploy): record a first stocktake → Available to
  sell shows it; add a batch bottling + a delivery → Available updates
  (up by bottled, down by delivered); record a second stocktake below expected →
  the interval and total consumption reflect the gap (per size + liters); a
  restaurant cannot access `stocktakes`.

## Out of scope

- A per-transaction stock ledger / audit trail (only stocktake snapshots +
  derived figures).
- Restaurant visibility of stock.
- Auto-suggesting a stocktake count from expected (the admin always types the
  physical count).
- Deposit/empties stock (empties are tracked separately for deposits; not part of
  sellable stock).
