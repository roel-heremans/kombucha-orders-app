# New-Delivery Prefill (last delivery) — Design Spec

Date: 2026-07-18
Status: design complete, implementation pending

## Goal

On the admin **New delivery** form, when a customer is selected, pre-fill the
line items (size + flavour + quantity) from that customer's **most recent
delivery**, so a routine repeat delivery is one tap to save.

## Decisions

- **Source:** the customer's last **delivery** (admin's own records; always
  available), sorted by delivery `date` descending. Not app orders.
- **Trigger:** fires when the admin **manually selects a customer** in the New
  delivery form's dropdown, in plain "new" mode — **not** when editing an existing
  delivery (`A.editDelivery`) or fulfilling an order (`A.fulfilOrder`), which set
  their own items.
- **Items only** — date defaults to today (unchanged), note/empties stay blank.
- **No prior delivery** → a single blank line (today's behavior).
- The lines are fully editable after prefill (change size/flavour/qty, add/remove
  lines). Re-selecting a different customer re-fills from that customer's last
  delivery.

## Mechanism

### `lib.js` — `lastDeliveryItems(deliveries, customerId)`

Pure, unit-tested:
```
lastDeliveryItems(deliveries, customerId) -> [ { sizeId, flavourId, quantity }, … ]
```
- Filter to `d.customerId === customerId`; sort by `date` desc; return a shallow
  copy of the newest delivery's `items` (`{sizeId, flavourId, quantity}` each);
  `[]` when the customer has no deliveries.

### Delivery-form view (`index.html`)

In the `#cust` change handler (which already handles `"__new__"` = add customer),
add a branch: when the new value is a real customer id **and** `!editing` **and**
`!fulfilling`, rebuild `#items` from `KO.lastDeliveryItems(A.state.deliveries,
value)` — one `itemRow(item)` per returned item, or a single blank `itemRow()`
when none — then `updateSubtotal()`.

Notes:
- Programmatically setting `#cust.value` (as `editDelivery`/`fulfilOrder` do) does
  **not** fire `change`, and the `!editing && !fulfilling` guard is a second
  safeguard — so those flows are unaffected.
- `itemRow(item)` already pre-selects size/flavour and sets quantity; `itemRow()`
  with no arg yields a blank row (used by the "Add line" button).
- Data escaped as today; deleted flavour/size on a prefilled line shows blank and
  won't submit an invalid line (`onSave` requires size+flavour+qty>0).

## Testing

- `lib.js`: unit-test `lastDeliveryItems` — newest-by-date delivery's items,
  filter by customerId, `[]` when none.
- Manual (admin, browser): New tab → pick a customer with a prior delivery → the
  item lines pre-fill (size + flavour + qty), editable, subtotal updates; a
  customer with no deliveries → one blank line; **Edit** an existing delivery and
  **Fulfil** an order still pre-fill from their own source (unaffected); saving
  works.

## Out of scope

- Prefilling date, note, or empties.
- App orders as the source (deliveries only, per the decision).
- Preserving typed-but-unsaved lines when switching customer (switching re-fills).
