# Dashboard Analytics — Design Spec (Project A)

Date: 2026-07-16
Status: design complete, implementation pending

## Goal

Make the admin Dashboard report over a **selectable time window** instead of a
single month, and show **revenue split by customer type** (Private vs Restaurant
vs total) in the charts, including a new **yearly** revenue chart.

Covers backlog items A1 (monthly revenue split by type), A2 (date-range /
last-month window driving all stats), A3 (yearly revenue chart with the same
split).

All of this is derived from existing data (deliveries + each customer's `type`).
**No Firebase/schema changes and nothing to deploy but the static site.**

## Time window (backbone)

A control at the top of the Dashboard: a **preset dropdown** with
**This month · Last month · This year · Custom range…**. Selecting *Custom
range…* reveals two month inputs, **Start** and **End**.

Window resolves to an inclusive month range `{ startMk, endMk }` (each
`"YYYY-MM"`):

- **This month** (default on load): `start = end = current month`.
- **Last month**: `start = end = previous month`.
- **This year**: `start = <currentYear>-01`, `end = current month` (year-to-date,
  so the monthly chart has no empty future months).
- **Custom range**: the two pickers. If Start > End, treat as the single month
  End (guard against inverted ranges); both default to the current month when
  first shown.

The selected window is remembered in `A.current.dashWindow` while navigating.

### What the window applies to

- **Applies:** Revenue total, monthly split chart, window split totals,
  By-customer (chart + table), Flavour popularity.
- **Ignores the window (by decision):**
  - **Yearly revenue chart** — always all years with data.
  - **Outstanding bottles & deposit** — always the true current balance across
    all deliveries (it is a live state, not a period stat).

## Charts

### New: stacked bar chart in `lib.js`

The existing `barChartSVG` is single-series. Add `stackedBarChartSVG(bars, opts)`:

- `bars`: `[{ label, tip, segments: [{ value, color }] }]` — each bar's height is
  proportional to the sum of its segments; segments stack bottom-to-top. Every
  segment `<rect>` carries `data-tip` (and `<title>`) set to the bar's `tip`
  string, so tapping anywhere on a bar shows that bar's full breakdown in the
  chart caption (reusing the existing delegated tap-tip mechanism).
- `opts`: `{ width, height, format, legend: [{ label, color }] }`. Renders a
  small legend (color swatch + label) beneath the chart.
- Colors: two distinct, theme-consistent colors chosen per the `dataviz` skill
  (e.g. Restaurant = the app green, Private = a complementary accent). Legend
  labels: **Private** / **Restaurant**.

### A1 — Monthly revenue, split by type

One stacked bar per month in the window (from `monthKeysBetween(startMk, endMk)`),
Private + Restaurant stacked so the full bar equals the month's total. Below the
chart, window totals in text: **Private €X · Restaurant €Y · Total €Z**.

### A3 — Yearly revenue, split by type

A separate card: one stacked bar per year (all years with data, ascending),
same Private/Restaurant split. Independent of the window.

## Data model / `lib.js` additions

All pure and unit-tested (`test/lib.test.js`, `node --test`). Customer `type` is
`"private"` or (default) `"restaurant"`, matching existing
`revenueByCustomerType`.

- `monthKeysBetween(startMk, endMk)` → ascending array of `"YYYY-MM"` inclusive.
  Handles year boundaries; returns `[endMk]` if `startMk > endMk`.
- `inWindow(dateStr, startMk, endMk)` → boolean (`monthKey(dateStr)` within
  `[startMk, endMk]`).
- `revenueInWindow(deliveries, sizes, startMk, endMk)` → number.
- `revenueByCustomerInWindow(deliveries, sizes, startMk, endMk)` →
  `[{ customerId, amount }]` sorted by amount desc.
- `flavourCountsInWindow(deliveries, startMk, endMk)` →
  `[{ flavourId, quantity }]` sorted by quantity desc.
- `revenueByTypeInWindow(deliveries, sizes, customers, startMk, endMk)` →
  `{ private, restaurant, total }`.
- `revenueTypeSeries(deliveries, sizes, customers, monthKeys)` →
  `[{ monthKey, private, restaurant, total }]`, one entry per given month key
  (used for the monthly stacked chart across the window).
- `revenueTypeByYear(deliveries, sizes, customers)` →
  `[{ year, private, restaurant, total }]` for all years present, ascending
  (used for the yearly chart).

Existing single-month functions (`monthlyRevenue`, `revenueByCustomer`,
`flavourCounts`, `revenueByCustomerType`, `monthlyRevenueSeries`) stay for now
(they keep their tests); the dashboard switches to the window-based functions.
`generateRecibo` and `outstandingByCustomer` are unchanged.

A small window-label formatter (for section headings): single month →
`"Jul 2026"`; range → `"Jan–Jul 2026"` (or `"Nov 2025–Feb 2026"` across years).
Can live in `lib.js` (tested) as `windowLabel(startMk, endMk)`.

## Dashboard view changes

Rewire `view-dashboard` (currently keyed on `A.current.dashMonth`):

- Replace the single `#dashMonth` input with the window control (preset
  `<select>` + conditional Start/End month inputs). State in
  `A.current.dashWindow = { preset, startMk, endMk }`, default preset
  `"this-month"`.
- **Revenue card:** total = `revenueInWindow(...)`; monthly stacked split chart
  from `revenueTypeSeries(monthKeysBetween(start, end))`; window totals text from
  `revenueByTypeInWindow(...)`.
- **Yearly card (new):** stacked chart from `revenueTypeByYear(...)`.
- **By customer:** `revenueByCustomerInWindow(...)` (chart + table), unchanged
  shape.
- **Remove** the "By customer type" table (superseded by the split chart +
  totals).
- **Outstanding bottles & deposit:** unchanged (all-time).
- **Flavour popularity:** `flavourCountsInWindow(...)`; heading uses the window
  label.
- All data values interpolated into `innerHTML` remain escaped with `A.esc(...)`.

## Testing

- `lib.js`: unit tests for every new function — `monthKeysBetween` (incl. year
  boundary and inverted range), `inWindow`, the four window analytics, the two
  split series, and `windowLabel`. Follow the existing `test/lib.test.js` style
  and fixtures.
- Charts / dashboard: manual browser verification (no DOM harness), matching the
  repo's established pattern — verify each preset (This month, Last month, This
  year, Custom range) recomputes every section, the stacked charts render with a
  legend and correct proportions, tap-a-bar shows the breakdown, the yearly chart
  ignores the window, and Outstanding stays constant across windows.

## Out of scope (this project)

- Recibo Verde PDF distribution (Project B).
- Splitting the By-customer chart by type (only revenue totals split by type are
  requested).
- Exporting/printing the dashboard.
