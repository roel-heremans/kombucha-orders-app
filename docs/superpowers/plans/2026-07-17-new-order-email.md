# New-Order Email Notifications (EmailJS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a restaurant places a new order, send a best-effort email alert to Roel + Nina via EmailJS (client-side, free). The order always saves regardless of email outcome.

**Architecture:** A pure `KO.orderEmailParams` builds the template fields; a guarded `window.APP.notifyNewOrder` POSTs them to the EmailJS REST API via `fetch` (no library, no-op when unconfigured, never throws); the restaurant's `onSend` fires it after a successful save. No Firebase or rules changes.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step), Firebase (unchanged), EmailJS REST API via `fetch`, `node --test` for lib logic, GitHub Pages.

## Global Constraints

- No build step; single `index.html` + `lib.js` + CDN Firebase. No bundlers/npm runtime deps, and no `@emailjs/browser` script — use plain `fetch`.
- Pure, testable logic in `lib.js` (UMD return object) with tests in `test/lib.test.js`; run `npm test` (`node --test`).
- Firebase/DOM/network glue is verified **manually in the browser** (no DOM harness).
- Each view is its own `DOMContentLoaded` IIFE reading `window.APP` (alias `A`) and `window.KO` (alias `KO`).
- The feature is **dormant until configured**: `EMAILJS_CONFIG = { serviceId: "", templateId: "", publicKey: "" }` empty → `notifyNewOrder` is a no-op. It must never throw or affect the order flow.
- Email is **best-effort and fired after a successful `A.addOrder`** — never awaited into the success/failure UI, never able to block or fail the order.
- EmailJS REST call shape: `POST https://api.emailjs.com/api/v1.0/email/send`, JSON body `{ service_id, template_id, user_id: <publicKey>, template_params }`.
- Recipients are configured in the EmailJS template (To field), not in the app.

---

### Task 1: `orderEmailParams` helper in `lib.js`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

**Interfaces:**
- Produces: `KO.orderEmailParams(order, restaurantName, sizes, flavourName, placedAt)` →
  `{ restaurant_name, items, preferred_date, note, placed_at }`. `items` uses
  `orderItemsSummary`; empty `order.preferredDate`/`order.note` become `"—"`;
  `placedAt` passes through (or `""`).
- Consumes: existing `orderItemsSummary` in `lib.js`.

- [ ] **Step 1: Write the failing tests**

Append to `test/lib.test.js` (uses the existing `SIZES` fixture):

```javascript
test("orderEmailParams assembles template fields", () => {
  const order = { items: [{ sizeId: "1L", flavourId: "gin", quantity: 8 }], preferredDate: "2026-07-20", note: "before noon" };
  const p = KO.orderEmailParams(order, "Sun Spot", SIZES, (id) => ({ gin: "Ginger" }[id] || id), "Jul 17, 2026");
  assert.strictEqual(p.restaurant_name, "Sun Spot");
  assert.strictEqual(p.items, "8x 1 L Ginger");
  assert.strictEqual(p.preferred_date, "2026-07-20");
  assert.strictEqual(p.note, "before noon");
  assert.strictEqual(p.placed_at, "Jul 17, 2026");
});

test("orderEmailParams uses — for empty date/note and tolerates no placedAt", () => {
  const p = KO.orderEmailParams({ items: [] }, "X", SIZES);
  assert.strictEqual(p.preferred_date, "—");
  assert.strictEqual(p.note, "—");
  assert.strictEqual(p.items, "");
  assert.strictEqual(p.placed_at, "");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `KO.orderEmailParams is not a function`.

- [ ] **Step 3: Add the implementation**

In `lib.js`, add near `orderItemsSummary`:

```javascript
  function orderEmailParams(order, restaurantName, sizes, flavourName, placedAt) {
    return {
      restaurant_name: restaurantName,
      items: orderItemsSummary(order, sizes, flavourName),
      preferred_date: (order && order.preferredDate) || "—",
      note: (order && order.note) || "—",
      placed_at: placedAt || "",
    };
  }
