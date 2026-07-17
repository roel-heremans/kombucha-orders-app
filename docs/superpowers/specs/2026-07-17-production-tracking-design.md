# Production / Fermentation Tracking — Design Spec

Date: 2026-07-17
Status: design complete, implementation pending

## Goal

Give admins (Roel + Nina) an internal log of the kombucha production process,
batch by batch, and a windowed summary of how much was made. Restaurants never
see it.

Each **batch** is auto-numbered (Batch 001, 002, …) and keeps its number through
the whole 4-step process; 270 ml bottles are a later conversion from finished
1 L bottles, recorded against the batch they came from.

## The process (per batch)

1. **Sweetened tea** — liters of water used + boil date.
2. **8 L glass jars** — number of jars filled + date.
3. **Polsinelli 70 L pot** — date the filtered jars were poured in.
4. **Bottling** — number of 1 L bottles + date.
5. **270 ml conversions** (0+, any time after bottling) — each records: number of
   270 ml bottles made, number of 1 L bottles used, and the date. The 1 L
   leftover in the last bottle is consumed (not tracked). 1 L used defaults to
   `ceil(count270 × 0.27)` and is editable.

Steps are filled in as they happen — a batch can be saved partway through.

## Data model — `batches` collection (admin-only)

```
{
  number:      3,                                    // integer, auto-increment from 1
  step1:       { waterLiters: <number>, date: "YYYY-MM-DD" },  // optional
  step2:       { jars: <number>, date: "YYYY-MM-DD" },         // optional
  step3:       { date: "YYYY-MM-DD" },                         // optional
  step4:       { bottles1L: <number>, date: "YYYY-MM-DD" },    // optional
  conversions: [ { count270: <number>, used1L: <number>, date: "YYYY-MM-DD" } ], // 0+
  createdAt:   <serverTimestamp>,
}
```

- Each `stepN` object is present only once that step is recorded (or stored as an
  empty/partial object — the view treats missing fields as "not yet recorded").
- `number` is assigned at creation as `max(existing numbers) + 1` (first batch =
  1). Displayed zero-padded to 3 digits (`"Batch 001"`); numbers ≥ 1000 display
  their full value.
- `conversions` is an array edited in place (add/remove rows) and saved with the
  batch.

## New `lib.js` helpers (pure, unit-tested)

- `nextBatchNumber(batches)` → `max(b.number) + 1`, or `1` when there are none.
- `formatBatchNumber(n)` → `"Batch " + String(n).padStart(3, "0")` →
  `"Batch 001"` … (no truncation for n ≥ 1000).
- `bottles1LForConversion(count270)` → `Math.ceil(count270 * 270 / 1000)`
  (e.g. 4 → 2, 8 → 3, 0 → 0).
- `sizeLiters(size)` → liters of one bottle of that size. Uses `size.liters` if
  it is a number; else parses the label (`"1 L"` → 1, `"270 ml"` → 0.27,
  `"500 ml"` → 0.5, `"1.5 L"` → 1.5); returns 0 if unparseable. Lets liters be
  derived from existing settings without a schema change, while allowing a future
  explicit `liters` field to take precedence.
- `soldLitersInWindow(deliveries, sizes, startMk, endMk)` → Σ over deliveries
  whose `date` is in the window of Σ items `sizeLiters(size) × quantity`.
- `productionSummary(batches, startMk, endMk)` → `{ bottled1L, made270, used1L }`:
  - `bottled1L` = Σ `step4.bottles1L` for batches whose `step4.date` is in the
    window (via existing `inWindow`). This is also the **produced liters** (1 L
    bottles × 1 L each).
  - `made270` = Σ `conversion.count270` for conversions whose `date` is in window.
  - `used1L` = Σ `conversion.used1L` for conversions whose `date` is in window.
  Missing/blank numbers count as 0; batches/conversions without a date are
  excluded.

Reuses the existing window helpers (`inWindow`, `monthKeysBetween`,
`resolveWindow`, `windowLabel`).

### Family consumption

`family consumption (L) = produced − sold`, where **produced** = `bottled1L`
(1 L bottling volume — all kombucha made; 270 ml are repackaged 1 L, not new
production) and **sold** = `soldLitersInWindow(...)` (delivered volume of every
size). This correctly captures both the 270 ml conversion leftovers and anything
drunk at home, since everything produced but not sold is consumed. Computed in
the Production view as `productionSummary.bottled1L − soldLitersInWindow(...)`.
It is a per-window figure (produced counts by bottling date, sold by delivery
date), so it is most meaningful over a wide window (This year / a Custom range
covering the whole history); a narrow month can read negatively if a batch is
sold in a later month than it was bottled.

