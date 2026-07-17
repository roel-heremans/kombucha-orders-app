# WhatsApp Notifications (CallMeBot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WhatsApp Roel + Nina when a restaurant places a new order and when an order is delivered (fulfilled), via CallMeBot (client-side, free, no backend). Dormant until configured; best-effort (never affects the order/delivery flow).

**Architecture:** A pure tested `whatsappOrderText` in `lib.js`; a `CALLMEBOT_RECIPIENTS` config + a guarded `notifyWhatsApp(text)` sender (fetch to CallMeBot, `no-cors`, never throws); fired from the restaurant `onSend` (new order) and the delivery-form `onSave` fulfil branch (delivered). No Firebase/rules change.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step), `fetch`, `node --test`, GitHub Pages.

## Global Constraints

- No build step; single `index.html` + `lib.js`. No deps; no library — plain `fetch`.
- Pure logic in `lib.js` (UMD return object) with tests in `test/lib.test.js`; run `npm test`.
- Firebase/DOM/network glue verified manually in the browser.
- Feature **dormant until configured**: `CALLMEBOT_RECIPIENTS` entries empty → `notifyWhatsApp` no-ops. It must **never throw** and never be awaited into the order/delivery UI.
- CallMeBot GET: `https://api.callmebot.com/whatsapp.php?phone=<E164>&text=<enc>&apikey=<key>`, sent with `fetch(url, { mode: "no-cors" })`.
- Messages are short: customer + items summary (via existing `orderItemsSummary`).

---

### Task 1: `whatsappOrderText` helper in `lib.js`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

**Interfaces (produced):** `KO.whatsappOrderText(event, customerName, itemsSummary)` → `"✅ Delivered — <c>: <items>"` when `event === "delivered"`, else `"🧋 New order — <c>: <items>"`.

- [ ] **Step 1: Write the failing tests**

Append to `test/lib.test.js`:

```javascript
test("whatsappOrderText builds new/delivered messages", () => {
  assert.strictEqual(KO.whatsappOrderText("new", "Palm Spot", "8x 1 L Ginger"),
    "🧋 New order — Palm Spot: 8x 1 L Ginger");
  assert.strictEqual(KO.whatsappOrderText("delivered", "Sun Spot", "6x 270 ml Lemon"),
    "✅ Delivered — Sun Spot: 6x 270 ml Lemon");
  assert.match(KO.whatsappOrderText("anything-else", "X", "y"), /^🧋 New order — /);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — Expected: FAIL (`KO.whatsappOrderText is not a function`).

- [ ] **Step 3: Add the implementation**

In `lib.js`, add near `orderEmailParams`:

```javascript
  function whatsappOrderText(event, customerName, itemsSummary) {
    const prefix = event === "delivered" ? "✅ Delivered — " : "🧋 New order — ";
    return prefix + customerName + ": " + itemsSummary;
  }
```

- [ ] **Step 4: Export it**

Add `whatsappOrderText` to the `return { ... }` object in `lib.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add whatsappOrderText helper to lib.js"
```

---

### Task 2: CALLMEBOT_RECIPIENTS + notifyWhatsApp sender + wire both events

**Files:**
- Modify: `index.html` — module script (`CALLMEBOT_RECIPIENTS` + `notifyWhatsApp`); restaurant `onSend` (new-order fire); delivery-form `onSave` fulfil branch (delivered fire).

**Interfaces (produced):** `A.notifyWhatsApp(text)` → no-op if unconfigured; never throws.

- [ ] **Step 1: Add CALLMEBOT_RECIPIENTS**

In the module script, immediately after the `EMAILJS_CONFIG` line, add:

```javascript
    // Optional WhatsApp alerts via CallMeBot (see docs/CALLMEBOT_SETUP.md). Empty phone/apikey = skipped.
    const CALLMEBOT_RECIPIENTS = [
      { phone: "", apikey: "" }, // Roel
      { phone: "", apikey: "" }, // Nina
    ];
```

- [ ] **Step 2: Add the notifyWhatsApp sender**

After the `window.APP.notifyNewOrder = …` function (near the other `window.APP.*` helpers), add:

```javascript
    window.APP.notifyWhatsApp = function (text) {
      (CALLMEBOT_RECIPIENTS || []).forEach(function (r) {
        if (!r || !r.phone || !r.apikey) return;
        const url = "https://api.callmebot.com/whatsapp.php?phone=" + encodeURIComponent(r.phone) +
          "&text=" + encodeURIComponent(text) + "&apikey=" + encodeURIComponent(r.apikey);
        try { fetch(url, { mode: "no-cors" }).catch(function (e) { console.warn("whatsapp failed:", e); }); }
        catch (e) { console.warn("whatsapp failed:", e); }
      });
    };
