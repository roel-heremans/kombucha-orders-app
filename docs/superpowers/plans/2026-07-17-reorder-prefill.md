# Reorder Prefill (last order) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-fill the restaurant New-order form with the line items (size + flavour + quantity) of the restaurant's most recent non-cancelled order.

**Architecture:** A pure tested `lastOrderItems(orders, customerUid)` in `lib.js`; the restaurant view's row builders gain an optional pre-selected item, and `render()` builds the order lines from `lastOrderItems`.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step), `node --test`, GitHub Pages. No Firebase/rules/schema change.

## Global Constraints

- No build step; single `index.html` + `lib.js`. No deps.
- Pure logic in `lib.js` (UMD return object) with tests in `test/lib.test.js`; run `npm test`.
- Restaurant view is a `DOMContentLoaded` IIFE reading `window.APP` (A) and `window.KO` (KO); UI strings go through the IIFE-local `T(...)` translator (do not hardcode English).
- Data values interpolated into innerHTML stay escaped with `A.esc(...)`.
- Only the restaurant New-order form changes; admin views untouched.

---

### Task 1: `lastOrderItems` helper in `lib.js`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

**Interfaces (produced):** `KO.lastOrderItems(orders, customerUid)` → array of
`{ sizeId, flavourId, quantity }` from the newest non-cancelled order for that
uid (by `createdAt.seconds` desc), or `[]` if none.

- [ ] **Step 1: Write the failing tests**

Append to `test/lib.test.js`:

```javascript
const ORDERS = [
  { customerUid: "U1", status: "cancelled", createdAt: { seconds: 300 },
    items: [{ sizeId: "1L", flavourId: "gin", quantity: 9 }] },
  { customerUid: "U1", status: "delivered", createdAt: { seconds: 200 },
    items: [{ sizeId: "1L", flavourId: "gin", quantity: 8 },
            { sizeId: "270ml", flavourId: "hib", quantity: 6 }] },
  { customerUid: "U1", status: "requested", createdAt: { seconds: 100 },
    items: [{ sizeId: "1L", flavourId: "lem", quantity: 2 }] },
  { customerUid: "U2", status: "delivered", createdAt: { seconds: 250 },
    items: [{ sizeId: "1L", flavourId: "gin", quantity: 99 }] },
];

test("lastOrderItems returns the newest non-cancelled order's items for the uid", () => {
  assert.deepStrictEqual(KO.lastOrderItems(ORDERS, "U1"), [
    { sizeId: "1L", flavourId: "gin", quantity: 8 },
    { sizeId: "270ml", flavourId: "hib", quantity: 6 },
  ]);
});

test("lastOrderItems returns [] for unknown uid, only-cancelled, or empty", () => {
  assert.deepStrictEqual(KO.lastOrderItems(ORDERS, "U3"), []);
  assert.deepStrictEqual(KO.lastOrderItems(
    [{ customerUid: "U1", status: "cancelled", createdAt: { seconds: 5 },
       items: [{ sizeId: "1L", flavourId: "x", quantity: 1 }] }], "U1"), []);
  assert.deepStrictEqual(KO.lastOrderItems([], "U1"), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — Expected: FAIL (`KO.lastOrderItems is not a function`).

- [ ] **Step 3: Add the implementation**

In `lib.js`, add near the other order helpers (e.g. after `orderEmailParams`):

```javascript
  function lastOrderItems(orders, customerUid) {
    const mine = (orders || []).filter(function (o) {
      return o && o.customerUid === customerUid && o.status !== "cancelled";
    }).slice().sort(function (a, b) {
      const ta = (a.createdAt && a.createdAt.seconds) || 0;
      const tb = (b.createdAt && b.createdAt.seconds) || 0;
      return tb - ta;
    });
    if (!mine.length) return [];
    return (mine[0].items || []).map(function (it) {
      return { sizeId: it.sizeId, flavourId: it.flavourId, quantity: it.quantity };
    });
  }
```

- [ ] **Step 4: Export it**

Add `lastOrderItems` to the `return { ... }` object in `lib.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add lastOrderItems helper to lib.js"
```

---

### Task 2: Pre-fill the restaurant New-order form

**Files:**
- Modify: `index.html` — restaurant view IIFE: `sizeOptions`/`flavourOptions`/`itemRowHtml` gain an optional pre-selected item; `render()` builds `#orderItems` from `KO.lastOrderItems`.