```

- [ ] **Step 4: Export it**

Add `orderEmailParams` to the `return { ... }` object in `lib.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add orderEmailParams helper to lib.js"
```

---

### Task 2: EMAILJS_CONFIG + notifyNewOrder sender + wire restaurant onSend

**Files:**
- Modify: `index.html` — module script (add `EMAILJS_CONFIG` + `window.APP.notifyNewOrder`); restaurant view `onSend` (fire the notification after a successful save).

**Interfaces:**
- Consumes: `KO.orderEmailParams` (Task 1), `A.myCustomer`, `A.state.settings.sizes`, `A.flavourName`.
- Produces: `A.notifyNewOrder(params)` → Promise (no-op if unconfigured; never throws).

- [ ] **Step 1: Add EMAILJS_CONFIG**

In the module script, immediately after the `FIREBASE_CONFIG` object literal (the block starting `const FIREBASE_CONFIG = { … };` around line 93–101), add:

```javascript
    // Optional new-order email alerts (see docs/EMAILJS_SETUP.md). Empty = disabled.
    const EMAILJS_CONFIG = { serviceId: "", templateId: "", publicKey: "" };
```

- [ ] **Step 2: Add the notifyNewOrder helper**

In the module script, near the other `window.APP.*` helpers (e.g. after `window.APP.serverTimestamp = serverTimestamp;`), add:

```javascript
    window.APP.notifyNewOrder = async function (params) {
      const c = EMAILJS_CONFIG;
      if (!c.serviceId || !c.templateId || !c.publicKey) return; // disabled until configured
      try {
        const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_id: c.serviceId,
            template_id: c.templateId,
            user_id: c.publicKey,
            template_params: params || {},
          }),
        });
        if (!res.ok) console.warn("notifyNewOrder: EmailJS HTTP", res.status);
      } catch (e) {
        console.warn("notifyNewOrder failed:", e);
      }
    };
