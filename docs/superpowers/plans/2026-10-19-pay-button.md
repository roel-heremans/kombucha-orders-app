# Pay Button (Stripe + Lightning) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Pay button in the admin Payments tab that shows a QR for a Stripe "customer chooses what to pay" link and an exact-amount Lightning invoice, plus Send-via-WhatsApp and Mark paid.

**Architecture:** Static PWA, no build. Pure helpers go in `lib.js` (UMD, `window.KO` in the browser, `require` in tests) and are unit-tested. UI lives in `index.html`: the Settings view gets a Payments card, the Payments view gets Pay buttons, and a new plain `<script>` block registers `window.APP.openPay(...)` which draws a full-screen overlay appended to `document.body` (so the snapshot-driven re-render of the Payments view does not destroy it). Lightning invoices are fetched from the browser (LNURL-pay endpoints and the Kraken/Coinbase price APIs send `Access-Control-Allow-Origin`).

**Tech Stack:** Vanilla JS, Firebase Firestore v10 (CDN), `qrcode-generator` 1.4.4 from cdnjs, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-19-pay-button-design.md`

## Global Constraints

- No server, no new Firestore collections, no `firestore.rules` change. New settings fields live in `settings/app`: `payStripeLink`, `payLightningAddress` (strings, "" = option hidden).
- `A.saveSettings` must write with `{ merge: true }`.
- Every change to `lib.js` bumps the script tag in `index.html` to `lib.js?v=2026-10-19` (GitHub Pages caches lib.js 10 min; an old lib.js under new HTML white-screens the app).
- Module-block consts are not visible to plain `<script>` blocks; anything shared goes through `window.APP` / `window.KO`.
- Do not `await` Firestore writes before updating UI (with the persistent cache they resolve only on server ack; offline they hang). Fire the write, attach `.catch` that toasts.
- No browser `alert`/`confirm`/`prompt` in new code; use `A.toast(msg, isError)`.
- Escape every user/customer string inserted into HTML with `A.esc`.
- External scripts only from cdnjs.cloudflare.com.
- Fetch timeouts 10 s. Lightning QR text is `"LIGHTNING:" + pr.toUpperCase()` encoded in QR Alphanumeric mode.
- Do not test against production Firebase data; manual checks happen after deploy, by the user.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Saving bottle prices in Settings after the payment fields are filled must not erase them (merge) — covered by Task 2's manual check and the code review of `saveSettings`.
2. Floating-point € → sats: €0,10 at €50 000/BTC must be exactly 200 sats, not 201 — test in Task 1.
3. A slow invoice/price response arriving after Refresh, tab switch or Close must not overwrite the screen or keep polling — session token in Task 4; reviewer checks every `await` is followed by a token check.
4. Customer phone formats (`+351 913 000 048`, `913000048`, `0032…`, empty) → correct `wa.me` number or contact picker — tests in Task 1.
5. A Stripe link that already contains `?` gets `&client_reference_id=` — test in Task 1.

---

### Task 1: lib.js pay helpers

**Files:**
- Modify: `lib.js` (add helpers before the `return { … }` export object; add names to the export object)
- Modify: `index.html` line ~109 (`lib.js?v=2026-10-12` → `lib.js?v=2026-10-19`)
- Test: `test/lib.test.js` (append)

**Interfaces:**
- Consumes: existing `monthName(mk, lang)` and `trimStr(v)` in lib.js.
- Produces (all exported on `KO`):
  - `payReference(customerId, key) → string` (only `[A-Za-z0-9_-]`, ≤ 200 chars)
  - `stripePayUrl(link, ref) → string` ("" if link empty)
  - `validatePaySettings({ payStripeLink, payLightningAddress }) → { ok, errors: string[], data: { payStripeLink, payLightningAddress } }`; error codes `stripe_link_invalid`, `lightning_address_invalid`
  - `eurToSats(eur, price) → integer | null`
  - `parseBtcEurPrice(source /* "kraken"|"coinbase" */, json) → number | null`
  - `lnurlpUrl(address) → string | null`
  - `parseLnurlPay(json) → { callback, minMsat, maxMsat, commentAllowed } | null`
  - `lnInvoiceUrl(callback, msat, comment, commentAllowed) → string`
  - `parseLnInvoice(json) → { ok, pr, verify, reason }`
  - `lnSettled(json) → boolean`
  - `waPhone(raw) → string` (digits only, or "")
  - `payAmountStr(amount, lang) → "36,50"` (pt) / `"36.50"` (en)
  - `payLabel(lang, key) → "Outubro 2026" | "October 2026" | key unchanged`
  - `payShareText(lang, name, label, amountStr, stripeUrl, lnAddress) → string`
  - `formatSats(n) → "52 143"`

Note: the spec lists `lnInvoiceUrl(callback, msat, comment)`; the plan adds a 4th parameter `commentAllowed` because the comment must be cut to the provider's limit. It also adds `lnSettled` and `payAmountStr`, small helpers the spec's behaviour needs.

- [ ] **Step 1: Write the failing tests** — append to `test/lib.test.js`:

```js
test("payReference keeps only Stripe-safe characters and caps at 200", () => {
  assert.strictEqual(KO.payReference("abc123", "2026-10"), "abc123-2026-10");
  assert.strictEqual(KO.payReference("a b/c", "x.y"), "a_b_c-x_y");
  assert.strictEqual(KO.payReference("A".repeat(300), "k").length, 200);
});

