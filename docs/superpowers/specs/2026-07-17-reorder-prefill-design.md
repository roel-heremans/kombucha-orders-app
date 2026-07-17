# Reorder Prefill (last order) — Design Spec

Date: 2026-07-17
Status: design complete, implementation pending

## Goal

Make reordering easy for restaurants: the New-order form opens **pre-filled with
the line items (size + flavour + quantity) of their most recent non-cancelled
order**. They tweak and send.

## Decisions

- **Auto pre-filled** on form render (no button).
- **"Last order" = most recent non-cancelled** order (delivered or requested) for
  that restaurant, by `createdAt` (newest first).
- **Items only** — preferred date and note stay blank (per-order).
- **No previous order** → one blank line, exactly as today.
- **Deleted flavour/size** → that pre-filled line shows blank (the select has no
  matching option), so it won't submit an invalid line; the restaurant re-picks.

## Mechanism

### `lib.js` — `lastOrderItems(orders, customerUid)`

Pure, unit-tested:

```
lastOrderItems(orders, customerUid) -> [ { sizeId, flavourId, quantity }, … ]
```

- Filter `orders` to `customerUid === customerUid && status !== "cancelled"`.
- Sort by `createdAt.seconds` desc (missing timestamp → 0).
- Return a shallow copy of the newest match's `items` (`{sizeId, flavourId,
  quantity}` per item); `[]` if there is no such order or it has no items.

### Restaurant view (`index.html`)

- `sizeOptions(selected)` and `flavourOptions(selected)` gain an optional
  `selected` id and mark the matching `<option selected>` (flavour placeholder
  stays selected when nothing matches).
- `itemRowHtml(item)` takes an optional item and pre-selects size/flavour and
  sets the quantity (defaults: no item → empty size-first, no flavour, qty 1 —
  today's behavior; `itemRowHtml()` with no arg still yields a blank row for the
  "Add line" button).
- In `render()`, build `#orderItems` from
  `KO.lastOrderItems(A.state.orders, A.user && A.user.uid)`: one `itemRowHtml`
  row per returned item, or a single blank `itemRowHtml()` when the list is
  empty.
- Everything else (add/remove line, send, validation, translations) is unchanged.
  Data still escaped with `A.esc(...)`.

## Testing

- `lib.js`: unit tests for `lastOrderItems` — picks the newest non-cancelled
  order's items (skipping a more-recent cancelled one), returns `[]` when the
  restaurant has no orders or only cancelled ones, and filters by
  `customerUid`.
- Manual (restaurant login, browser): with a prior non-cancelled order, the New
  order form opens pre-filled with those lines (size + flavour + qty), editable;
  a restaurant with no/only-cancelled orders sees a blank line; a line whose
  flavour was deleted shows blank; sending still works and the EN/PT strings are
  intact.

## Out of scope

- Pre-filling preferred date or note.
- A separate "repeat order" history/picker (only the single most-recent order).
- Preserving in-progress edits across background re-renders (pre-existing form
  behavior, unchanged).