```

- [ ] **Step 3: Fire on new order (restaurant `onSend`)**

In the restaurant view `onSend`, the `if (saved) { … }` block currently contains the email `notifyNewOrder` try/catch. Add a second try/catch after it, still inside `if (saved)`:

```javascript
      if (saved) {
        try {
          A.notifyNewOrder(KO.orderEmailParams(
            { items, preferredDate, note }, A.myCustomer.name,
            A.state.settings.sizes, A.flavourName, new Date().toLocaleString()
          ));
        } catch (e) { console.warn("order email skipped:", e); }
        try {
          A.notifyWhatsApp(KO.whatsappOrderText("new", A.myCustomer.name,
            KO.orderItemsSummary({ items }, A.state.settings.sizes, A.flavourName)));
        } catch (e) { console.warn("order whatsapp skipped:", e); }
      }
```

- [ ] **Step 4: Fire on delivered (delivery-form `onSave`, fulfil branch)**

In the delivery-form `onSave`, the non-editing branch has:

```javascript
          const orderId = fulfilling;
          fulfilling = null;
          if (orderId) await A.setOrderDelivered(orderId, ref.id);
```

Replace the `if (orderId) …` line with:

```javascript
          if (orderId) {
            await A.setOrderDelivered(orderId, ref.id);
            try {
              A.notifyWhatsApp(KO.whatsappOrderText("delivered", A.customerName(d.customerId),
                KO.orderItemsSummary(d, A.state.settings.sizes, A.flavourName)));
            } catch (e) { console.warn("delivered whatsapp skipped:", e); }
          }
```

(`d` is the delivery just saved. This fires only when fulfilling an order — a standalone delivery has `orderId` null. `notifyWhatsApp` swallows its own errors; the extra try/catch is belt-and-suspenders so the save UI is never affected.)

- [ ] **Step 5: Syntax-check + tests**

Run the inline-script syntax check (expected `classic blocks 8 errors 0`) and `npm test` (green — no lib change here):
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;while((m=re.exec(h))){const s=m[1];if(!s.trim()||/^\s*import\s/m.test(s))continue;i++;try{new Function(s)}catch(e){console.log("ERR",e.message);bad++}}console.log("classic blocks",i,"errors",bad)'
```

- [ ] **Step 6: Manual verification (browser)**

With `CALLMEBOT_RECIPIENTS` empty: place an order (restaurant) and fulfil an order (admin) → both complete normally, no console error from `notifyWhatsApp` (no-op). (Real WhatsApp delivery is verified after the setup doc + filling real phone/apikey — deferred to the controller/human.)

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: best-effort WhatsApp alerts (CallMeBot) on new order + delivered"
```

---

### Task 3: Setup docs

**Files:**
- Create: `docs/CALLMEBOT_SETUP.md`
- Modify: `README.md` (one-line pointer)

- [ ] **Step 1: Write `docs/CALLMEBOT_SETUP.md`**

```markdown
# WhatsApp alerts via CallMeBot (optional)

The app can WhatsApp Roel + Nina when a restaurant places an order and when an
order is delivered. Optional and off until configured. Uses CallMeBot
(client-side, free).

Register each recipient's number (do this on each phone — Roel's and Nina's):

1. Add CallMeBot's WhatsApp number to your contacts (get it from
   https://www.callmebot.com/blog/free-api-whatsapp-messages/).
2. Send it exactly: `I allow callmebot to send me messages to my phone`.
3. It replies with your personal **API key** (and confirms your number).

Then configure the app:

4. In `index.html`, fill `CALLMEBOT_RECIPIENTS` with each person's phone in
   E.164 form (e.g. `+3519xxxxxxxx`) and their `apikey`. Commit and push.

Notes:
- Free and rate-limited (a few messages/min) — ample here.
- The API keys sit in the client (like the EmailJS key); worst case someone
  could ping your WhatsApp — rotate the key via CallMeBot if needed.
- Blank a recipient's `phone` or `apikey` to disable them; empty all to turn the
  feature off. Orders/deliveries always work regardless — WhatsApp is a bonus
  alert.
```

- [ ] **Step 2: README pointer**

In `README.md`, under the order-notifications note, add a line that WhatsApp
alerts (new order + delivered, to Roel + Nina) are available via CallMeBot — see
`docs/CALLMEBOT_SETUP.md` — optional and off until configured.

- [ ] **Step 3: Commit**

```bash
git add docs/CALLMEBOT_SETUP.md README.md
git commit -m "docs: CallMeBot WhatsApp setup guide"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** message helper (Task 1); dormant config + guarded non-throwing sender + both event fires (Task 2); setup doc (Task 3). New-order + delivered only; recipients Roel+Nina in config; best-effort. ✓
- **Types consistent:** `whatsappOrderText(event, customerName, itemsSummary)` fed by `orderItemsSummary(...)`; `notifyWhatsApp(text)` takes the string. Fire sites pass the just-sent order / just-saved delivery. ✓
- **No placeholders.** Full code + commands throughout.

## Notes for the implementer

- Only `lib.js` is unit-tested (Task 1 TDD). Task 2 is glue verified in the browser (empty config must no-op cleanly); real WhatsApp delivery is verified by the controller/human after CallMeBot registration.
- `notifyWhatsApp` must never throw and is never awaited into the order/delivery UI; the delivered fire sits after `setOrderDelivered` inside the `if (orderId)` branch so standalone deliveries don't notify.
```