```

- [ ] **Step 3: Wire the restaurant onSend**

In the restaurant view `onSend`, hoist `preferredDate`/`note` into locals (so both the order and the email reuse them) and fire the notification after the success message. Replace the current block:

```javascript
      if (btn) btn.disabled = true;
      try {
        await A.addOrder({
          customerId: A.myCustomer.id,
          customerUid: A.user.uid,
          items,
          preferredDate: body.querySelector("#orderDate").value || "",
          note: body.querySelector("#orderNote").value.trim(),
          status: "requested",
          createdAt: A.serverTimestamp(),
        });
        const msg = document.getElementById("orderErr");
        if (msg) msg.textContent = "Order sent ✓";
      } catch (ex) {
```

with:

```javascript
      if (btn) btn.disabled = true;
      const preferredDate = body.querySelector("#orderDate").value || "";
      const note = body.querySelector("#orderNote").value.trim();
      try {
        await A.addOrder({
          customerId: A.myCustomer.id,
          customerUid: A.user.uid,
          items, preferredDate, note,
          status: "requested",
          createdAt: A.serverTimestamp(),
        });
        const msg = document.getElementById("orderErr");
        if (msg) msg.textContent = "Order sent ✓";
        A.notifyNewOrder(KO.orderEmailParams(
          { items, preferredDate, note },
          A.myCustomer.name,
          A.state.settings.sizes,
          A.flavourName,
          new Date().toLocaleString()
        ));
      } catch (ex) {
```

(The `catch (ex) { … }` block below is unchanged. `notifyNewOrder` is intentionally not awaited and swallows its own errors, so the order UI is unaffected.)

- [ ] **Step 4: Syntax-check**

Run:
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;while((m=re.exec(h))){const s=m[1];if(!s.trim()||/^\s*import\s/m.test(s))continue;i++;try{new Function(s)}catch(e){console.log("ERR",e.message);bad++}}console.log("classic blocks",i,"errors",bad)'
```
Expected: `classic blocks 7 errors 0`.

- [ ] **Step 5: Run unit tests (guard)**

Run: `npm test`
Expected: PASS (no lib change here beyond Task 1).

- [ ] **Step 6: Manual verification**

With `EMAILJS_CONFIG` still empty: run `python3 -m http.server 8000`, log in as a restaurant, place an order → "Order sent ✓" appears, the order lands in the admin Orders tab, and the browser console shows **no error** from `notifyNewOrder` (it no-ops). (Full email delivery is verified after the setup doc is done and real IDs are filled in — deferred to the controller/human.)

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: best-effort EmailJS new-order notification (dormant until configured)"
```

---

### Task 3: Setup docs

**Files:**
- Create: `docs/EMAILJS_SETUP.md`
- Modify: `README.md` (short "Order notifications" note)

**Interfaces:** docs only.

- [ ] **Step 1: Write `docs/EMAILJS_SETUP.md`**

Create the file with these steps (adjust wording as needed, keep it terse and accurate):

```markdown
# EmailJS setup — new-order email alerts (optional)

When a restaurant places an order, the app can email Roel + Nina. This is
optional and off until configured. It uses EmailJS (client-side, free tier).

1. Create a free account at https://www.emailjs.com.
2. **Email Services** → add a service and connect your Gmail. Note the
   **Service ID**.
3. **Email Templates** → create a template. Use these variables in the
   subject/body: `{{restaurant_name}}`, `{{items}}`, `{{preferred_date}}`,
   `{{note}}`, `{{placed_at}}`. Set the template **To** to
   `roel.heremans@gmail.com, reissnina@gmail.com`. Note the **Template ID**.
   Example body:
   > New kombucha order from {{restaurant_name}}
   > Items: {{items}}
   > Preferred date: {{preferred_date}}
   > Note: {{note}}
   > Placed: {{placed_at}}
4. **Account → General/API** → copy your **Public Key**.
5. In `index.html`, fill in `EMAILJS_CONFIG` with the Service ID, Template ID,
   and Public Key. Commit and push.
6. **Account → Security** → turn on the allow-list and add your site origin
   `https://roel-heremans.github.io` so the public key can't be used elsewhere.

Notes:
- The order always saves and appears in the admin Orders tab even if the email
  fails — email is a best-effort extra alert.
- The free tier caps monthly sends (~200), which is ample here.
- To disable, blank out any of the three values in `EMAILJS_CONFIG`.
```

- [ ] **Step 2: Add a README note**

In `README.md`, add a short "Order notifications" line pointing to
`docs/EMAILJS_SETUP.md` and stating the feature is optional/off until configured.

- [ ] **Step 3: Commit**

```bash
git add docs/EMAILJS_SETUP.md README.md
git commit -m "docs: EmailJS setup guide for new-order notifications"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** pure params helper (Task 1); `EMAILJS_CONFIG` dormant-until-configured + guarded non-throwing `notifyNewOrder` + best-effort wiring after successful save (Task 2); abuse-protection + setup steps (Task 3). New-order-only trigger; recipients in template. ✓
- **Types consistent:** `orderEmailParams(order, restaurantName, sizes, flavourName, placedAt)` → object consumed as `template_params` by `notifyNewOrder`; the restaurant `onSend` passes the just-sent `{items, preferredDate, note}`, `A.myCustomer.name`, `A.state.settings.sizes`, `A.flavourName`, and a local time string. ✓
- **No placeholders.** Real code + exact commands throughout.

## Notes for the implementer

- Only `lib.js` is unit-tested (Task 1 TDD). Task 2 is glue verified in the browser (with config empty it must no-op cleanly); real email delivery is verified by the controller/human after the setup doc, once the three IDs are filled in.
- `notifyNewOrder` must never throw and is never awaited into the order UI.
- `new Date().toLocaleString()` runs in the browser (fine here — the `Date` restriction only applies to workflow scripts, not app code).
```