## New "Production" view

A new nav tab **Production** and `view-production` container (admin app only).

- **Window control:** the same preset dropdown as the Dashboard (This month /
  Last month / This year / Custom range…) with its own state
  `A.current.prodWindow = { preset, startMk, endMk }`, default `this-month`.
- **Summary card** (windowed, using `productionSummary`, `soldLitersInWindow` +
  `windowLabel`): "Produced (<label>): 1 L bottled **X** · 270 ml made **Y** ·
  1 L used for 270 ml **Z**", plus **Sold: S L** and **Family consumption
  (produced − sold): X − S L** (with a one-line hint that it's most meaningful
  over a wide window).
- **"+ New batch"** button: creates a batch doc with the next number, `createdAt`,
  and empty steps, then opens that batch's edit form.
- **Batch list:** all batches, highest number first. Each batch renders as a card.

### Batch card (read + edit)

Read view shows the batch label and a compact line per recorded step, e.g.:

```
Batch 003
  Tea:      30 L water · Jul 3
  Jars:     6 × 8 L · Jul 5
  Polsinelli: Jul 9
  Bottled:  60 × 1 L · Jul 14
  270 ml:   4× (2×1L) Jul 18 · 8× (3×1L) Jul 25
  [Edit] [Delete]
```

**Edit** replaces the card with an inline form (fields for step1–4 + a conversions
editor), plus **Save** and **Cancel**:

- Step fields: water liters, jars, three step dates, 1 L bottles.
- **Conversions editor:** a list of existing conversion rows (270 ml, 1 L used,
  date, remove ✕) and an **Add conversion** row. When the "270 ml made" input
  changes, the "1 L used" field auto-fills `bottles1LForConversion(count270)`
  and stays editable.
- **Save** writes the whole batch via `updateBatch(id, data)` (reads all fields,
  drops empty step objects or stores partials — the view reads defensively).
- **Delete** removes the batch (with a confirm).

All values interpolated into `innerHTML` are escaped with `A.esc(...)`. Numeric
inputs are parsed with `parseInt`/`parseFloat` and default to 0/absent.

## Data-layer wiring

- **Admin** `onLogin`: add `watch("batches", S.batches)`; add `batches: []` to
  state.
- CRUD helpers on `A`: `addBatch(o)` (`addDoc`), `updateBatch(id, o)`
  (`updateDoc`), `deleteBatch(id)` (`deleteDoc`).
- Not wired into the restaurant data layer (restaurants have no access).

## Security rules

Add to `firestore.rules` (admin-only, like `deliveries`):

```
match /batches/{id} {
  allow read, write: if isAdmin();
}
```

Requires a **rules redeploy** (manual console step + a quick playground check
that a non-admin is denied), provided at implementation time. Restaurants can
neither read nor write batches.

## Testing

- `lib.js`: unit tests for `nextBatchNumber` (empty + gaps), `formatBatchNumber`
  (`001`, and ≥1000), `bottles1LForConversion` (0/4/8 and boundaries),
  `sizeLiters` (L/ml labels + explicit `liters` field), `soldLitersInWindow`
  (windowed delivered volume across sizes), and `productionSummary` (windowing by
  step4.date / conversion.date, blank handling).
- Manual (admin, after rules redeploy): create a batch → it gets the next number;
  fill each step + add/remove 270 ml conversions (1 L-used auto-fills, editable);
  Save persists; the windowed summary reflects bottling/conversions in the
  window; Delete works; a restaurant login cannot access `batches` (permission
  denied / feature absent).

## Rollout / setup impact

- `firestore.rules` redeployed with the `batches` block (manual, with a playground
  check).
- No Firebase plan change; no new dependencies. Static-site deploy only.

## Out of scope (v1)

- A per-bottle stock/inventory ledger (current-on-hand counts). Family
  consumption is an **aggregate liters** figure (produced − sold), not a running
  bottle inventory.
- Linking production into the sales Dashboard (production has its own tab/window).
- Tracking sugar/tea amounts, temperature, SCOBY, or fermentation duration beyond
  what the step dates imply.
- Restaurant visibility of any production data.
