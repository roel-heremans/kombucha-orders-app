# Pay Button (Stripe + Lightning) — Design

**Goal:** let an admin show a customer a payment QR (or send it by WhatsApp)
for an open month or a single unpaid delivery, payable by card / Apple Pay /
Google Pay / MB WAY through Stripe, or by bitcoin over Lightning.

Admin-only. Customers see nothing new in their own login. Stays a static
GitHub Pages app on the free Firebase Spark plan: no server, no secrets in the
app. Marking a payment as paid stays a manual admin action.

## One-time setup (by the admin, outside the app)

- **Stripe:** create one Payment Link of type *"Customers choose what to pay"*,
  currency EUR, with cards, Apple Pay / Google Pay and MB WAY enabled. Copy its
  `https://buy.stripe.com/...` URL.
- **Lightning:** get a Lightning address (e.g. `name@strike.me`; Strike can
  auto-convert to euros). Any provider whose LNURL-pay endpoints send
  `Access-Control-Allow-Origin: *` works (verified 2026-10-19: Strike, Alby, Blink).

A Stripe Payment Link URL cannot carry an amount (only `client_reference_id`,
UTM codes, prefilled email etc.), so the customer types the amount on Stripe's
page. An exact-amount Stripe checkout needs a server and is out of scope.

## Data

`settings/app` gains two optional string fields:

| field | example | notes |
|-------|---------|-------|
| `payStripeLink` | `https://buy.stripe.com/abc123` | must start with `https://buy.stripe.com/` or `https://checkout.stripe.com/`; "" = card option hidden |
| `payLightningAddress` | `kombucha@strike.me` | `name@domain`, stored lower-case; "" = bitcoin option hidden |

No new collections, no rules change (settings: read signed-in, write admin;
neither value is secret).

**Settings save must merge.** `A.saveSettings` currently does
`setDoc(settings/app, o)` without merge, so saving prices would wipe the new
fields. Change it to `setDoc(..., o, { merge: true })`; both the existing
prices/recibo-header save and the new Payments card save go through it.

## Settings → "Payments" card

New collapsible card like the others: *Stripe payment link* (url input),
*Lightning address* (text input), short help text, Save button. Validation
(lib.js `validatePaySettings`) rejects a non-Stripe URL or a malformed address
with an inline message; empty fields are allowed.

## Payments tab

Each month row gets a **Pay** button next to "Mark month paid"; each delivery
row gets **Pay** next to "Mark paid". If neither setting is filled, Pay buttons
are not shown.

Pay opens a full-screen overlay (same style as the receipt overlay):

- Header: customer name; label = "October 2026" (month) or "2026-10-14" (delivery);
  amount large, e.g. **€36,50**.
- Tabs **💳 Card / MB WAY** and **⚡ Bitcoin** (only those configured; first
  configured one active).
