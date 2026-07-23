# Customer Email Indicator — Design Spec

Date: 2026-07-23
Status: design approved, implementation pending

## Goal

In the admin **Settings → Customers** card, show at a glance which customers have
a real (deliverable) login email — i.e. who receives recibo-upload emails — vs.
name-logins (`@kombucha.app`, no inbox) and customers with no login yet.

## Decisions

- **Location:** the existing "Customers" collapsible card (index.html ~1234),
  which already lists every customer. Not the Customers Login dropdown.
- **Per-customer badge** at the top of each customer row, three states:
  - `real` → green pill `✉ <email>` (gets recibo emails)
  - `synthetic` → grey pill `name login — no email`
  - `none` → grey pill `no login`
- **Header count:** `Customers (N) — M with email`, where M = customers whose
  status is `real`.
- Classification uses a new tested pure helper so the UI and the recibo-email
  feature stay consistent with the same rule.

## `lib.js` — `customerEmailStatus(customer, syntheticDomain)`

Pure, unit-tested. Returns `"none" | "synthetic" | "real"`:
```
customerEmailStatus(customer, syntheticDomain) ->
  if (!customer || !customer.uid) return "none";        // no login
  return isRealEmail(customer.email, syntheticDomain) ? "real" : "synthetic";
```
Reuses `isRealEmail`. A customer with no login (`uid` falsy) is `none` regardless
of any stored email. Added to the exports object.

## `index.html` — Customers card (Settings render block, ~1234)

- **CSS** (in `<style>`, before `</style>`): `.pill`, `.pill-ok`, `.pill-muted`.
  Small rounded labels; `.pill-ok` green (#e6f4ea / #1e6b3a), `.pill-muted`
  grey (#f0efe9 / #777).
- **Header count:** compute
  `const realEmailCount = A.state.customers.filter(c => KO.customerEmailStatus(c, A.loginNameDomain) === "real").length;`
  and render `Customers (${A.state.customers.length}) — ${realEmailCount} with email`
  in the `<summary>`.
- **Per-row badge:** in the customers `.map(...)`, compute the status and prepend a
  pill to the row:
  - `real` → `<span class="pill pill-ok">✉ ${A.esc(c.email)}</span>`
  - `synthetic` → `<span class="pill pill-muted">name login — no email</span>`
  - `none` → `<span class="pill pill-muted">no login</span>`

## Testing

- `lib.js`: unit-test `customerEmailStatus` — real (uid + real email), synthetic
  (uid + `@kombucha.app`), none (no uid), none (null customer).
- Manual: Settings → Customers → each row shows the correct badge; header count
  matches the number of green pills; matches the console list from before.

## Rollout

- Admin-only view; no Firebase/rules change. No effect on restaurant view.

## Out of scope

- Editing the login email from the Customers card (still done in Customers Login).
- Badges in the Customers Login dropdown or elsewhere.
