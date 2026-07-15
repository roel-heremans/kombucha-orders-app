# Kombucha Orders

A small phone-friendly web app for recording kombucha deliveries to restaurants
and other customers, and for seeing monthly revenue, per-customer breakdowns,
outstanding bottles/deposits, and generating the monthly **recibo verde**
description text for the Portuguese Finanças system.

It's a single `index.html` (no build step) hosted on GitHub Pages, meant to be
added to your phone's home screen. Data is shared between devices via Firebase
Firestore, so two people can enter deliveries and see the same stats.

> Status: **design complete, implementation pending.** See the design spec in
> [`docs/superpowers/specs/`](docs/superpowers/specs/).

---

## Features (planned)

- **Enter a delivery** — customer (dropdown or add new), date, line items
  (bottle size + flavour + quantity), and empties received back per size.
- **Deliveries list** — review, edit, delete past deliveries.
- **Dashboard** — monthly revenue, revenue share by customer, outstanding
  bottles and deposit held, flavour popularity.
- **Recibo Verde** — pick a customer + month and copy-paste the description text
  (delivery dates, bottle types/amounts, deposit returns, and the netted total).
- **Two-account shared data** — you and your wife each log in and see the same
  data, with offline support that syncs when back online.

## Bottle sizes & pricing (defaults, editable in Settings)

| Size   | Sale price | Deposit |
| ------ | ---------- | ------- |
| 1 L    | €8.00      | €0.00 (returns tracked for stock only) |
| 270 ml | €4.50      | €1.00 (refunded on return) |

## Tech

- Single-file web app (vanilla HTML/CSS/JS), hand-rolled SVG charts.
- Firebase (Firestore + Email/Password auth) loaded from CDN.
- Hosted on GitHub Pages.

## Setup

Firebase project setup and hosting steps will be documented here during
implementation. Firebase web config values are public by design; access is
protected by Firestore security rules limited to the two known accounts.

## License

MIT — see [LICENSE](LICENSE).