test("stripePayUrl appends client_reference_id with ? or &", () => {
  assert.strictEqual(KO.stripePayUrl("https://buy.stripe.com/abc", "c1-2026-10"),
    "https://buy.stripe.com/abc?client_reference_id=c1-2026-10");
  assert.strictEqual(KO.stripePayUrl("https://buy.stripe.com/abc?locale=pt", "r"),
    "https://buy.stripe.com/abc?locale=pt&client_reference_id=r");
  assert.strictEqual(KO.stripePayUrl("", "r"), "");
});

test("validatePaySettings accepts empty/valid values and normalises", () => {
  const r = KO.validatePaySettings({ payStripeLink: "  https://buy.stripe.com/abc123 ", payLightningAddress: " Kombucha@Strike.ME " });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data, { payStripeLink: "https://buy.stripe.com/abc123", payLightningAddress: "kombucha@strike.me" });
  assert.strictEqual(KO.validatePaySettings({ payStripeLink: "", payLightningAddress: "" }).ok, true);
  assert.strictEqual(KO.validatePaySettings({}).ok, true);
});

test("validatePaySettings rejects non-Stripe links and malformed addresses", () => {
  const r = KO.validatePaySettings({ payStripeLink: "https://evil.example/pay", payLightningAddress: "not-an-address" });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.errors, ["stripe_link_invalid", "lightning_address_invalid"]);
  assert.ok(KO.validatePaySettings({ payStripeLink: "http://buy.stripe.com/x" }).errors.includes("stripe_link_invalid"));
  assert.strictEqual(KO.validatePaySettings({ payStripeLink: "https://checkout.stripe.com/c/pay/x" }).ok, true);
  assert.ok(KO.validatePaySettings({ payLightningAddress: "a@b" }).errors.includes("lightning_address_invalid"));
});

test("eurToSats rounds up without float noise", () => {
  assert.strictEqual(KO.eurToSats(0.1, 50000), 200);
  assert.strictEqual(KO.eurToSats(36.5, 70000), 52143);
  assert.strictEqual(KO.eurToSats(1, 0), null);
  assert.strictEqual(KO.eurToSats(0, 70000), null);
  assert.strictEqual(KO.eurToSats(5, NaN), null);
});

test("parseBtcEurPrice reads Kraken and Coinbase shapes", () => {
  assert.strictEqual(KO.parseBtcEurPrice("kraken", { error: [], result: { XXBTZEUR: { c: ["70123.4", "0.01"] } } }), 70123.4);
  assert.strictEqual(KO.parseBtcEurPrice("kraken", { error: ["EQuery:Unknown asset pair"] }), null);
  assert.strictEqual(KO.parseBtcEurPrice("coinbase", { data: { amount: "69999.99", currency: "EUR" } }), 69999.99);
  assert.strictEqual(KO.parseBtcEurPrice("coinbase", {}), null);
  assert.strictEqual(KO.parseBtcEurPrice("coinbase", null), null);
  assert.strictEqual(KO.parseBtcEurPrice("other", { data: { amount: "1" } }), null);
});

test("lnurlpUrl builds the well-known URL", () => {
  assert.strictEqual(KO.lnurlpUrl("Kombucha@Strike.me"), "https://strike.me/.well-known/lnurlp/kombucha");
  assert.strictEqual(KO.lnurlpUrl("bad"), null);
  assert.strictEqual(KO.lnurlpUrl(""), null);
});

test("parseLnurlPay validates a payRequest", () => {
  assert.deepStrictEqual(KO.parseLnurlPay({ tag: "payRequest", callback: "https://strike.me/api/lnurlp/k/", minSendable: 1000, maxSendable: 5000000, commentAllowed: 100 }),
    { callback: "https://strike.me/api/lnurlp/k/", minMsat: 1000, maxMsat: 5000000, commentAllowed: 100 });
  assert.strictEqual(KO.parseLnurlPay({ tag: "payRequest", callback: "https://x/cb", minSendable: 1000, maxSendable: 2000 }).commentAllowed, 0);
  assert.strictEqual(KO.parseLnurlPay({ tag: "withdrawRequest", callback: "https://x" }), null);
  assert.strictEqual(KO.parseLnurlPay({ tag: "payRequest", callback: "http://x/cb", minSendable: 1, maxSendable: 2 }), null);
  assert.strictEqual(KO.parseLnurlPay({ tag: "payRequest", callback: "https://x/cb" }), null);
  assert.strictEqual(KO.parseLnurlPay(null), null);
});

test("lnInvoiceUrl adds amount and a comment cut to the allowed length", () => {
  assert.strictEqual(KO.lnInvoiceUrl("https://x/cb", 52143000, "Kombucha – Ana", 0), "https://x/cb?amount=52143000");
  assert.strictEqual(KO.lnInvoiceUrl("https://x/cb?u=1", 1000, "abcdef", 3), "https://x/cb?u=1&amount=1000&comment=abc");
  assert.strictEqual(KO.lnInvoiceUrl("https://x/cb", 1000, "a b", 10), "https://x/cb?amount=1000&comment=a%20b");
});

test("parseLnInvoice returns pr/verify or the error reason", () => {
  assert.deepStrictEqual(KO.parseLnInvoice({ pr: "lnbc521430n1abc", routes: [], verify: "https://x/verify/1" }),
    { ok: true, pr: "lnbc521430n1abc", verify: "https://x/verify/1", reason: "" });
  assert.deepStrictEqual(KO.parseLnInvoice({ pr: "lnbc1xyz" }), { ok: true, pr: "lnbc1xyz", verify: "", reason: "" });
  assert.deepStrictEqual(KO.parseLnInvoice({ status: "ERROR", reason: "Amount too low" }), { ok: false, pr: "", verify: "", reason: "Amount too low" });
  assert.strictEqual(KO.parseLnInvoice({ pr: "notaninvoice" }).ok, false);
  assert.strictEqual(KO.parseLnInvoice({ pr: "lnbc1", verify: "http://insecure" }).verify, "");
  assert.strictEqual(KO.parseLnInvoice(null).ok, false);
});

