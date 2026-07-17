# Backlog

Feature backlog for the kombucha orders app. Each larger item becomes its own
spec (`docs/superpowers/specs/`) → plan (`docs/superpowers/plans/`) →
implementation.

Status legend: 🟡 next · ⚪ planned · 💡 idea / deferred · ✅ done

---

## Ideas / deferred 💡

- **WhatsApp order notifications** — a WhatsApp alert on new orders would need a
  backend (Cloud Function on the Blaze plan + Twilio). Email alerts are done (see
  Done below).
- **Order history archival** — an admin action to archive/delete very old orders,
  or filter finished orders by restaurant/date (current: pending-only default +
  "Show finished" toggle).
- **Orders rules hardening** — bind an order's `customerId` to the creating
  restaurant's own customer in the Firestore create rule (defense-in-depth;
  restaurants are trusted today and the app always sends the correct id).

## Done ✅

- **Available-to-sell stock & consumption**: admin records dated per-size
  stocktakes; the Production tab tracks sellable stock forward (production adds,
  deliveries subtract) and derives private consumption by reconciling each new
  stocktake against expected (per size + liters). Admin-only `stocktakes`
  collection; replaces the old produced−sold estimate.
- **Reorder prefill**: the restaurant New-order form pre-fills with the line
  items (size + flavour + quantity) of their most recent non-cancelled order,
  editable before sending. Tested `lastOrderItems` helper.
- **Restaurant language (EN / PT)**: restaurants toggle English/Portuguese
  (per-device, default PT); all restaurant-facing strings, order statuses, and
  recibo month labels are translated. Admin app, emails, and PDFs stay English.
  EN/PT dictionary + `t()` in `lib.js`.
- **Production / fermentation tracking**: admin-only Production tab logging
  batches (Batch 001…) through 4 steps + 270 ml conversions (1 L-used auto-fills
  ceil), with a windowed summary of 1 L bottled, 270 ml made, 1 L used, sold
  liters, and family consumption (produced − sold). New admin-only `batches`
  collection + rules.
- **New-order email notifications**: best-effort EmailJS email to Roel + Nina
  when a restaurant places an order (client-side, no backend; order always saves
  regardless). Configured + verified live. Setup in `docs/EMAILJS_SETUP.md`.
- **Project B — Recibo Verde PDF distribution**: admins upload a restaurant's
  monthly RV PDF (base64 in Firestore, one-per-month replace, 700 KB cap,
  %PDF-validated) from the Recibo view; restaurants download/print their own via
  a "My Recibos" section. Two collections (`recibos` metadata + `reciboFiles`
  bytes) with role-based rules (restaurant reads only its own). Free Spark plan.
- **Project A — Dashboard analytics**: selectable time window (This month / Last
  month / This year / Custom range) driving all windowed stats; revenue split by
  customer type (Private/Restaurant/total) in a stacked monthly chart + window
  totals; all-years yearly split chart; removed the old by-customer-type table.
- Restaurant ordering: role-based split, orders collection, admin Orders tab
  (pending-only default + show-finished toggle), fulfil→delivery flow, restaurant
  order form + own history + cancel, in-app restaurant login creation, role-based
  Firestore rules.
- Settings: collapsible sections (Bottle sizes, Customers, Flavours, Restaurant
  logins).
- Restaurant view: visible Log-out button; "Clear finished" (per-device, hide-only).