**Interfaces:** consumes `KO.lastOrderItems`; existing `A.state.orders`, `A.user`, `T`, `A.esc`.

- [ ] **Step 1: Add a `selected` arg to `sizeOptions` and `flavourOptions`**

Replace the two functions:

```javascript
    function sizeOptions(selected) {
      return (A.state.settings ? A.state.settings.sizes : [])
        .map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${A.esc(s.label)}</option>`).join("");
    }
    function flavourOptions(selected) {
      return `<option value="" ${!selected ? "selected" : ""}>${T("choose_flavour")}</option>` +
        A.state.flavours.slice().sort((a, b) => a.name.localeCompare(b.name))
          .map((f) => `<option value="${f.id}" ${f.id === selected ? "selected" : ""}>${A.esc(f.name)}</option>`).join("");
    }
```

- [ ] **Step 2: Make `itemRowHtml` accept an optional item**

Replace `itemRowHtml`:

```javascript
    function itemRowHtml(item) {
      item = item || {};
      const qty = item.quantity != null ? item.quantity : 1;
      return `<div class="row order-item">` +
        `<div><label>${T("size")}</label><select class="oi-size">${sizeOptions(item.sizeId)}</select></div>` +
        `<div><label>${T("flavour")}</label><select class="oi-flav">${flavourOptions(item.flavourId)}</select></div>` +
        `<div style="flex:0 0 64px"><label>${T("qty")}</label><input class="oi-qty" type="number" min="1" value="${qty}"/></div>` +
        `<button class="link oi-del" style="flex:0 0 32px">✕</button></div>`;
    }
```

(The "Add line" handler calls `itemRowHtml()` with no arg → a blank row, unchanged.)

- [ ] **Step 3: Build `#orderItems` from the last order**

In `render()`, just before the `body.innerHTML = …` assignment (alongside the other computed locals like `all`, `hidden`), add:

```javascript
      const prefill = KO.lastOrderItems(A.state.orders, A.user && A.user.uid);
      const itemsInit = (prefill.length ? prefill.map(itemRowHtml) : [itemRowHtml()]).join("");
```

Then change the New-order card's items div from:

```javascript
          `<div id="orderItems">${itemRowHtml()}</div>` +
```

to:

```javascript
          `<div id="orderItems">${itemsInit}</div>` +
```

- [ ] **Step 4: Syntax-check + tests**

Run the inline-script syntax check (expected `classic blocks 8 errors 0`) and `npm test` (green — no lib change here):
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;while((m=re.exec(h))){const s=m[1];if(!s.trim()||/^\s*import\s/m.test(s))continue;i++;try{new Function(s)}catch(e){console.log("ERR",e.message);bad++}}console.log("classic blocks",i,"errors",bad)'
```

- [ ] **Step 5: Manual verification (browser)**

Run `python3 -m http.server 8000`, log in as a **restaurant** (incognito) that has a prior **non-cancelled** order. The New-order form opens **pre-filled** with that order's lines (size + flavour + quantity), editable; add/remove line and send still work; EN/PT toggle still fine. A restaurant with **no orders or only cancelled** ones sees a single blank line. If a pre-filled flavour was deleted, that line shows the "choose flavour" placeholder. Placing an order still works.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: pre-fill restaurant new-order form from last non-cancelled order"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** `lastOrderItems` (Task 1); prefill of the New-order form from the last non-cancelled order, items only, blank fallback, deleted-flavour graceful (Task 2). ✓
- **Types consistent:** `lastOrderItems(orders, customerUid)` returns `{sizeId,flavourId,quantity}[]` consumed by `itemRowHtml(item)` via `sizeOptions(item.sizeId)`/`flavourOptions(item.flavourId)`. ✓
- **No placeholders.** Full code + commands throughout.

## Notes for the implementer

- Only `lib.js` is unit-tested (Task 1 TDD). Task 2 is browser-verified.
- Keep every restaurant string through `T(...)`; don't reintroduce hardcoded English while editing the row builders.
- `itemRowHtml()` with no arg must still yield a blank row (the Add-line button relies on it).
```
