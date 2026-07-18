# New-Delivery Prefill (last delivery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the admin New-delivery form, selecting a customer pre-fills the line items from that customer's most recent delivery.

**Architecture:** A pure tested `lastDeliveryItems(deliveries, customerId)` in `lib.js`; a new branch in the delivery-form `#cust` change handler that rebuilds the item rows from it (guarded to plain "new" mode).

**Tech Stack:** Vanilla HTML/CSS/JS (no build step), `node --test`, GitHub Pages. No Firebase/rules change.

## Global Constraints

- No build step; single `index.html` + `lib.js`. No deps.
- Pure logic in `lib.js` (UMD return object) with tests in `test/lib.test.js`; run `npm test`.
- The delivery-form view is a `DOMContentLoaded` IIFE reading `window.APP` (A)/`window.KO` (KO).
- Only the admin delivery-form is touched; restaurant view + other views untouched.

---

### Task 1: `lastDeliveryItems` helper in `lib.js`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

**Interfaces (produced):** `KO.lastDeliveryItems(deliveries, customerId)` → `{sizeId, flavourId, quantity}[]` of the newest (by `date`) delivery for that customer, or `[]`.

- [ ] **Step 1: Write the failing tests**

Append to `test/lib.test.js` (reuse the existing `DELIVS` fixture: A 2026-06-03 1L gin×2; A 2026-06-10 1L gin×2 + 270ml lem×10; B 2026-06-15 270ml gin×4; A 2026-07-01 1L gin×1):

```javascript
test("lastDeliveryItems returns the newest delivery's items for the customer", () => {
  assert.deepStrictEqual(KO.lastDeliveryItems(DELIVS, "A"),
    [{ sizeId: "1L", flavourId: "gin", quantity: 1 }]);           // A's newest = 2026-07-01
  assert.deepStrictEqual(KO.lastDeliveryItems(DELIVS, "B"),
    [{ sizeId: "270ml", flavourId: "gin", quantity: 4 }]);        // B's only = 2026-06-15
  assert.deepStrictEqual(KO.lastDeliveryItems(DELIVS, "Z"), []);  // unknown customer
  assert.deepStrictEqual(KO.lastDeliveryItems([], "A"), []);      // empty
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — Expected: FAIL (`KO.lastDeliveryItems is not a function`).

- [ ] **Step 3: Add the implementation**

In `lib.js`, add near the other order/delivery helpers (e.g. after `lastOrderItems`):

```javascript
  function lastDeliveryItems(deliveries, customerId) {
    const mine = (deliveries || []).filter(function (d) { return d && d.customerId === customerId; });
    if (!mine.length) return [];
    mine.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return (mine[0].items || []).map(function (it) {
      return { sizeId: it.sizeId, flavourId: it.flavourId, quantity: it.quantity };
    });
  }
```

- [ ] **Step 4: Export it**

Add `lastDeliveryItems` to the `return { ... }` object in `lib.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add lastDeliveryItems helper to lib.js"
```

---

### Task 2: Prefill the New-delivery form on customer change

**Files:**
- Modify: `index.html` — the delivery-form `#cust` change handler (in `buildForm`).

**Interfaces:** consumes `KO.lastDeliveryItems`; existing `A.state.deliveries`, `itemRow`, `itemsDiv`, `updateSubtotal`, `editing`, `fulfilling`, `A.addCustomer`, `refreshOptions`.

- [ ] **Step 1: Add the prefill branch to the `#cust` change handler**

The handler currently reads:

```javascript
      container.querySelector("#cust").addEventListener("change", async (e) => {
        if (e.target.value === "__new__") {
          const name = prompt("New customer name:");
          if (name && name.trim()) { const ref = await A.addCustomer(name.trim()); refreshOptions(); e.target.value = ref.id; }
          else e.target.value = "";
        }
      });
```

Replace it with (adds an `else if` that prefills from the customer's last delivery in plain new mode):

```javascript
      container.querySelector("#cust").addEventListener("change", async (e) => {
        if (e.target.value === "__new__") {
          const name = prompt("New customer name:");
          if (name && name.trim()) { const ref = await A.addCustomer(name.trim()); refreshOptions(); e.target.value = ref.id; }
          else e.target.value = "";
        } else if (e.target.value && !editing && !fulfilling) {
          const items = KO.lastDeliveryItems(A.state.deliveries, e.target.value);
          itemsDiv.innerHTML = "";
          if (items.length) items.forEach((it) => itemsDiv.appendChild(itemRow(it)));
          else itemsDiv.appendChild(itemRow());
          updateSubtotal();
        }
      });
```

(`editing`/`fulfilling` are the module-level flags; those flows set `#cust.value` programmatically — which does not fire `change` — and the guard is a second safeguard. `itemRow(it)` pre-selects size/flavour + qty; `itemRow()` = blank row.)

- [ ] **Step 2: Syntax-check + tests**

Run the inline-script syntax check (expected `classic blocks 8 errors 0`) and `npm test` (green — no lib change here):
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;while((m=re.exec(h))){const s=m[1];if(!s.trim()||/^\s*import\s/m.test(s))continue;i++;try{new Function(s)}catch(e){console.log("ERR",e.message);bad++}}console.log("classic blocks",i,"errors",bad)'
```

- [ ] **Step 3: Manual verification (browser)**

Run `python3 -m http.server 8000`, log in as admin, **New** tab. Pick a customer with a prior delivery → item lines pre-fill (size + flavour + qty), subtotal updates, editable/add/remove still work; pick a customer with no deliveries → one blank line; switching customer re-fills. **Edit** an existing delivery (Deliveries → Edit) and **Fulfil** an order (Orders → Fulfil…) still pre-fill from their own source (unaffected by this change). Saving works.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: prefill new-delivery lines from the customer's last delivery"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** `lastDeliveryItems` (Task 1); customer-change prefill in plain new mode, blank fallback, edit/fulfil unaffected (Task 2). ✓
- **Types consistent:** `lastDeliveryItems(deliveries, customerId)` → `{sizeId,flavourId,quantity}[]` consumed by `itemRow(it)`. ✓
- **No placeholders.** Full code + commands throughout.

## Notes for the implementer

- Only `lib.js` is unit-tested (Task 1 TDD). Task 2 is browser-verified.
- Do not touch `A.editDelivery` / `A.fulfilOrder` — they set their own items; the guard `!editing && !fulfilling` keeps the prefill from interfering.
- `itemRow()` with no arg must stay a blank row (Add-line button relies on it).
```
