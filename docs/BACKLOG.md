# Backlog

Feature backlog for the kombucha orders app. Each larger item becomes its own
spec (`docs/superpowers/specs/`) → plan (`docs/superpowers/plans/`) →
implementation.

Status legend: 🟡 next · ⚪ planned · 💡 idea / deferred · ✅ done

---

## Project A — Dashboard analytics 🟡 (in progress)

Shared backbone: a selectable reporting **time window** that drives every stat
and chart, plus a **revenue split by customer type** (Private vs Restaurant vs
total) reused across charts.

- **A1. Revenue chart split by type** — the monthly revenue bar chart shows, per
  month, the split between Private and Restaurant plus the combined total.
- **A2. Date-range / last-month view** — choose a start & end month (or a "last
  month" quick pick); all dashboard stats and graphs recompute for that window.
- **A3. Yearly revenue chart** — a chart of revenue per year, also split into
  Private, Restaurant, and the sum.

## Project B — Recibo Verde PDF distribution ⚪ (planned, after A)

Separate subsystem — needs Firebase Storage, storage security rules, admin
upload UI, and a restaurant download section.

- **B1. Admin uploads** monthly Recibo Verde PDFs for a given restaurant + month.
- **B2. Restaurant download** — a logged-in restaurant sees a section listing
  their monthly RVs to download / print.

---

## Ideas / deferred 💡

- **New-order notifications** — email and/or WhatsApp alert to Roel + Nina when a
  restaurant places an order (currently in-app pending badge only). Client-side
  EmailJS (free, no backend) or a Cloud Function on the Blaze plan for WhatsApp.
- **Order history archival** — an admin action to archive/delete very old orders,
  or filter finished orders by restaurant/date (current: pending-only default +
  "Show finished" toggle).
- **Orders rules hardening** — bind an order's `customerId` to the creating
  restaurant's own customer in the Firestore create rule (defense-in-depth;
  restaurants are trusted today and the app always sends the correct id).

## Done ✅

- Restaurant ordering: role-based split, orders collection, admin Orders tab
  (pending-only default + show-finished toggle), fulfil→delivery flow, restaurant
  order form + own history + cancel, in-app restaurant login creation, role-based
  Firestore rules.
- Settings: collapsible sections (Bottle sizes, Customers, Flavours, Restaurant
  logins).
- Restaurant view: visible Log-out button; "Clear finished" (per-device, hide-only).
