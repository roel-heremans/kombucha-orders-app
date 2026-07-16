# New-Order Email Notifications (EmailJS) — Design Spec

Date: 2026-07-17
Status: design complete, implementation pending

## Goal

When a restaurant places a new order, send an email alert to Roel + Nina so they
don't have to open the app to notice. Uses **EmailJS** (client-side, free tier),
so no backend and no Firebase plan change.

Backlog item: "New-order notifications" (the email variant).

## Scope

- **Trigger:** new orders only (a restaurant submitting an order). Cancellations
  and other events stay in-app only.
- **Recipients:** Roel + Nina — configured in the **EmailJS template's To field**,
  not hardcoded in the app.
- **Best-effort:** the order always saves to Firestore and shows in the admin
  Orders badge regardless of email success. Email is an extra alert, never the
  source of truth, and never blocks or fails the order flow.

## How it sends (no extra library)

The restaurant's browser POSTs to the EmailJS REST API when an order saves:

```
POST https://api.emailjs.com/api/v1.0/email/send
Content-Type: application/json
{
  "service_id":  EMAILJS_CONFIG.serviceId,
  "template_id": EMAILJS_CONFIG.templateId,
  "user_id":     EMAILJS_CONFIG.publicKey,   // EmailJS public key
  "template_params": { restaurant_name, items, preferred_date, note, placed_at }
}
```

No `@emailjs/browser` script needed — a plain `fetch` from the browser is the
documented public-key flow. (The app already makes cross-origin calls to
Firebase, so an outbound `fetch` to `api.emailjs.com` fits.)

## Configuration

Add to `index.html`, next to `FIREBASE_CONFIG`:

```javascript
const EMAILJS_CONFIG = { serviceId: "", templateId: "", publicKey: "" };
```

**Empty by default → feature disabled.** `notifyNewOrder` returns immediately if
any of the three is blank, so the app behaves exactly as today until the values
are filled in (and won't error on forks / local dev).

## Sender helper (`window.APP.notifyNewOrder`)

Defined in the module script (has `EMAILJS_CONFIG` in scope):

```
window.APP.notifyNewOrder(params) -> Promise<void>
```

- If any of serviceId/templateId/publicKey is empty → resolve immediately (no-op).
- Otherwise `fetch` the POST above with `template_params: params`.
- Wrapped so it **never throws**: on network/HTTP error, `console.warn` and
  resolve. Callers do not need to await or catch it.

## Email content (`KO.orderEmailParams`)

A pure, tested helper in `lib.js` assembles the template params from an order:

```
orderEmailParams(order, restaurantName, sizes, flavourName, placedAt) -> {
  restaurant_name: restaurantName,
  items:           orderItemsSummary(order, sizes, flavourName),  // "8x 1 L Ginger, …"
  preferred_date:  order.preferredDate || "—",
  note:            order.note || "—",
  placed_at:       placedAt || "",
}
```

Reuses the existing `orderItemsSummary`. `placedAt` is a human-readable local
time string built by the caller (browser `new Date().toLocaleString()`); it is
passed in so the helper stays pure and testable.

## Trigger wiring (restaurant view)

In the restaurant view's `onSend`, after `await A.addOrder(...)` succeeds (and
the "Order sent ✓" message is shown), fire the notification — not awaited into
the success path, and guaranteed non-blocking:

```javascript
A.notifyNewOrder(KO.orderEmailParams(
  { items, preferredDate, note },      // the order just sent
  A.myCustomer.name,
  A.state.settings.sizes,
  A.flavourName,
  new Date().toLocaleString()
));
```

Because `notifyNewOrder` swallows its own errors, the existing success/failure UI
is unchanged. Order creation failures still show "Send failed" as today (the
email is only attempted after a successful save).

## Abuse protection (setup, documented)

The EmailJS public key ships in the client. Mitigations, covered in the setup
doc:

- In the EmailJS dashboard, **restrict allowed origins** to the GitHub Pages
  domain (`https://roel-heremans.github.io`) so the key can't be used elsewhere.
- The template's To is fixed to Roel + Nina, so the worst an abuser could do is
  trigger emails to those addresses (annoying, not a data leak). EmailJS also
  rate-limits and the free tier caps monthly sends.

## Testing

- `lib.js`: unit-test `orderEmailParams` — items summary via `orderItemsSummary`,
  and the `"—"` fallbacks for empty `preferredDate` / `note`.
- Manual: with `EMAILJS_CONFIG` **empty**, placing an order still works and sends
  nothing (no console error). With it **filled**, placing an order as a restaurant
  delivers an email to both recipients containing the restaurant, items, date,
  note, and time. Simulate a failure (e.g. bad template id) and confirm the order
  still shows "Order sent ✓" and only a `console.warn` appears.

## Setup doc

New `docs/EMAILJS_SETUP.md`:

1. Create a free EmailJS account; add an **Email Service** (connect Gmail).
2. Create an **Email Template** with variables `{{restaurant_name}}`,
   `{{items}}`, `{{preferred_date}}`, `{{note}}`, `{{placed_at}}`, and set the
   template **To** to `roel.heremans@gmail.com, reissnina@gmail.com`.
3. Copy the **Service ID**, **Template ID**, and **Public Key** into
   `EMAILJS_CONFIG` in `index.html`; commit + push.
4. In **Account → Security**, restrict allowed origins to the Pages domain.
5. Note: the free tier caps monthly sends (~200) — ample for this volume.

## Rollout / setup impact

- No Firebase changes, no security-rule changes, no new dependencies (uses
  `fetch`).
- Feature stays dormant until `EMAILJS_CONFIG` is filled in and pushed.
- README gains a short "Order notifications" note pointing to the setup doc.

## Out of scope

- Cancellation / fulfilment emails (new-order only).
- WhatsApp notifications (would need a backend / Blaze).
- In-app configuration UI for the EmailJS IDs (they live in `index.html`, like
  `FIREBASE_CONFIG`).
- Retry/queue for failed emails (best-effort; the badge is the reliable channel).
