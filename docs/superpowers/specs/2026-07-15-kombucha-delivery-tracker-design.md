# Kombucha Delivery Tracker — Design

**Date:** 2026-07-15
**Status:** Approved (design), pending implementation plan

## Purpose

A personal phone app for Roel to record kombucha deliveries to restaurants and
other customers, and to see monthly revenue and per-customer breakdowns. Also
tracks bottles that are still out at each customer and the deposit money tied up
in returnable bottles.

## Architecture

- **Single-file web app**: one `index.html` with inline CSS and JavaScript. No
  build step, no dependencies. Follows the existing `handpan/resonote.html`
  pattern.
- **Hosting**: GitHub Pages. On iPhone, added to the home screen
  (Share → Add to Home Screen) for an app-like experience. Works offline.
- **Storage**: browser `localStorage` on the device. A single JSON document
  holds all data.
- **Backup / Restore**: an "Export" button downloads the JSON document as a
  file (can be saved/emailed to self); an "Import" button restores from such a
  file. This is the backup and cross-device transfer mechanism — there is no
  server and no account.
- **Charts**: drawn as hand-rolled inline SVG. No external charting library, so
  the app stays a single self-contained offline file.

### Why this approach

Matches the proven handpan setup (single file, GitHub Pages, iPhone home
screen, zero install). A backend/cloud sync was considered and rejected as
unnecessary complexity for a single-user, single-phone workflow; export/import
covers backup and the rare multi-device need.

## Data Model

Stored as one JSON object in `localStorage` under a single key
(e.g. `kombucha-tracker-v1`).

```
{
  "version": 1,
  "sizes": [
    { "id": "1L",    "label": "1 L",     "price": 8.0, "deposit": 0.0 },
    { "id": "270ml", "label": "270 ml",  "price": 4.5, "deposit": 1.0 }
  ],
  "customers": [
    { "id": "...", "name": "Palm Spot", "notes": "" }
  ],
  "flavours": [
    { "id": "...", "name": "Ginger" }
  ],
  "deliveries": [
    {
      "id": "...",
      "customerId": "...",
      "date": "2026-07-15",
      "items": [
        { "sizeId": "270ml", "flavourId": "...", "quantity": 5 }
      ],
      "empties": [
        { "sizeId": "270ml", "quantity": 5 },
        { "sizeId": "1L",    "quantity": 0 }
      ],
      "note": ""
    }
  ]
}
```

### Entities

- **Size** — a bottle size with a **sale price** and a **deposit**. Defaults:
  - `1 L` — price €8.00, deposit €0.00 (returns tracked for stock only).
  - `270 ml` — price €4.50, deposit €1.00 (refunded to customer on return).
  - Editable in Settings (prices expected to rise over time). New sizes can be
    added.
- **Customer** — name plus optional notes. Grows as deliveries are entered;
  selectable from a dropdown on future deliveries.
- **Flavour** — a name. Grows from what has been entered; selectable from a
  list, with an "add new" option inline.
- **Delivery** — one drop-off to one customer on one date. Contains:
  - `items`: line items of `{ size, flavour, quantity }`.
  - `empties`: bottles received back on this delivery, **per size**.
  - optional free-text note.

### Derived values

- **Delivery revenue** = Σ (item.quantity × size.price) over items. Deposits are
  **not** counted as revenue.
- **Outstanding bottles per customer per size** = Σ delivered quantity of that
  size − Σ empties returned of that size, across all that customer's deliveries.
- **Deposit held** = Σ over sizes (outstanding bottles × size.deposit). Only
  270 ml contributes today.

## Screens

Single-page app with a simple bottom or top nav between four views.

### 1. New / Edit Delivery

- **Customer**: dropdown of existing customers + "➕ Add new customer" inline.
- **Date**: date picker, defaults to today.
- **Line items**: repeatable rows of Size (dropdown) + Flavour (dropdown with
  "➕ Add new flavour") + Quantity. Add/remove rows.
- **Empties received back**: quantity per size.
- Live subtotal (revenue) shown as items are added.
- **Save** / **Cancel**. Editing an existing delivery reuses this form.

### 2. Deliveries List

- Reverse-chronological list of deliveries: customer, date, item summary,
  revenue, empties.
- Tap a delivery to edit; delete with confirmation.

### 3. Dashboard

- **Month picker** (defaults to current month).
- **Monthly revenue**: total for the selected month, plus a bar chart of
  revenue across recent months.
- **Revenue share by customer**: bar or donut chart for the selected month.
- **Outstanding bottles & deposit**: per-customer table of bottles still out
  (per size) and total deposit value held.
- **Flavour popularity** (optional): counts of flavours delivered in the month.

### 4. Settings

- Manage **sizes**: label, price, deposit; add new size.
- Manage **customers**: rename, edit notes, (optionally) remove.
- Manage **flavours**: rename, (optionally) remove.
- **Export** (download JSON backup) and **Import** (restore from JSON).

## Deposits vs Revenue

Kept separate to keep monthly income figures clean:

- "Revenue" = product sales only (quantity × sale price).
- Deposits appear only in the "outstanding bottles / deposit held" view, never
  as revenue. Returning a bottle reduces outstanding count and deposit held; it
  does not change past revenue.

## Error handling & edge cases

- Empty/invalid form fields (no customer, zero-quantity items) are blocked on
  save with a clear message.
- Deleting a customer or flavour that is used by deliveries: warn and either
  block or keep historical deliveries intact (decision deferred to plan;
  default = block deletion while in use).
- Import validates the JSON shape and `version`; on mismatch it reports an error
  rather than corrupting current data. A confirmation is required before import
  overwrites existing data.
- `localStorage` write failures (quota/private mode) surface a visible warning.

## Testing

- Pure logic (revenue totals, outstanding-bottle and deposit calculations,
  import validation) factored into small functions that can be unit-tested.
- Manual test checklist for the UI flows on a phone-sized viewport.

## Out of scope (YAGNI)

- Multi-user accounts, cloud sync, server backend.
- Invoicing / PDF generation.
- Payment tracking (paid/unpaid) — only revenue is computed.
- Per-customer negotiated prices (single global price per size for now).