- Footer: **Mark paid** (marks exactly the deliveries this Pay was for, same
  calls as today's buttons, then closes), **Send via WhatsApp**, **Close**.

### Payment reference

`payReference(customerId, key)` → `<customerId>-<key>` where key is the
monthKey (`2026-10`) or the delivery id, with every character outside
`[A-Za-z0-9_-]` replaced by `_` and the result cut to 200 chars (Stripe's
`client_reference_id` rules).

### Card tab

- QR of `stripePayUrl(link, ref)` = link + `?client_reference_id=<ref>` (or
  `&` if the link already has a query).
- Text: "Enter €36,50 on the next screen" (amount formatted with comma).
- "Open link" button (opens the URL in a new tab) for testing / desktop.

### Bitcoin tab (exact-amount invoice, no server)

On opening the tab (and on **Refresh**):

1. Price: GET `https://api.kraken.com/0/public/Ticker?pair=XBTEUR` →
   `result.<pair>.c[0]`; on failure GET
   `https://api.coinbase.com/v2/prices/BTC-EUR/spot` → `data.amount`.
   Parsed by `parseBtcEurPrice(source, json)` → number or null.
2. sats = `eurToSats(amount, price)` = `Math.ceil(amount / price * 1e8)`.
3. GET `lnurlpUrl(address)` = `https://<domain>/.well-known/lnurlp/<name>`.
   Response must have `tag == "payRequest"` and a `callback`
   (`parseLnurlPay(json)` → `{ callback, minMsat, maxMsat, commentAllowed }` or
   null). msat = sats × 1000 must be within [minSendable, maxSendable].
4. GET `lnInvoiceUrl(callback, msat, comment)` — appends `amount=<msat>` and,
   when `commentAllowed > 0`, `comment=<text cut to commentAllowed>`. Comment:
   `Kombucha – <customer> – <label>`. Response `{ pr, verify? }`
   (`parseLnInvoice(json)` → `{ pr, verify }` or null; a `status: "ERROR"`
   response → null with its `reason` shown).
5. Show QR of `"lightning:" + pr.toUpperCase()` (uppercase = denser QR), the
   line `€36,50 ≈ 52 140 sats @ €70 000/BTC`, "Invoice valid about 10 minutes",
   **Refresh**, and **Copy invoice**.
6. If `verify` was returned (LUD-21): poll it every 3 s while this tab is
   visible and the overlay open (stop on close/tab switch/new invoice). When
   `settled == true` show **Paid ✓** and highlight *Mark paid* (still a manual
   tap). No verify URL → no polling, no tick.

Each fetch has a 10 s timeout. Failures show a message in the tab with
**Retry**; the Card tab is unaffected:
- price unavailable / offline → "Couldn't get the bitcoin price — check the connection."
- address lookup fails or invalid → "Lightning address didn't answer — check it in Settings."
- out of range → "Amount is outside what this Lightning address accepts (min/max …)."
- invoice error → "Couldn't create the invoice: <reason>."

A response from a superseded request (Refresh pressed twice, overlay closed)
is ignored (request token, as in the expenses file race).

### Send via WhatsApp

Opens `https://wa.me/<phone>?text=<msg>` (or `https://wa.me/?text=<msg>` when
the customer has no usable phone, which lets the admin pick a contact).
`waPhone(raw)`: keep digits; a 9-digit number starting with 9 or 2 gets `351`
in front; `00` prefix dropped; fewer than 9 digits → "".

Message (`payShareText(lang, name, label, amountStr, stripeUrl, lnAddress)`),
lines for unconfigured options omitted. A PT | EN toggle on the overlay picks
the language (default PT, remembered in localStorage `ko_pay_lang`):

PT:
```
Olá <name>! Kombucha <label>: €36,50.
Cartão / MB WAY: <stripeUrl> (introduza €36,50)
Bitcoin ⚡: <lnAddress>
Obrigado!
```
EN:
```
Hi <name>! Kombucha <label>: €36.50.
Card / MB WAY: <stripeUrl> (enter €36.50)
Bitcoin ⚡: <lnAddress>
Thank you!
```
(PT uses comma decimals, EN a dot. The WhatsApp message carries the address,
not an invoice, because invoices expire.)

The month label comes from `payLabel(lang, key)`: a monthKey → "Outubro 2026" /
"October 2026" (using lib.js's existing EN/PT month-name tables); a date
`YYYY-MM-DD` is returned as is.

## QR rendering

`qrcode-generator` from cdnjs (`https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js`),
error-correction level M, rendered as an SVG/`<img>` data URL, white quiet
zone, max 300 px wide. If the library failed to load, the tab shows the URL /
invoice as text with a Copy button instead of a QR.

## lib.js additions (unit-tested)

- `payReference(customerId, key)`
- `stripePayUrl(link, ref)`
- `validatePaySettings({ payStripeLink, payLightningAddress })` → `{ ok, errors, data }`
- `eurToSats(eur, price)`
- `parseBtcEurPrice(source, json)` (`"kraken"` | `"coinbase"`)
- `lnurlpUrl(address)` → string or null
- `parseLnurlPay(json)`
- `lnInvoiceUrl(callback, msat, comment)`
- `parseLnInvoice(json)` → `{ ok, pr, verify, reason }`
- `waPhone(raw)`
- `payShareText(lang, name, label, amountStr, stripeUrl, lnAddress)`
- `payLabel(lang, key)`
- `formatSats(n)` → `"52 140"` (thin grouping with spaces)

Bump `lib.js?v=` in index.html.

## Testing

- `npm test` for all lib.js functions above (including malformed JSON, out of
  range, a link that already has `?`, phone formats).
- `node --check` every `<script>` block in index.html.
- Manual after deploy: fill Settings; open Pay on a month; scan the card QR
  with a phone (Stripe page opens; after a €1 test payment the dashboard shows
  the reference); scan the ⚡ QR with a wallet and pay a small amount; check
  Paid ✓ appears if the provider supports verify; Send via WhatsApp opens the
  right chat with the right text; save prices in Settings and confirm the
  payment fields survive.

## Out of scope

Automatic Stripe paid-status (webhooks/server), customer-facing Pay in their
own login, exact-amount Stripe checkout, on-chain bitcoin, currencies other
than EUR, partial payments.
