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
  build step. Follows the existing `handpan/resonote.html` pattern. The only
  external dependency is the Firebase JS SDK, loaded from a CDN.
- **Hosting**: GitHub Pages. On iPhone, added to the home screen
  (Share → Add to Home Screen) for an app-like experience.
- **Storage — shared cloud (Firebase Firestore)**: all data lives in a single
  Firestore project so both phones always see the same data. Firestore's
  **offline persistence** is enabled, so deliveries can be entered without
  signal and sync automatically when the phone reconnects (important for
  on-the-road deliveries).
- **Authentication (two accounts)**: Firebase Email/Password auth. Roel and his
  wife each have their own account; both read and write the **same shared
  data**. Each delivery records which account entered it (`enteredBy`).
  Firestore **security rules** restrict all access to those two accounts only.
- **Backup**: an "Export" button downloads the full dataset as a JSON file as an
  extra safety net (Firestore is the source of truth; export is belt-and-braces,
  not the sync mechanism).
- **Charts**: drawn as hand-rolled inline SVG. No external charting library.

### Why this approach

Matches the proven handpan setup (single file, GitHub Pages, iPhone home
screen). Firestore adds shared, real-time, offline-capable sync between the two
phones with minimal backend code and no cost at this volume (Firebase free
tier). Config values (`apiKey`, project id, etc.) are public by design in a
Firebase web app — access is protected by the security rules, not by hiding the
config.

## Firebase setup (one-time, guided during implementation)

1. Create a Firebase project (free Spark plan).
2. Enable **Email/Password** authentication; create the two user accounts.
3. Create a **Firestore** database.
4. Add **security rules** allowing read/write only to the two known account
   UIDs (an allowlist). No public sign-up in the app — login only.
5. Register a Web App and copy its config into `index.html`.

## Data Model

Data lives in Firestore. Suggested layout: top-level collections
`customers`, `flavours`, `deliveries`, and a single `settings` document holding
sizes/prices. The shapes below describe each document.

```
{
  "version": 1,
  "reciboHeader": "OUT - Kombucha Produto",
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
      "note": "",
      "enteredBy": "roel@example.com",
      "createdAt": "2026-07-15T10:00:00Z"
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
  - `enteredBy`: which account created it (for the two-person workflow).

### Derived values

- **Delivery revenue** = Σ (item.quantity × size.price) over items. Deposits are
  **not** counted as revenue.
- **Outstanding bottles per customer per size** = Σ delivered quantity of that
  size − Σ empties returned of that size, across all that customer's deliveries.
- **Deposit held** = Σ over sizes (outstanding bottles × size.deposit). Only
  270 ml contributes today.
- **Recibo total** (per customer per month) = Σ delivery revenue in the month −
  Σ (returned bottles × size.deposit) in the month. This nets deposits out and
  matches the Finanças invoice total.

## Screens

Single-page app with a simple bottom or top nav. A **Login** screen gates the
app; once logged in, Firebase remembers the session so it does not need to be
re-entered on every open.

### 0. Login

- Email + password fields, "Log in" button (no public sign-up — the two accounts
  are created once in the Firebase console).
- Shows the logged-in account and a "Log out" action somewhere in Settings.

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
- **Export** a full JSON backup (extra safety net).
- **Recibo header text**: editable string (default `OUT - Kombucha Produto`)
  used at the top of the generated recibo description.
- Shows the current account and a **Log out** button.

### 5. Recibo Verde (monthly tax export)

Generates the description text to paste into the Portuguese Finanças recibo
verde GUI, one customer + one month at a time.

- **Inputs**: customer (dropdown) + month picker.
- **Output**: a read-only text block with a **Copy** button, formatted **by
  date** (chosen format):

  ```
  OUT - Kombucha Produto

  June 3:  2x 1L = 16.00
  June 10: 2x 1L + 10x 270ml = 61.00
  June 24: 2x 1L = 16.00
  Return June 3: 7x 270ml = -7.00
  ----------------------------
  Total: 86.00 Euro
  ```

- Rules:
  - One line per delivery date that has delivered bottles, listing each size as
    `<qty>x <size label>` (aggregated across flavours for that size), then that
    date's subtotal = Σ qty × sale price.
  - Each date with returned empties adds a `Return <month> <day>: <qty>x <size>
    = -<qty × deposit>` line (only sizes with a non-zero deposit produce a
    money value; zero-deposit returns like 1 L are stock-only and are **not**
    listed on the recibo).
  - Amounts formatted with two decimals; final `Total:` = Σ subtotals −
    Σ deposit refunds. This matches the invoice total (product sales net of
    deposits), which differs from the dashboard's product-only "revenue".
  - The header line is the configurable Recibo header text.

## Deposits vs Revenue

Kept separate to keep monthly income figures clean:

- "Revenue" = product sales only (quantity × sale price).
- Deposits appear only in the "outstanding bottles / deposit held" view, never
  as revenue. Returning a bottle reduces outstanding count and deposit held; it
  does not change past revenue.

## Error handling & edge cases

- Empty/invalid form fields (no customer, zero-quantity items) are blocked on
  save with a clear message.
- Deleting a customer or flavour that is used by deliveries is **blocked** while
  in use, so historical deliveries stay intact.
- **Offline / network**: when a phone has no signal, Firestore serves cached
  data and queues writes; the app shows an "offline — will sync" indicator and
  syncs automatically on reconnect.
- **Auth errors** (wrong password, no network at login) show a clear message.
- **Concurrent edits**: with two users this is rare; last write wins per
  delivery document, which is acceptable at this scale.

## Testing

- Pure logic (revenue totals, outstanding-bottle and deposit calculations)
  factored into small functions that can be unit-tested.
- Manual test checklist for the UI flows on a phone-sized viewport.

## Out of scope (YAGNI)

- Public sign-up / more than the two known accounts, role permissions.
- Invoicing / PDF generation.
- Payment tracking (paid/unpaid) — only revenue is computed.
- Per-customer negotiated prices (single global price per size for now).
