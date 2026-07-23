# Kombucha Orders

A small phone-friendly web app for recording kombucha deliveries to restaurants
and other customers, and for seeing monthly revenue, per-customer breakdowns,
outstanding bottles/deposits, and generating the monthly **recibo verde**
description text for the Portuguese Finanças system.

It's a single `index.html` (no build step) hosted on GitHub Pages, meant to be
added to your phone's home screen. Data is shared between devices via Firebase
Firestore, so two people can enter deliveries and see the same stats.

> Status: **Most features implemented.** Restaurant ordering is now live. See the design spec in
> [`docs/superpowers/specs/`](docs/superpowers/specs/).

---

## Features (implemented)

- **Enter a delivery** — customer (dropdown or add new), date, line items
  (bottle size + flavour + quantity), and empties received back per size.
- **Deliveries list** — review, edit, delete past deliveries.
- **Dashboard** — monthly revenue, revenue share by customer, outstanding
  bottles and deposit held, flavour popularity.
- **Recibo Verde** — pick a customer + month and copy-paste the description text
  (delivery dates, bottle types/amounts, deposit returns, and the netted total).
- **Two-account shared data** — you and your wife each log in and see the same
  data, with offline support that syncs when back online.
- **Restaurant self-ordering** — restaurants can place order requests from their own phone account.
- **Orders tab** — admins see all pending restaurant orders and can fulfill them directly into the delivery form.

## Restaurant ordering

Restaurants can place order requests from their own phone:

- An admin creates a login for the restaurant in **Settings → Restaurant
  logins** (links it to that customer).
- The restaurant logs in and sees only a **New order** form and their own
  order history — no revenue, deposits, or other customers.
- New orders appear in the admin **Orders** tab (with a pending badge). An
  admin taps **Fulfil…**, which pre-fills the normal delivery form; saving it
  records the delivery and marks the order **Delivered**.
- A restaurant can **Cancel** an order while it is still Requested.

## Order notifications

When a restaurant places an order, the app can optionally email Roel + Nina via
EmailJS (client-side). See [`docs/EMAILJS_SETUP.md`](docs/EMAILJS_SETUP.md) for
setup; the feature is off until configured with your EmailJS credentials.

WhatsApp alerts (new order + delivered) can also be sent to Roel + Nina via
CallMeBot (client-side). See [`docs/CALLMEBOT_SETUP.md`](docs/CALLMEBOT_SETUP.md)
for setup; the feature is off until configured.

When an admin uploads a Recibo Verde PDF, the app can also email the restaurant with the recibo details; see [`docs/EMAILJS_SETUP.md`](docs/EMAILJS_SETUP.md) for template setup.

## Bottle sizes & pricing (defaults, editable in Settings)

| Size   | Sale price | Deposit |
| ------ | ---------- | ------- |
| 1 L    | €8.00      | €0.00 (returns tracked for stock only) |
| 270 ml | €4.50      | €1.00 (refunded on return) |

## Tech

- Single-file web app (vanilla HTML/CSS/JS), hand-rolled SVG charts.
- Firebase (Firestore + Email/Password auth) loaded from CDN.
- Hosted on GitHub Pages.

## Run locally

No build step and no dependencies. From the repo root:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser. Note that Firebase features
(login, data sync) require `FIREBASE_CONFIG` in `index.html` to be filled in —
see "Firebase setup" below.

## Firebase setup

One-time setup of the Firebase project (Authentication, Firestore, and the
`FIREBASE_CONFIG` values in `index.html`) is documented in
[`docs/FIREBASE_SETUP.md`](docs/FIREBASE_SETUP.md).

Firebase web config values are public by design; access is protected by
Firestore security rules ([`firestore.rules`](firestore.rules)) limited to
the two known accounts.

## Deploy (GitHub Pages)

This is a static site, so GitHub Pages can serve it directly from `main`:

1. In the GitHub repo, go to **Settings → Pages**.
2. Under **Source**, choose "Deploy from a branch".
3. Set **Branch** to `main` and the folder to `/ (root)`, then **Save**.
4. GitHub Pages will publish the site at
   `https://roel-heremans.github.io/kombucha-orders-app/` (the URL becomes
   live a minute or two after Pages is enabled).

## Add to Home Screen

On iPhone (Safari):

1. Open the published URL.
2. Tap the **Share** icon.
3. Tap **Add to Home Screen**.

The app then opens full-screen from your home screen like a native app.

## License

MIT — see [LICENSE](LICENSE).
