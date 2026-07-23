# Unpaid Deliveries / Open Payments — Design Spec

Date: 2026-07-23
Status: design approved, implementation pending

## Goal

Track which deliveries are paid vs. unpaid (some customers pay at delivery, some
after receiving the monthly recibo verde), and give the admin an **Open Payments**
worklist of everything still owed, grouped by customer and month, with one-tap
settling.

## Data model

- Deliveries gain a boolean **`paid`** field. Absent/`false` = unpaid; `true` = paid.
- **Amount owed per delivery = `KO.deliveryRevenue(d, sizes)`** (product price only;
  bottle deposits are separate accounting and do not reduce it).
- New deliveries **default to unpaid** (`paid: false`).
- No payment-date field (YAGNI); the flag is the single source of truth.

## Rollout / cutoff (existing deliveries)

Existing deliveries have no `paid` field, so they'd all show as unpaid. The
Payments tab includes a one-time **"Settle all unpaid up to [date]"** control
(date defaults to **yesterday**): it marks every unpaid delivery dated on/before
the chosen date as `paid: true` in a batch. Run once at launch → the backlog
clears and only deliveries from today onward are tracked. The control stays
available for bulk-settling a past period later. No permanent hidden date logic —
the `paid` flag remains authoritative.

## `lib.js` — `openPayments(deliveries, sizes)`

Pure, unit-tested. Returns the grouped open-payments structure:
```
openPayments(deliveries, sizes) -> {
  grandTotal: Number,                         // sum of all unpaid amounts
  customers: [
    { customerId, total,                      // customer's total owed
      months: [
        { monthKey, total,                    // month subtotal
          items: [ { id, date, amount } ] } ] } ]
}
```
- Includes only deliveries where `!d.paid` **and** `deliveryRevenue(d, sizes) > 0`.
- Groups by `customerId`, then `monthKey(d.date)`.
- Deterministic ordering: customers by `customerId`; months newest-first; items by
  `date` newest-first. (The UI re-sorts customers by name.)

## `index.html`

### Payment mutations (module block, near other `window.APP.*` delivery ops)
- `window.APP.setDeliveryPaid(id, paid)` → `updateDoc(doc(db,"deliveries",id), { paid })`.
- `window.APP.setDeliveriesPaid(ids, paid)` → batch update (`writeBatch`, chunked at
  ≤500 ops) setting `paid` on each id. Used by "Mark month paid" and the cutoff.

### New/Edit delivery form
- Add a **"Paid" checkbox** (`#dpaid`), default unchecked.
- `readForm()` includes `paid: #dpaid.checked`.
- `editDelivery()` sets the checkbox from the delivery's `paid`.

### Deliveries list
- Each delivery shows a **Paid/Unpaid badge** (reuse `.pill`: `pill-ok` "Paid ✓" /
  `pill-muted` "Unpaid") and a one-tap **toggle** ("Mark paid" / "Mark unpaid" via
  `A.setDeliveryPaid(d.id, !d.paid)`) — reversible.

### Payments tab (new)
- **Nav:** add `<button data-view="payments">Payments</button>`.
- **View container:** add `<div id="view-payments" class="view hidden"></div>`.
- **Renderer** (new `<script>` block, `A.renderers.payments = render;`), built from
  `KO.openPayments(A.state.deliveries, sizes)`:
  - **Grand total owed** at the top.
  - **"Settle all unpaid up to [date]"**: a date input (default yesterday) + button
    → collects unpaid delivery ids with `date <= cutoff` and calls
    `A.setDeliveriesPaid(ids, true)`.
  - **Customer** (name via `A.customerName`, sorted by name) → total owed
    - **Month** (`KO.monthName(mk) + " " + year`) → subtotal + **"Mark month paid"**
      (`A.setDeliveriesPaid(monthItemIds, true)`)
      - each delivery: date + `€amount` + **"Mark paid"** (`A.setDeliveryPaid(id, true)`)
  - **Empty state**: "All caught up — nothing unpaid." when `grandTotal`/customers
    are empty.
- The view auto-refreshes: `APP.render()` runs on every Firestore snapshot, so
  marking paid updates the list immediately.
- Admin-only automatically (the whole nav/appView is the admin app; restaurants use
  the separate restaurant view).

## Testing

- `lib.js`: unit-test `openPayments` — grouping by customer+month, totals
  (grand/customer/month), exclusion of paid and zero-revenue deliveries, ordering.
- Manual: add a delivery with Paid unchecked → appears in Payments under its
  customer/month; "Mark paid" removes it; "Mark month paid" clears the month;
  "Settle up to [date]" clears the backlog; Deliveries list badge/toggle reflects
  and can reverse state.

## Out of scope

- Partial payments / payment amounts (a delivery is paid or not).
- Payment dates/history, receipts, or reconciliation reports.
- Restaurant-facing payment status (admin-only feature).
- Linking `paid` to the recibo record automatically.