test("lnSettled is true only for settled:true", () => {
  assert.strictEqual(KO.lnSettled({ status: "OK", settled: true, preimage: "ab" }), true);
  assert.strictEqual(KO.lnSettled({ status: "OK", settled: false }), false);
  assert.strictEqual(KO.lnSettled(null), false);
});

test("waPhone normalises Portuguese and international numbers", () => {
  assert.strictEqual(KO.waPhone("+351 913 000 048"), "351913000048");
  assert.strictEqual(KO.waPhone("913000048"), "351913000048");
  assert.strictEqual(KO.waPhone("291 123 456"), "351291123456");
  assert.strictEqual(KO.waPhone("0032 470 12 34 56"), "32470123456");
  assert.strictEqual(KO.waPhone("123"), "");
  assert.strictEqual(KO.waPhone(""), "");
  assert.strictEqual(KO.waPhone(undefined), "");
});

test("payAmountStr uses comma for pt, dot for en", () => {
  assert.strictEqual(KO.payAmountStr(36.5, "pt"), "36,50");
  assert.strictEqual(KO.payAmountStr(36.5, "en"), "36.50");
  assert.strictEqual(KO.payAmountStr(0.1 + 0.2, "pt"), "0,30");
});

test("payLabel names months per language and passes dates through", () => {
  assert.strictEqual(KO.payLabel("pt", "2026-10"), "Outubro 2026");
  assert.strictEqual(KO.payLabel("en", "2026-10"), "October 2026");
  assert.strictEqual(KO.payLabel("pt", "2026-10-14"), "2026-10-14");
});

test("payShareText builds PT and EN messages and skips missing options", () => {
  assert.strictEqual(
    KO.payShareText("pt", "Ana", "Outubro 2026", "36,50", "https://buy.stripe.com/a?client_reference_id=r", "k@strike.me"),
    "Olá Ana! Kombucha Outubro 2026: €36,50.\n" +
    "Cartão / MB WAY: https://buy.stripe.com/a?client_reference_id=r (introduza €36,50)\n" +
    "Bitcoin ⚡: k@strike.me\n" +
    "Obrigado!");
  assert.strictEqual(
    KO.payShareText("en", "Bob", "October 2026", "36.50", "", "k@strike.me"),
    "Hi Bob! Kombucha October 2026: €36.50.\nBitcoin ⚡: k@strike.me\nThank you!");
});

