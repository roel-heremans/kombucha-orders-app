# WhatsApp Notifications (CallMeBot) — Design Spec

Date: 2026-07-17
Status: design complete, implementation pending

## Goal

WhatsApp Roel + Nina on two events — a restaurant **places a new order**, and an
order **gets delivered** (fulfilled). Uses **CallMeBot** (free, client-side, no
backend), mirroring the EmailJS approach. Stays on the free Firebase plan.

## Scope

- **Two events:** new order (restaurant submits) and delivered (admin fulfils an
  order). A standalone delivery not tied to an order does **not** notify.
- **Recipients:** Roel + Nina (both), configured in the app. Restaurants are not
  messaged (that would need a backend).
- **Best-effort:** the order/delivery always completes regardless of WhatsApp
  outcome; the notification never blocks or fails those flows.
- **Short messages:** customer + items summary only.

## Mechanism — CallMeBot

Each recipient registers their WhatsApp number once with CallMeBot (message the
bot to receive an API key). The app then sends via a simple GET:
```
https://api.callmebot.com/whatsapp.php?phone=<E164>&text=<urlencoded>&apikey=<key>
```
Fired with `fetch(url, { mode: "no-cors" })` so the request goes out without a
CORS error (we don't need to read the response).

### Configuration

Add to `index.html`, next to `EMAILJS_CONFIG`:
```javascript
const CALLMEBOT_RECIPIENTS = [
  { phone: "", apikey: "" },  // Roel
  { phone: "", apikey: "" },  // Nina
];
```
**Empty by default → disabled.** A recipient with a blank `phone` or `apikey` is
skipped; if none are configured, `notifyWhatsApp` is a no-op. App behaves exactly
as today until filled in.

### Sender — `window.APP.notifyWhatsApp(text)`

Defined in the module script:
- For each recipient with non-empty `phone` and `apikey`, `fetch` the CallMeBot
  URL (`encodeURIComponent(text)` for the message), `mode: "no-cors"`.
- Wrapped so it **never throws** (per-recipient try/catch → `console.warn`);
  returns immediately when nothing is configured. Callers never await or catch.

## Message text — `KO.whatsappOrderText(event, customerName, itemsSummary)`

Pure, tested:
- `event === "delivered"` → `"✅ Delivered — " + customerName + ": " + itemsSummary`
- otherwise → `"🧋 New order — " + customerName + ": " + itemsSummary`

`itemsSummary` is produced by the existing `orderItemsSummary`.

## Wiring

### New order (restaurant view `onSend`)
After a successful `addOrder` (in the `if (saved)` block, next to the existing
`notifyNewOrder` email call), fire:
```javascript
A.notifyWhatsApp(KO.whatsappOrderText("new", A.myCustomer.name,
  KO.orderItemsSummary({ items }, A.state.settings.sizes, A.flavourName)));
```
Not awaited; wrapped by `notifyWhatsApp`'s own error handling.

### Delivered (delivery-form `onSave`, fulfil path)
In the non-editing branch, **after** `A.setOrderDelivered(fulfilling, ref.id)`
succeeds (i.e. only when an order is being fulfilled), fire:
```javascript
A.notifyWhatsApp(KO.whatsappOrderText("delivered", A.customerName(d.customerId),
  KO.orderItemsSummary(d, A.state.settings.sizes, A.flavourName)));
```
(`d` is the delivery just saved — its `items`/`customerId` are the delivered
content.) Fired only inside the `if (fulfilling)` branch, so standalone
deliveries don't notify. Must not affect the save success/failure UI.

## Testing

- `lib.js`: unit-test `whatsappOrderText` for both events (new/delivered prefixes
  + customer + items).
- Manual: with `CALLMEBOT_RECIPIENTS` empty, placing an order and fulfilling one
  still work with no console error (no-op). With it filled (after CallMeBot
  registration), placing an order WhatsApps Roel + Nina "🧋 New order — …", and
  fulfilling an order WhatsApps "✅ Delivered — …". A failed/blocked WhatsApp
  leaves the order/delivery unaffected (only a `console.warn`).

## Setup doc

New `docs/CALLMEBOT_SETUP.md`:
1. On each phone (Roel, Nina): add CallMeBot's WhatsApp number as a contact and
   send it `I allow callmebot to send me messages to my phone`. It replies with
   your **API key** (and confirms your number).
2. Put each person's phone (E.164, e.g. `+3519xxxxxxxx`) + apikey into
   `CALLMEBOT_RECIPIENTS` in `index.html`; commit + push.
3. Notes: free service, rate-limited (a few messages/min) — fine at this volume;
   the API keys live in the client (like the EmailJS key) so worst case someone
   could ping your WhatsApp — rotate the key via CallMeBot if needed; blank a
   `phone`/`apikey` to disable a recipient.

## Rollout / setup impact

- No Firebase/rules/schema change; no new dependencies (uses `fetch`).
- Dormant until `CALLMEBOT_RECIPIENTS` is filled and pushed.
- README gains a one-line pointer to the setup doc.

## Out of scope

- Messaging restaurant customers (needs a backend / Blaze + Twilio/Meta + template
  approval).
- Cancellation or other-event notifications (new-order + delivered only).
- Delivery receipts / retries (best-effort; the in-app badge + email remain).