test("formatSats groups thousands with spaces", () => {
  assert.strictEqual(KO.formatSats(52143), "52 143");
  assert.strictEqual(KO.formatSats(999), "999");
  assert.strictEqual(KO.formatSats(1234567.4), "1 234 567");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the new tests FAIL with `KO.payReference is not a function` (and similar); the 99 existing tests pass.

- [ ] **Step 3: Implement** — in `lib.js`, insert this block directly before the final `return { formatMoney, …` line (after `zipStore`'s closing brace is fine):

```js
  // ---- Pay button (Stripe "customer chooses amount" link + Lightning invoice) ----
  const LN_ADDRESS_RE = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

  // Stripe client_reference_id: alphanumerics, dashes, underscores, max 200 chars.
  function payReference(customerId, key) {
    return (String(customerId || "") + "-" + String(key || "")).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);
  }

  function stripePayUrl(link, ref) {
    const base = trimStr(link);
    if (!base) return "";
    return base + (base.indexOf("?") >= 0 ? "&" : "?") + "client_reference_id=" + encodeURIComponent(ref);
  }

  function validatePaySettings(input) {
    const link = trimStr(input && input.payStripeLink);
    const addr = trimStr(input && input.payLightningAddress).toLowerCase();
    const errors = [];
    if (link && !/^https:\/\/(buy|checkout)\.stripe\.com\/\S+$/.test(link)) errors.push("stripe_link_invalid");
    if (addr && !LN_ADDRESS_RE.test(addr)) errors.push("lightning_address_invalid");
    return { ok: errors.length === 0, errors: errors, data: { payStripeLink: link, payLightningAddress: addr } };
  }

  // The tiny epsilon stops float noise (0.1 € / 50 000 → 200.00000000000003) rounding up a whole sat.
  function eurToSats(eur, price) {
    if (!(eur > 0) || !(price > 0)) return null;
    return Math.ceil(eur / price * 1e8 - 1e-6);
  }

  function parseBtcEurPrice(source, json) {
    let v = NaN;
    try {
      if (source === "kraken") {
        if (json.error && json.error.length) return null;
        const keys = Object.keys(json.result || {});
        v = parseFloat(keys.length ? json.result[keys[0]].c[0] : NaN);
      } else if (source === "coinbase") {
        v = parseFloat(json.data.amount);
      }
    } catch (e) { return null; }
    return isFinite(v) && v > 0 ? v : null;
  }

  function lnurlpUrl(address) {
    const a = trimStr(address).toLowerCase();
    if (!LN_ADDRESS_RE.test(a)) return null;
    const at = a.indexOf("@");
    return "https://" + a.slice(at + 1) + "/.well-known/lnurlp/" + a.slice(0, at);
  }

  function parseLnurlPay(json) {
    if (!json || json.tag !== "payRequest" || typeof json.callback !== "string" || !/^https:\/\//.test(json.callback)) return null;
    const minMsat = Number(json.minSendable), maxMsat = Number(json.maxSendable);
    if (!isFinite(minMsat) || !isFinite(maxMsat) || minMsat <= 0 || maxMsat < minMsat) return null;
    return { callback: json.callback, minMsat: minMsat, maxMsat: maxMsat, commentAllowed: Number(json.commentAllowed) || 0 };
  }

  function lnInvoiceUrl(callback, msat, comment, commentAllowed) {
    let url = callback + (callback.indexOf("?") >= 0 ? "&" : "?") + "amount=" + Math.round(msat);
    const max = Number(commentAllowed) || 0;
    if (max > 0 && comment) url += "&comment=" + encodeURIComponent(String(comment).slice(0, max));
    return url;
  }

  function parseLnInvoice(json) {
    if (!json || typeof json !== "object") return { ok: false, pr: "", verify: "", reason: "" };
    if (json.status === "ERROR") return { ok: false, pr: "", verify: "", reason: String(json.reason || "") };
    if (typeof json.pr !== "string" || !/^ln/i.test(json.pr)) return { ok: false, pr: "", verify: "", reason: "" };
    const verify = typeof json.verify === "string" && /^https:\/\//.test(json.verify) ? json.verify : "";
    return { ok: true, pr: json.pr, verify: verify, reason: "" };
  }

  // LUD-21 verify response.
  function lnSettled(json) { return !!(json && json.settled === true); }

  // wa.me wants the full international number, digits only. Bare 9-digit
  // Portuguese numbers (mobile 9…, landline 2…) get 351 in front.
  function waPhone(raw) {
    let d = String(raw == null ? "" : raw).replace(/\D/g, "");
    if (d.indexOf("00") === 0) d = d.slice(2);
    if (d.length === 9 && /^[29]/.test(d)) d = "351" + d;
    return d.length >= 9 ? d : "";
  }

  function payAmountStr(amount, lang) {
    const s = formatMoney(amount);
    return lang === "pt" ? s.replace(".", ",") : s;
  }

  function payLabel(lang, key) {
    const k = String(key || "");
    return /^\d{4}-\d{2}$/.test(k) ? monthName(k, lang) + " " + k.slice(0, 4) : k;
  }

  function payShareText(lang, name, label, amountStr, stripeUrl, lnAddress) {
    const pt = lang === "pt";
    const lines = [(pt ? "Olá " : "Hi ") + name + "! Kombucha " + label + ": €" + amountStr + "."];
    if (stripeUrl) lines.push((pt ? "Cartão / MB WAY: " : "Card / MB WAY: ") + stripeUrl + (pt ? " (introduza €" : " (enter €") + amountStr + ")");
    if (lnAddress) lines.push("Bitcoin ⚡: " + lnAddress);
    lines.push(pt ? "Obrigado!" : "Thank you!");
    return lines.join("\n");
  }

  function formatSats(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
```

Then add to the export object (append after `receiptKind,`):
`payReference, stripePayUrl, validatePaySettings, eurToSats, parseBtcEurPrice, lnurlpUrl, parseLnurlPay, lnInvoiceUrl, parseLnInvoice, lnSettled, waPhone, payAmountStr, payLabel, payShareText, formatSats,`

`trimStr` and `monthName` are declared with `function` earlier in the factory, so they are in scope.

In `index.html`, change `<script src="lib.js?v=2026-10-12"></script>` to `<script src="lib.js?v=2026-10-19"></script>`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass (99 existing + 16 new = 115), 0 fail.

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.js index.html
git commit -m "Add pay helpers: Stripe reference URL, Lightning LNURL parsing, WhatsApp text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Settings — merge save + Payments card + setup doc

**Files:**
- Modify: `index.html` — `window.APP.saveSettings` (line ~433); Settings renderer (the `container.innerHTML = …` around line ~2046 and its handlers around line ~2120)
- Create: `docs/PAYMENTS_SETUP.md`
- Modify: `README.md` (Features list)

**Interfaces:**
- Consumes: `KO.validatePaySettings` (Task 1), `A.toast`, `A.esc`, `A.state.settings`.
- Produces: `A.state.settings.payStripeLink` / `.payLightningAddress` populated via `settings/app`.

- [ ] **Step 1: Make saveSettings merge** — replace

```js
    window.APP.saveSettings = (o) => setDoc(doc(db, "settings", "app"), o);
```
with
```js
    // merge: each Settings card saves only its own fields (prices vs payment settings).
    window.APP.saveSettings = (o) => setDoc(doc(db, "settings", "app"), o, { merge: true });
```

- [ ] **Step 2: Add the Payments card** — in the Settings renderer's `container.innerHTML = …` concatenation, directly after the "Bottle sizes & prices" card (the string ending `` `<p id="setMsg" class="muted"></p></details></div>` + ``), insert:

```js
        `<div class="card"><details><summary>Payments (Pay button)</summary>` +
          `<p class="muted">Used by the Pay button in the Payments tab — setup steps in docs/PAYMENTS_SETUP.md. Leave a field empty to hide that option.</p>` +
          `<label>Stripe payment link ("customers choose what to pay")</label>` +
          `<input id="payStripe" type="url" placeholder="https://buy.stripe.com/…" value="${A.esc(st.payStripeLink || "")}"/>` +
          `<label>Lightning address</label>` +
          `<input id="payLn" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="name@strike.me" value="${A.esc(st.payLightningAddress || "")}"/>` +
          `<button class="primary" id="savePay">Save payment settings</button>` +
          `<p id="payMsg" class="muted"></p></details></div>` +
```

- [ ] **Step 3: Wire the Save button** — directly after the existing `#saveSettings` click handler, add:

```js
      container.querySelector("#savePay").addEventListener("click", () => {
        const r = KO.validatePaySettings({
          payStripeLink: container.querySelector("#payStripe").value,
          payLightningAddress: container.querySelector("#payLn").value,
        });
        if (!r.ok) {
          container.querySelector("#payMsg").textContent = r.errors.map((e) =>
            e === "stripe_link_invalid" ? "The Stripe link must start with https://buy.stripe.com/."
              : "The Lightning address must look like name@domain.com.").join(" ");
          return;
        }
        // Not awaited: offline the promise only settles on server ack.
        A.saveSettings(r.data)
          .then(() => A.toast("Payment settings saved ✓"))
          .catch((e) => A.toast("Save failed: " + (e.code || e.message), true));
      });
```

- [ ] **Step 4: Write `docs/PAYMENTS_SETUP.md`**

```markdown
# Payments setup (Pay button)

The Pay button in the **Payments** tab shows a QR the customer scans to pay
for a month or a single delivery. Fill in one or both options in
**Settings → Payments (Pay button)**; an empty field hides that option.

## Card / Apple Pay / Google Pay / MB WAY — Stripe

1. Create a Stripe account (stripe.com) as a Portuguese business and finish
   verification (IBAN for payouts).
2. Dashboard → **Settings → Payment methods**: turn on Cards, Apple Pay,
   Google Pay and **MB WAY**.
3. Dashboard → **Payment Links → New** → choose **Customers choose what to
   pay**. Currency **EUR**. Name it e.g. "Real Health Kombucha". Save.
4. Copy the link (`https://buy.stripe.com/…`) into Settings → *Stripe payment link*.

The app adds `?client_reference_id=<customer>-<month or delivery>` to the link,
so each payment in the Stripe dashboard shows who and what it was for. A
Payment Link can't carry an amount, so the Pay screen shows the amount and
the customer types it on Stripe's page. Stripe emails you when a payment
arrives; then tap **Mark paid**.

## Bitcoin ⚡ — Lightning address

1. Get a Lightning address, e.g. install Strike, open your profile and copy
   `yourname@strike.me` (Strike can auto-convert received bitcoin to euros).
   Alby (`@getalby.com`) and Blink (`@blink.sv`) also work.
2. Paste it into Settings → *Lightning address*.

The Pay screen fetches the BTC/EUR price and creates an invoice for the
exact amount. It's valid about 10 minutes — tap **Refresh** if the customer
is slow. If the provider supports payment checking the screen shows
**Paid ✓**; otherwise check your wallet. Either way, tap **Mark paid**.

Tax: the sale is still kombucha revenue in euros on the recibo verde; ask the
accountant how to treat bitcoin you keep.
```

- [ ] **Step 5: README** — in the `## Features (implemented)` list, after the Expenses bullet, add:

```markdown
- **Pay button** — in the Payments tab, show a customer a QR to pay a month or
  a delivery by card / Apple Pay / Google Pay / MB WAY (Stripe link) or bitcoin
  (exact-amount Lightning invoice), or send it via WhatsApp. Setup:
  `docs/PAYMENTS_SETUP.md`.
```

- [ ] **Step 6: Syntax-check and test**

Run:
```bash
npm test && node -e '
const fs=require("fs");const h=fs.readFileSync("index.html","utf8");
const re=/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;
while((m=re.exec(h))){i++;const mod=/type="module"/.test(m[1]);
const f="/tmp/claude-1000/blk"+i+(mod?".mjs":".js");fs.writeFileSync(f,m[2]);
try{require("child_process").execFileSync("node",["--check",f],{stdio:"pipe"})}catch(e){bad++;console.log("block",i,String(e.stderr))}}
console.log(i,"blocks,",bad,"bad");process.exit(bad?1:0)'
```
Expected: tests pass; `N blocks, 0 bad`.

- [ ] **Step 7: Commit**

```bash
git add index.html docs/PAYMENTS_SETUP.md README.md
git commit -m "Settings: payment link and Lightning address, merge settings saves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pay overlay (Card tab, WhatsApp, Mark paid) + Pay buttons

**Files:**
- Modify: `index.html` — add QR library `<script>` tag next to the lib.js tag; Payments renderer (line ~880–941); new plain `<script>` block right after the Payments block.

**Interfaces:**
- Consumes: Task 1 helpers; `A.setDeliveriesPaid(ids, paid)`, `A.customerName(id)`, `A.state.customers` (`phone` field), `A.state.settings`, `A.toast`, `A.esc`; global `qrcode` from qrcode-generator.
- Produces: `window.APP.openPay({ customerId, refKey, labelKey, amount, deliveryIds })`. `refKey` = monthKey or delivery id (goes in the Stripe reference); `labelKey` = monthKey or `YYYY-MM-DD` (shown). Task 4 fills the Bitcoin tab by replacing the `drawBtc` stub defined here.

- [ ] **Step 1: QR library** — directly after `<script src="lib.js?v=2026-10-19"></script>` add:

```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
```

- [ ] **Step 2: Pay buttons in the Payments view** — in the Payments `render()`:

At the top of `render()` after `const data = …`, add:
```js
      const st = A.state.settings || {};
      const payOn = !!(st.payStripeLink || st.payLightningAddress);
```
Replace the month "Mark month paid" button string
```js
            `<button class="link" data-monthpaid="${c.customerId}|${m.monthKey}" style="flex:0 0 auto">Mark month paid</button></div>` +
```
with
```js
            (payOn ? `<button class="link" data-paymonth="${c.customerId}|${m.monthKey}" style="flex:0 0 auto">Pay</button>` : "") +
            `<button class="link" data-monthpaid="${c.customerId}|${m.monthKey}" style="flex:0 0 auto">Mark month paid</button></div>` +
```
and the delivery row string
```js
              `<div class="row"><div class="muted">${it.date} — €${KO.formatMoney(it.amount)}</div>` +
              `<button class="link" data-delivpaid="${it.id}" style="flex:0 0 auto">Mark paid</button></div>`).join("") +
```
with
```js
              `<div class="row"><div class="muted">${it.date} — €${KO.formatMoney(it.amount)}</div>` +
              (payOn ? `<button class="link" data-paydeliv="${c.customerId}|${it.id}" style="flex:0 0 auto">Pay</button>` : "") +
              `<button class="link" data-delivpaid="${it.id}" style="flex:0 0 auto">Mark paid</button></div>`).join("") +
```
After the existing `[data-monthpaid]` handlers, add:
```js
      container.querySelectorAll("[data-paymonth]").forEach((b) =>
        b.addEventListener("click", () => {
          const parts = b.dataset.paymonth.split("|");
          const cust = data.customers.find((x) => x.customerId === parts[0]);
          const mo = cust && cust.months.find((x) => x.monthKey === parts[1]);
          if (mo) A.openPay({ customerId: parts[0], refKey: mo.monthKey, labelKey: mo.monthKey,
            amount: mo.total, deliveryIds: mo.items.map((it) => it.id) });
        }));
      container.querySelectorAll("[data-paydeliv]").forEach((b) =>
        b.addEventListener("click", () => {
          const parts = b.dataset.paydeliv.split("|");
          const cust = data.customers.find((x) => x.customerId === parts[0]);
          let it = null;
          if (cust) cust.months.forEach((m) => m.items.forEach((x) => { if (x.id === parts[1]) it = x; }));
          if (it) A.openPay({ customerId: parts[0], refKey: it.id, labelKey: it.date,
            amount: it.amount, deliveryIds: [it.id] });
        }));
```

- [ ] **Step 3: Overlay block** — directly after the Payments view's closing `</script>`, add a new block:

```html
  <script>
  // Pay overlay: QR for the Stripe "customer chooses what to pay" link and an
  // exact-amount Lightning invoice. Appended to <body>, so Payments re-renders
  // on snapshots don't touch it.
  document.addEventListener("DOMContentLoaded", function () {
    const A = window.APP, KO = window.KO;
    // Bumped on every open, close, tab switch and invoice refresh; async work
    // started under an older value must drop its result.
    let session = 0;

    function qrImg(text, alnum) {
      if (typeof window.qrcode !== "function") return "";
      try {
        const q = window.qrcode(0, "M");
        q.addData(text, alnum ? "Alphanumeric" : "Byte");
        q.make();
        return `<img alt="QR code" src="${q.createDataURL(6, 4)}" style="display:block;width:100%;max-width:300px;margin:12px auto;background:#fff;image-rendering:pixelated"/>`;
      } catch (e) { console.warn("qr failed:", e); return ""; }
    }

    function copyText(t) {
      if (!navigator.clipboard) { A.toast("Copy not supported here", true); return; }
      navigator.clipboard.writeText(t).then(() => A.toast("Copied ✓"), () => A.toast("Copy failed", true));
    }

    function waLang() { try { return localStorage.getItem("ko_pay_lang") || "pt"; } catch (e) { return "pt"; } }
    function setWaLang(l) { try { localStorage.setItem("ko_pay_lang", l); } catch (e) {} }

    A.openPay = function (p) {
      const st = A.state.settings || {};
      const link = st.payStripeLink || "", addr = st.payLightningAddress || "";
      if (!link && !addr) return;
      session++;
      const amount = Math.round(p.amount * 100) / 100;
      const name = A.customerName(p.customerId);
      const cust = A.state.customers.find((c) => c.id === p.customerId) || {};
      const stripeUrl = link ? KO.stripePayUrl(link, KO.payReference(p.customerId, p.refKey)) : "";
      const ctx = { p: p, amount: amount, name: name, addr: addr, stopPoll: function () {} };
      let tab = link ? "card" : "btc";

      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;z-index:10000;background:var(--bg);overflow:auto;padding:16px";
      ov.innerHTML =
        `<div style="max-width:420px;margin:0 auto">` +
        `<h3 style="margin:0">${A.esc(name)}</h3>` +
        `<p class="muted" style="margin:4px 0">${A.esc(KO.payLabel("en", p.labelKey))}</p>` +
        `<p style="font-size:36px;font-weight:700;margin:8px 0">€${KO.payAmountStr(amount, "pt")}</p>` +
        `<div class="row" style="gap:16px">` +
          (link ? `<button class="link pay-tab" data-tab="card" style="flex:0 0 auto">💳 Card / MB WAY</button>` : "") +
          (addr ? `<button class="link pay-tab" data-tab="btc" style="flex:0 0 auto">⚡ Bitcoin</button>` : "") +
        `</div>` +
        `<div id="payBody"></div>` +
        `<div class="row" style="gap:8px;margin-top:16px;flex-wrap:wrap">` +
          `<button class="primary" id="payMarkPaid" style="flex:0 0 auto">Mark paid</button>` +
          `<a class="link" id="payWa" target="_blank" rel="noopener" style="flex:0 0 auto;align-self:center">Send via WhatsApp</a>` +
          `<button class="link" id="payClose" style="flex:0 0 auto">Close</button></div>` +
        `<p class="muted" style="margin-top:8px">WhatsApp text: <span id="payLang"></span></p>` +
        `</div>`;
      document.body.appendChild(ov);
      const body = ov.querySelector("#payBody");

      function close() { session++; ctx.stopPoll(); ov.remove(); }

      function drawLang() {
        const l = waLang();
        const b = (code, lbl) => `<button class="link" data-walang="${code}" style="width:auto;${l === code ? "font-weight:700;text-decoration:underline" : ""}">${lbl}</button>`;
        ov.querySelector("#payLang").innerHTML = b("pt", "PT") + " | " + b("en", "EN");
        ov.querySelectorAll("[data-walang]").forEach((x) => x.addEventListener("click", () => { setWaLang(x.dataset.walang); drawLang(); }));
        const txt = KO.payShareText(l, name, KO.payLabel(l, p.labelKey), KO.payAmountStr(amount, l), stripeUrl, addr);
        ov.querySelector("#payWa").href = "https://wa.me/" + KO.waPhone(cust.phone) + "?text=" + encodeURIComponent(txt);
      }

      function drawCard() {
        const amt = KO.payAmountStr(amount, "pt");
        body.innerHTML = (qrImg(stripeUrl, false) || `<p class="muted">QR unavailable — share the link instead.</p>`) +
          `<p style="text-align:center;font-size:18px">Introduza / Enter <strong>€${amt}</strong></p>` +
          `<p class="muted" style="word-break:break-all;text-align:center">${A.esc(stripeUrl)}</p>` +
          `<p style="text-align:center"><a href="${A.esc(stripeUrl)}" target="_blank" rel="noopener">Open link</a></p>`;
      }

      function showTab(t) {
        tab = t;
        session++; ctx.stopPoll();
        ov.querySelectorAll(".pay-tab").forEach((x) => {
          x.style.fontWeight = x.dataset.tab === tab ? "700" : "";
          x.style.textDecoration = x.dataset.tab === tab ? "underline" : "";
        });
        if (tab === "card") drawCard(); else A.payDrawBtc(body, ctx, () => session, () => ++session);
      }

      ov.querySelectorAll(".pay-tab").forEach((x) => x.addEventListener("click", () => showTab(x.dataset.tab)));
      ov.querySelector("#payClose").addEventListener("click", close);
      ov.querySelector("#payMarkPaid").addEventListener("click", () => {
        // Not awaited: offline the batch only settles on server ack.
        A.setDeliveriesPaid(p.deliveryIds, true)
          .catch((e) => A.toast("Mark paid failed: " + (e.code || e.message), true));
        A.toast("Marked paid ✓");
        close();
      });
      drawLang();
      showTab(tab);
    };

    // Replaced by the real Lightning flow in the next block.
    A.payDrawBtc = function (body) {
      body.innerHTML = `<p class="muted">Bitcoin coming soon.</p>`;
    };
  });
  </script>
```

`A.payDrawBtc(body, ctx, getSession, newSession)` contract for Task 4: `body` is the tab element; `ctx = { p, amount, name, addr, stopPoll }` where the function must set `ctx.stopPoll` to a function that stops its polling; `getSession()` returns the current session value; `newSession()` bumps it and returns the new value.

- [ ] **Step 4: Syntax-check and test** — run the same command as Task 2 Step 6.
Expected: tests pass; `0 bad`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Pay overlay with Stripe QR, WhatsApp share and Mark paid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Bitcoin tab — exact-amount Lightning invoice

**Files:**
- Modify: `index.html` — in the overlay block from Task 3, replace the `A.payDrawBtc` stub.

**Interfaces:**
- Consumes: `KO.parseBtcEurPrice`, `KO.eurToSats`, `KO.lnurlpUrl`, `KO.parseLnurlPay`, `KO.lnInvoiceUrl`, `KO.parseLnInvoice`, `KO.lnSettled`, `KO.formatSats`, `KO.payAmountStr`, `KO.payLabel`; Task 3's `qrImg`, `copyText` (same closure) and the `A.payDrawBtc(body, ctx, getSession, newSession)` contract.
- Produces: nothing for later tasks.

- [ ] **Step 1: Replace the stub** — delete

```js
    // Replaced by the real Lightning flow in the next block.
    A.payDrawBtc = function (body) {
      body.innerHTML = `<p class="muted">Bitcoin coming soon.</p>`;
    };
```
and insert in its place:

```js
    function fetchJson(url) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10000);
      return fetch(url, { signal: ctl.signal, cache: "no-store" })
        .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .finally(() => clearTimeout(timer));
    }

    async function btcEurPrice() {
      try {
        const v = KO.parseBtcEurPrice("kraken", await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTEUR"));
        if (v) return v;
      } catch (e) { console.warn("kraken price failed:", e); }
      try {
        return KO.parseBtcEurPrice("coinbase", await fetchJson("https://api.coinbase.com/v2/prices/BTC-EUR/spot"));
      } catch (e) { console.warn("coinbase price failed:", e); return null; }
    }

    // Fetches price → LNURL-pay → invoice straight from the browser; every await
    // is followed by a session check so Refresh/tab switch/Close win.
    A.payDrawBtc = async function (body, ctx, getSession, newSession) {
      ctx.stopPoll();
      const my = newSession();
      const live = () => my === getSession() && body.isConnected;
      const fail = (msg) => {
        if (!live()) return;
        body.innerHTML = `<p style="color:#b00020">${A.esc(msg)}</p><button class="link" id="btcRetry">Retry</button>`;
        body.querySelector("#btcRetry").addEventListener("click", () => A.payDrawBtc(body, ctx, getSession, newSession));
      };
      body.innerHTML = `<p class="muted">Creating invoice…</p>`;

      const price = await btcEurPrice();
      if (!live()) return;
      if (!price) return fail("Couldn't get the bitcoin price — check the connection.");
      const sats = KO.eurToSats(ctx.amount, price);

      const lnUrl = KO.lnurlpUrl(ctx.addr);
      let pay = null;
      try { if (lnUrl) pay = KO.parseLnurlPay(await fetchJson(lnUrl)); } catch (e) { console.warn("lnurlp failed:", e); }
      if (!live()) return;
      if (!pay) return fail("Lightning address didn't answer — check it in Settings.");
      const msat = sats * 1000;
      if (msat < pay.minMsat || msat > pay.maxMsat) {
        return fail("Amount is outside what this Lightning address accepts (" +
          KO.formatSats(Math.ceil(pay.minMsat / 1000)) + "–" + KO.formatSats(Math.floor(pay.maxMsat / 1000)) + " sats).");
      }

      let inv;
      try {
        const comment = "Kombucha – " + ctx.name + " – " + KO.payLabel("pt", ctx.p.labelKey);
        inv = KO.parseLnInvoice(await fetchJson(KO.lnInvoiceUrl(pay.callback, msat, comment, pay.commentAllowed)));
      } catch (e) { inv = { ok: false, reason: e.message || "" }; }
      if (!live()) return;
      if (!inv.ok) return fail("Couldn't create the invoice" + (inv.reason ? ": " + inv.reason : "."));

      body.innerHTML = (qrImg("LIGHTNING:" + inv.pr.toUpperCase(), true) || `<p class="muted">QR unavailable — copy the invoice instead.</p>`) +
        `<p style="text-align:center">€${KO.payAmountStr(ctx.amount, "pt")} ≈ <strong>${KO.formatSats(sats)} sats</strong> @ €${KO.formatSats(price)}/BTC</p>` +
        `<p id="btcStatus" class="muted" style="text-align:center">Invoice valid about 10 minutes.</p>` +
        `<div class="row" style="gap:8px;justify-content:center">` +
          `<button class="link" id="btcRefresh" style="flex:0 0 auto">Refresh</button>` +
          `<button class="link" id="btcCopy" style="flex:0 0 auto">Copy invoice</button></div>`;
      body.querySelector("#btcRefresh").addEventListener("click", () => A.payDrawBtc(body, ctx, getSession, newSession));
      body.querySelector("#btcCopy").addEventListener("click", () => copyText(inv.pr));

      if (!inv.verify) return;
      // LUD-21: poll while this exact invoice is on screen.
      let inFlight = false;
      const timer = setInterval(async () => {
        if (!live()) { clearInterval(timer); return; }
        if (inFlight) return;
        inFlight = true;
        try {
          const v = await fetchJson(inv.verify);
          if (live() && KO.lnSettled(v)) {
            clearInterval(timer);
            const s = body.querySelector("#btcStatus");
            if (s) { s.className = ""; s.textContent = "Paid ✓"; s.style.cssText = "text-align:center;font-size:24px;font-weight:700;color:var(--green)"; }
            const mp = document.getElementById("payMarkPaid");
            if (mp) mp.style.outline = "3px solid var(--green)";
          }
        } catch (e) { console.warn("verify failed:", e); }
        finally { inFlight = false; }
      }, 3000);
      ctx.stopPoll = () => clearInterval(timer);
    };
```

Note `qrImg` and `copyText` are declared in the same `DOMContentLoaded` closure (Task 3), so they are in scope.

- [ ] **Step 2: Syntax-check and test** — run the same command as Task 2 Step 6.
Expected: tests pass; `0 bad`.

- [ ] **Step 3: Offline smoke test of the flow against stubs** (no Firebase, no real network) — run in node:

```bash
node -e '
const fs=require("fs");const h=fs.readFileSync("index.html","utf8");
const KO=require("./lib.js");
const blk=h.split("<script>").map(s=>s.split("</script>")[0]).find(s=>s.includes("A.payDrawBtc = async"));
let listeners=[];global.document={addEventListener:(e,f)=>listeners.push(f),getElementById:()=>null};
global.window={APP:{esc:s=>String(s),toast:()=>{}},KO,qrcode:null};
const R={"https://api.kraken.com/0/public/Ticker?pair=XBTEUR":{error:[],result:{XXBTZEUR:{c:["50000"]}}},
"https://strike.me/.well-known/lnurlp/k":{tag:"payRequest",callback:"https://strike.me/cb",minSendable:1000,maxSendable:1e11}};
global.fetch=async u=>({ok:true,json:async()=>u.startsWith("https://strike.me/cb")?{pr:"lnbc2000n1test"}:R[u]});
eval(blk.replace("const A = window.APP, KO = window.KO;","const A = window.APP;"));listeners.forEach(f=>f());
const body={isConnected:true,innerHTML:"",querySelector:()=>({addEventListener(){}})};
let s=0;const ctx={p:{labelKey:"2026-10"},amount:0.1,name:"Ana",addr:"k@strike.me",stopPoll(){}};
window.APP.payDrawBtc(body,ctx,()=>s,()=>++s).then(()=>{console.log(body.innerHTML.includes("200 sats")?"OK":"FAIL",body.innerHTML.slice(0,200))});'
```
Expected: prints `OK` followed by the start of the invoice HTML (no QR, since `qrcode` is null, so the "QR unavailable" text shows).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Bitcoin tab: exact-amount Lightning invoice with LUD-21 paid check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Manual checks after deploy (user)

1. Settings → Payments: paste the Stripe link and Lightning address, Save → toast. Then change a bottle price and Save → reopen Payments card: both fields still there.
2. Payments tab: Pay on a month → amount correct; Card QR scanned with a phone opens Stripe; Stripe dashboard shows the `client_reference_id` after a €1 test payment.
3. ⚡ tab: wallet scans the QR and shows the right sats; pay a tiny amount on a test delivery; Paid ✓ appears if the provider supports verify; Refresh makes a new invoice.
4. Send via WhatsApp (PT and EN) opens the right chat with the right text; a customer without phone opens the contact picker.
5. Mark paid in the overlay marks exactly those deliveries; overlay closes.
6. On the iPhone home-screen app: overlay, WhatsApp link and Open link work.
