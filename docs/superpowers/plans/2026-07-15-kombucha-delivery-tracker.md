# Kombucha Delivery Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a phone-friendly web app to record kombucha deliveries, view monthly revenue and outstanding-bottle stats, and generate Portuguese *recibo verde* description text — with data shared between two phones via Firebase.

**Architecture:** A static web app hosted on GitHub Pages. All pure logic (money math, monthly aggregation, outstanding bottles, recibo text, chart SVG) lives in `lib.js`, which is loaded by `index.html` via a `<script>` tag and unit-tested in Node with the built-in test runner. `index.html` holds the UI, Firebase initialisation, auth, and the Firestore data layer. No build step; deploy = push static files.

**Tech Stack:** Vanilla HTML/CSS/JS, Firebase v10 modular SDK (Auth + Firestore) loaded from the gstatic CDN, hand-rolled inline SVG charts, Node ≥18 built-in test runner (`node --test`).

## Global Constraints

- **No build step.** Deploy artifact is static files (`index.html`, `lib.js`) served by GitHub Pages.
- **`lib.js` must run in both the browser and Node.** Use a UMD-style wrapper: `module.exports` when `module` is defined, else attach to `self.KO`.
- **Pure logic only in `lib.js`** — no DOM, no Firebase, no `Date.now()` inside formatting/aggregation functions (pass dates in as `"YYYY-MM-DD"` strings).
- **Money:** sizes default to `1 L` = €8.00 sale / €0.00 deposit, and `270 ml` = €4.50 sale / €1.00 deposit. Prices/deposits are editable in Settings. All money formatted with two decimals and a dot (e.g. `16.00`).
- **Revenue = product sales only** (Σ qty × sale price). **Recibo total = revenue − deposit refunds.** Deposits never count as revenue on the dashboard.
- **Recibo compact size label** = the size's `label` with all spaces removed (`"1 L"` → `"1L"`, `"270 ml"` → `"270ml"`).
- **Recibo month names are English** (`June`, not `Junho`).
- **Auth:** Firebase Email/Password, two accounts, no in-app sign-up. Firestore security rules restrict access to an email allowlist.
- **Firestore layout:** collections `customers`, `flavours`, `deliveries`; single settings document at `settings/app`.
- Node ≥18 required for tests (`node --test`, `node:test`, `node:assert`).

---

## File Structure

- `lib.js` — all pure functions (format, aggregation, recibo, chart SVG). Browser + Node compatible.
- `test/lib.test.js` — `node --test` unit tests for `lib.js`.
- `index.html` — app shell, CSS, Firebase init, auth, Firestore data layer, all views.
- `firestore.rules` — Firestore security rules (email allowlist).
- `docs/FIREBASE_SETUP.md` — one-time Firebase project setup guide.
- `package.json` — declares the test script; no dependencies.
- `README.md` — update with run/setup/deploy instructions (already scaffolded).

---

## Task 1: Test tooling + `lib.js` UMD skeleton + `formatMoney`

**Files:**
- Create: `package.json`
- Create: `lib.js`
- Create: `test/lib.test.js`

**Interfaces:**
- Produces: `formatMoney(n: number) -> string` (two decimals, dot). The UMD wrapper exposes the module as `module.exports` in Node and `self.KO` in the browser.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "kombucha-orders-app",
  "version": "1.0.0",
  "description": "Kombucha delivery tracker",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `lib.js` with the UMD wrapper and `formatMoney`**

```js
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KO = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function formatMoney(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  return { formatMoney };
});
```

- [ ] **Step 3: Write the failing test in `test/lib.test.js`**

```js
const { test } = require("node:test");
const assert = require("node:assert");
const KO = require("../lib.js");

test("formatMoney formats to two decimals", () => {
  assert.strictEqual(KO.formatMoney(16), "16.00");
  assert.strictEqual(KO.formatMoney(4.5), "4.50");
  assert.strictEqual(KO.formatMoney(0), "0.00");
  assert.strictEqual(KO.formatMoney(86), "86.00");
});
```

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add package.json lib.js test/lib.test.js
git commit -m "feat: add lib.js skeleton, test tooling, and formatMoney"
```

---

## Task 2: Core per-delivery money calcs

**Files:**
- Modify: `lib.js`
- Modify: `test/lib.test.js`

**Interfaces:**
- Consumes: `formatMoney`.
- Produces:
  - `sizeById(sizes, sizeId) -> size | undefined`
  - `deliveryRevenue(delivery, sizes) -> number` — Σ over `delivery.items` of `qty × size.price`.
  - `deliveryDepositRefund(delivery, sizes) -> number` — Σ over `delivery.empties` of `qty × size.deposit`.
- Data shapes: `size = {id, label, price, deposit}`; `delivery = {id, customerId, date, items:[{sizeId, flavourId, quantity}], empties:[{sizeId, quantity}], note, enteredBy}`.

- [ ] **Step 1: Write failing tests**

Add to `test/lib.test.js`:

```js
const SIZES = [
  { id: "1L", label: "1 L", price: 8, deposit: 0 },
  { id: "270ml", label: "270 ml", price: 4.5, deposit: 1 },
];

test("sizeById finds a size or returns undefined", () => {
  assert.strictEqual(KO.sizeById(SIZES, "1L").price, 8);
  assert.strictEqual(KO.sizeById(SIZES, "nope"), undefined);
});

test("deliveryRevenue sums qty x price", () => {
  const d = {
    items: [
      { sizeId: "1L", flavourId: "f1", quantity: 2 },
      { sizeId: "270ml", flavourId: "f2", quantity: 10 },
    ],
    empties: [],
  };
  assert.strictEqual(KO.deliveryRevenue(d, SIZES), 61); // 2*8 + 10*4.5
});

test("deliveryDepositRefund sums qty x deposit", () => {
  const d = { items: [], empties: [{ sizeId: "270ml", quantity: 7 }, { sizeId: "1L", quantity: 3 }] };
  assert.strictEqual(KO.deliveryDepositRefund(d, SIZES), 7); // 7*1 + 3*0
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL ("KO.sizeById is not a function").

- [ ] **Step 3: Implement in `lib.js`** (inside the factory, before `return`)

```js
  function sizeById(sizes, sizeId) {
    return sizes.find(function (s) { return s.id === sizeId; });
  }

  function deliveryRevenue(delivery, sizes) {
    return (delivery.items || []).reduce(function (sum, it) {
      const s = sizeById(sizes, it.sizeId);
      return sum + (s ? s.price * it.quantity : 0);
    }, 0);
  }

  function deliveryDepositRefund(delivery, sizes) {
    return (delivery.empties || []).reduce(function (sum, e) {
      const s = sizeById(sizes, e.sizeId);
      return sum + (s ? s.deposit * e.quantity : 0);
    }, 0);
  }
```

Update the `return` object to include `sizeById, deliveryRevenue, deliveryDepositRefund`.

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add per-delivery revenue and deposit-refund calcs"
```

---

## Task 3: Date / month helpers

**Files:**
- Modify: `lib.js`
- Modify: `test/lib.test.js`

**Interfaces:**
- Produces:
  - `monthKey(dateStr) -> "YYYY-MM"` from `"YYYY-MM-DD"`.
  - `inMonth(dateStr, mk) -> boolean`.
  - `monthName(mk) -> string` (English full month name, e.g. `"June"`).
  - `dayOfMonth(dateStr) -> number` (no leading zero, e.g. `3`).
  - `recentMonthKeys(endMk, n) -> string[]` — `n` month keys ending at `endMk` inclusive, oldest first.

- [ ] **Step 1: Write failing tests**

```js
test("monthKey / inMonth / dayOfMonth", () => {
  assert.strictEqual(KO.monthKey("2026-06-03"), "2026-06");
  assert.strictEqual(KO.inMonth("2026-06-03", "2026-06"), true);
  assert.strictEqual(KO.inMonth("2026-07-01", "2026-06"), false);
  assert.strictEqual(KO.dayOfMonth("2026-06-03"), 3);
});

test("monthName is English", () => {
  assert.strictEqual(KO.monthName("2026-06"), "June");
  assert.strictEqual(KO.monthName("2026-01"), "January");
});

test("recentMonthKeys returns n keys oldest-first ending at endMk", () => {
  assert.deepStrictEqual(KO.recentMonthKeys("2026-02", 4), [
    "2025-11", "2025-12", "2026-01", "2026-02",
  ]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL.

- [ ] **Step 3: Implement in `lib.js`**

```js
  const MONTH_NAMES = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];

  function monthKey(dateStr) { return dateStr.slice(0, 7); }

  function inMonth(dateStr, mk) { return monthKey(dateStr) === mk; }

  function monthName(mk) { return MONTH_NAMES[parseInt(mk.slice(5, 7), 10) - 1]; }

  function dayOfMonth(dateStr) { return parseInt(dateStr.slice(8, 10), 10); }

  function recentMonthKeys(endMk, n) {
    let year = parseInt(endMk.slice(0, 4), 10);
    let month = parseInt(endMk.slice(5, 7), 10); // 1-12
    const keys = [];
    for (let i = 0; i < n; i++) {
      const mm = String(month).padStart(2, "0");
      keys.unshift(year + "-" + mm);
      month--;
      if (month === 0) { month = 12; year--; }
    }
    return keys;
  }
```

Add all five to the `return` object.

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add date/month helper functions"
```

---

## Task 4: Monthly aggregations

**Files:**
- Modify: `lib.js`
- Modify: `test/lib.test.js`

**Interfaces:**
- Consumes: `deliveryRevenue`, `inMonth`, `monthKey`.
- Produces:
  - `monthlyRevenue(deliveries, sizes, mk) -> number`.
  - `revenueByCustomer(deliveries, sizes, mk) -> [{customerId, amount}]` sorted by amount desc.
  - `monthlyRevenueSeries(deliveries, sizes, monthKeys) -> [{monthKey, amount}]` (one entry per key, in the given order).
  - `flavourCounts(deliveries, mk) -> [{flavourId, quantity}]` sorted by quantity desc.

- [ ] **Step 1: Write failing tests**

```js
const DELIVS = [
  { customerId: "A", date: "2026-06-03",
    items: [{ sizeId: "1L", flavourId: "gin", quantity: 2 }], empties: [] },
  { customerId: "A", date: "2026-06-10",
    items: [{ sizeId: "1L", flavourId: "gin", quantity: 2 },
            { sizeId: "270ml", flavourId: "lem", quantity: 10 }], empties: [] },
  { customerId: "B", date: "2026-06-15",
    items: [{ sizeId: "270ml", flavourId: "gin", quantity: 4 }], empties: [] },
  { customerId: "A", date: "2026-07-01",
    items: [{ sizeId: "1L", flavourId: "gin", quantity: 1 }], empties: [] },
];

test("monthlyRevenue sums only the month", () => {
  assert.strictEqual(KO.monthlyRevenue(DELIVS, SIZES, "2026-06"), 16 + 61 + 18);
});

test("revenueByCustomer sorted desc", () => {
  assert.deepStrictEqual(KO.revenueByCustomer(DELIVS, SIZES, "2026-06"), [
    { customerId: "A", amount: 77 },
    { customerId: "B", amount: 18 },
  ]);
});

test("monthlyRevenueSeries follows the key order", () => {
  assert.deepStrictEqual(
    KO.monthlyRevenueSeries(DELIVS, SIZES, ["2026-05", "2026-06", "2026-07"]),
    [{ monthKey: "2026-05", amount: 0 },
     { monthKey: "2026-06", amount: 95 },
     { monthKey: "2026-07", amount: 8 }]
  );
});

test("flavourCounts sorted desc", () => {
  assert.deepStrictEqual(KO.flavourCounts(DELIVS, "2026-06"), [
    { flavourId: "lem", quantity: 10 },
    { flavourId: "gin", quantity: 6 },
  ]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL.

- [ ] **Step 3: Implement in `lib.js`**

```js
  function monthlyRevenue(deliveries, sizes, mk) {
    return deliveries.reduce(function (sum, d) {
      return inMonth(d.date, mk) ? sum + deliveryRevenue(d, sizes) : sum;
    }, 0);
  }

  function revenueByCustomer(deliveries, sizes, mk) {
    const byId = {};
    deliveries.forEach(function (d) {
      if (!inMonth(d.date, mk)) return;
      byId[d.customerId] = (byId[d.customerId] || 0) + deliveryRevenue(d, sizes);
    });
    return Object.keys(byId)
      .map(function (id) { return { customerId: id, amount: byId[id] }; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  function monthlyRevenueSeries(deliveries, sizes, monthKeys) {
    return monthKeys.map(function (mk) {
      return { monthKey: mk, amount: monthlyRevenue(deliveries, sizes, mk) };
    });
  }

  function flavourCounts(deliveries, mk) {
    const byId = {};
    deliveries.forEach(function (d) {
      if (!inMonth(d.date, mk)) return;
      (d.items || []).forEach(function (it) {
        byId[it.flavourId] = (byId[it.flavourId] || 0) + it.quantity;
      });
    });
    return Object.keys(byId)
      .map(function (id) { return { flavourId: id, quantity: byId[id] }; })
      .sort(function (a, b) { return b.quantity - a.quantity; });
  }
```

Add all four to `return`.

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add monthly aggregation functions"
```

---

## Task 5: Outstanding bottles & deposit held

**Files:**
- Modify: `lib.js`
- Modify: `test/lib.test.js`

**Interfaces:**
- Consumes: `sizeById`.
- Produces: `outstandingByCustomer(deliveries, sizes) -> [{customerId, perSize:{sizeId:number}, depositHeld:number}]` sorted by `customerId` ascending. `perSize[sizeId]` = Σ delivered − Σ returned across all that customer's deliveries (may be 0; omit sizes that net to 0). `depositHeld` = Σ over sizes of `perSize × size.deposit`.

- [ ] **Step 1: Write failing test**

```js
test("outstandingByCustomer nets delivered minus returned per size", () => {
  const ds = [
    { customerId: "A", date: "2026-06-03",
      items: [{ sizeId: "270ml", flavourId: "x", quantity: 10 },
              { sizeId: "1L", flavourId: "y", quantity: 2 }],
      empties: [{ sizeId: "270ml", quantity: 7 }] },
    { customerId: "A", date: "2026-06-10",
      items: [], empties: [{ sizeId: "1L", quantity: 2 }] },
  ];
  assert.deepStrictEqual(KO.outstandingByCustomer(ds, SIZES), [
    { customerId: "A", perSize: { "270ml": 3 }, depositHeld: 3 },
  ]); // 270ml: 10-7=3 (deposit 3); 1L: 2-2=0 omitted
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL.

- [ ] **Step 3: Implement in `lib.js`**

```js
  function outstandingByCustomer(deliveries, sizes) {
    const byCust = {};
    deliveries.forEach(function (d) {
      const per = byCust[d.customerId] || (byCust[d.customerId] = {});
      (d.items || []).forEach(function (it) {
        per[it.sizeId] = (per[it.sizeId] || 0) + it.quantity;
      });
      (d.empties || []).forEach(function (e) {
        per[e.sizeId] = (per[e.sizeId] || 0) - e.quantity;
      });
    });
    return Object.keys(byCust).sort().map(function (cid) {
      const perRaw = byCust[cid];
      const perSize = {};
      let depositHeld = 0;
      Object.keys(perRaw).forEach(function (sid) {
        const net = perRaw[sid];
        if (net === 0) return;
        perSize[sid] = net;
        const s = sizeById(sizes, sid);
        if (s) depositHeld += net * s.deposit;
      });
      return { customerId: cid, perSize: perSize, depositHeld: depositHeld };
    });
  }
```

Add `outstandingByCustomer` to `return`.

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add outstanding-bottles and deposit-held calc"
```

---

## Task 6: Recibo Verde text generator

**Files:**
- Modify: `lib.js`
- Modify: `test/lib.test.js`

**Interfaces:**
- Consumes: `formatMoney`, `sizeById`, `inMonth`, `monthName`, `dayOfMonth`, `deliveryRevenue`.
- Produces:
  - `reciboSizeLabel(size) -> string` — `size.label` with spaces removed.
  - `generateRecibo(deliveries, customerId, mk, sizes, header) -> string`.

**Format rules (must match exactly):**
1. Line 1 = `header`; line 2 = blank.
2. One line per delivery **date** (in that month, that customer) that has delivered bottles, ascending by date. Content: for each size (in `sizes` order) with delivered qty > 0, `"<qty>x <compactLabel>"` joined by `" + "`; then `" = <subtotal>"` where subtotal = that delivery's revenue. The date label `"<MonthName> <day>:"` is left-padded with spaces to the width of the longest date label among delivery lines, then one space separator.
3. Then one line per delivery **date** that returned bottles of a **deposit-bearing** size (deposit > 0), ascending by date: `"Return <MonthName> <day>: <qty>x <compactLabel> = -<refund>"` (single space after colon, no padding). Multiple deposit sizes on one date join with `" + "` and refund is the summed money.
4. Separator line of `-` characters, length = the longest line produced so far (delivery + return + the Total line).
5. Final line `"Total: <total> Euro"` where total = Σ delivery revenues − Σ deposit refunds.
6. If the customer has no deliveries in the month, output = `header`, blank line, then `"Total: 0.00 Euro"`.

- [ ] **Step 1: Write failing test (canonical €86 example)**

```js
test("generateRecibo matches the June example exactly", () => {
  const ds = [
    { customerId: "C", date: "2026-06-03",
      items: [{ sizeId: "1L", flavourId: "a", quantity: 2 }],
      empties: [{ sizeId: "270ml", quantity: 7 }] },
    { customerId: "C", date: "2026-06-10",
      items: [{ sizeId: "1L", flavourId: "a", quantity: 2 },
              { sizeId: "270ml", flavourId: "b", quantity: 10 }],
      empties: [] },
    { customerId: "C", date: "2026-06-24",
      items: [{ sizeId: "1L", flavourId: "a", quantity: 2 }], empties: [] },
    { customerId: "OTHER", date: "2026-06-05",
      items: [{ sizeId: "1L", flavourId: "a", quantity: 99 }], empties: [] },
  ];
  const expected = [
    "OUT - Kombucha Produto",
    "",
    "June 3:  2x 1L = 16.00",
    "June 10: 2x 1L + 10x 270ml = 61.00",
    "June 24: 2x 1L = 16.00",
    "Return June 3: 7x 270ml = -7.00",
    "----------------------------------",
    "Total: 86.00 Euro",
  ].join("\n");
  assert.strictEqual(
    KO.generateRecibo(ds, "C", "2026-06", SIZES, "OUT - Kombucha Produto"),
    expected
  );
});

test("generateRecibo with no deliveries", () => {
  assert.strictEqual(
    KO.generateRecibo([], "C", "2026-06", SIZES, "OUT - Kombucha Produto"),
    "OUT - Kombucha Produto\n\nTotal: 0.00 Euro"
  );
});
```

Note: the separator above is 34 dashes (length of `"June 10: 2x 1L + 10x 270ml = 61.00"`). Verify by counting when implementing.

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL.

- [ ] **Step 3: Implement in `lib.js`**

```js
  function reciboSizeLabel(size) {
    return size.label.replace(/\s+/g, "");
  }

  function generateRecibo(deliveries, customerId, mk, sizes, header) {
    const mine = deliveries
      .filter(function (d) { return d.customerId === customerId && inMonth(d.date, mk); })
      .slice()
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    const deliveryLines = [];
    const labelParts = []; // {label, content, subtotal}
    let total = 0;

    mine.forEach(function (d) {
      const parts = [];
      sizes.forEach(function (s) {
        const qty = (d.items || []).reduce(function (sum, it) {
          return it.sizeId === s.id ? sum + it.quantity : sum;
        }, 0);
        if (qty > 0) parts.push(qty + "x " + reciboSizeLabel(s));
      });
      if (parts.length === 0) return;
      const subtotal = deliveryRevenue(d, sizes);
      total += subtotal;
      labelParts.push({
        label: monthName(mk) + " " + dayOfMonth(d.date) + ":",
        content: parts.join(" + ") + " = " + formatMoney(subtotal),
      });
    });

    const labelWidth = labelParts.reduce(function (w, p) {
      return Math.max(w, p.label.length);
    }, 0);
    labelParts.forEach(function (p) {
      deliveryLines.push(p.label.padEnd(labelWidth, " ") + " " + p.content);
    });

    const returnLines = [];
    mine.forEach(function (d) {
      const parts = [];
      let refund = 0;
      sizes.forEach(function (s) {
        if (s.deposit <= 0) return;
        const qty = (d.empties || []).reduce(function (sum, e) {
          return e.sizeId === s.id ? sum + e.quantity : sum;
        }, 0);
        if (qty > 0) { parts.push(qty + "x " + reciboSizeLabel(s)); refund += qty * s.deposit; }
      });
      if (parts.length === 0) return;
      total -= refund;
      returnLines.push("Return " + monthName(mk) + " " + dayOfMonth(d.date) + ": " +
        parts.join(" + ") + " = -" + formatMoney(refund));
    });

    const totalLine = "Total: " + formatMoney(total) + " Euro";
    const body = deliveryLines.concat(returnLines);
    if (body.length === 0) return header + "\n\n" + totalLine;

    const longest = body.concat([totalLine]).reduce(function (w, l) {
      return Math.max(w, l.length);
    }, 0);
    const separator = "-".repeat(longest);

    return [header, ""].concat(body).concat([separator, totalLine]).join("\n");
  }
```

Add `reciboSizeLabel, generateRecibo` to `return`.

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: PASS. If the separator length assertion fails, count the characters of the longest line and adjust the expected dashes in the test to match the implementation (the rule, not the count, is authoritative).

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add recibo verde text generator"
```

---

## Task 7: Bar chart SVG builder

**Files:**
- Modify: `lib.js`
- Modify: `test/lib.test.js`

**Interfaces:**
- Produces: `barChartSVG(data, opts) -> string` where `data = [{label, value}]` and `opts = {width, height, color}` (all optional; defaults `width=320, height=160, color="#4a7c59"`). Returns an `<svg>...</svg>` string with one `<rect>` per bar, bar heights proportional to `value / maxValue`, plus each bar's `label` in a `<text>`. Empty data → an `<svg>` with no `<rect>`.

- [ ] **Step 1: Write failing test**

```js
test("barChartSVG renders one rect per datum", () => {
  const svg = KO.barChartSVG([{ label: "Jun", value: 10 }, { label: "Jul", value: 5 }]);
  assert.ok(svg.startsWith("<svg"));
  assert.strictEqual((svg.match(/<rect/g) || []).length, 2);
  assert.ok(svg.includes("Jun"));
  assert.ok(svg.includes("Jul"));
});

test("barChartSVG handles empty data", () => {
  const svg = KO.barChartSVG([]);
  assert.ok(svg.startsWith("<svg"));
  assert.strictEqual((svg.match(/<rect/g) || []).length, 0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL.

- [ ] **Step 3: Implement in `lib.js`**

```js
  function escapeXml(s) {
    return String(s).replace(/[<>&'"]/g, function (c) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c];
    });
  }

  function barChartSVG(data, opts) {
    opts = opts || {};
    const width = opts.width || 320;
    const height = opts.height || 160;
    const color = opts.color || "#4a7c59";
    const pad = 24;
    const chartH = height - pad * 2;
    const max = data.reduce(function (m, d) { return Math.max(m, d.value); }, 0) || 1;
    const n = data.length;
    const slot = n > 0 ? (width - pad * 2) / n : 0;
    const barW = slot * 0.6;
    let bars = "";
    data.forEach(function (d, i) {
      const h = (d.value / max) * chartH;
      const x = pad + slot * i + (slot - barW) / 2;
      const y = pad + (chartH - h);
      bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) +
        '" fill="' + color + '"/>';
      bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (height - 6) +
        '" font-size="9" text-anchor="middle" fill="currentColor">' +
        escapeXml(d.label) + "</text>";
    });
    return '<svg viewBox="0 0 ' + width + " " + height +
      '" width="100%" role="img">' + bars + "</svg>";
  }
```

Add `barChartSVG` to `return`.

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add bar chart SVG builder"
```

---

## Task 8: `index.html` shell + Firebase init + auth (login/logout)

**Files:**
- Create: `index.html`

**Interfaces:**
- Consumes: `lib.js` (loaded via `<script src="lib.js">`, available as `window.KO`).
- Produces: a running app shell that shows a **Login** view until authenticated, then an empty **app** view with a top nav (New, Deliveries, Dashboard, Recibo, Settings) and a logout control. Firebase `db` and `auth` are initialised with offline persistence. A placeholder config object `FIREBASE_CONFIG` is present with `TODO` values (real values added during Firebase setup, Task 15 / FIREBASE_SETUP.md).

- [ ] **Step 1: Create `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Kombucha Orders</title>
  <style>
    :root { --green:#4a7c59; --bg:#faf9f6; --card:#fff; --line:#e3e1da; --text:#222; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:-apple-system,system-ui,sans-serif; background:var(--bg); color:var(--text); }
    header { background:var(--green); color:#fff; padding:12px 16px; font-weight:600; }
    nav { display:flex; overflow-x:auto; background:var(--card); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:5; }
    nav button { flex:1 0 auto; border:none; background:none; padding:12px 14px; font-size:14px; color:var(--text); }
    nav button.active { color:var(--green); border-bottom:2px solid var(--green); font-weight:600; }
    main { padding:16px; max-width:640px; margin:0 auto; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px; margin-bottom:14px; }
    label { display:block; font-size:13px; margin:8px 0 4px; color:#555; }
    input, select, textarea { width:100%; padding:10px; font-size:16px; border:1px solid var(--line); border-radius:8px; background:#fff; }
    button.primary { background:var(--green); color:#fff; border:none; padding:12px; border-radius:8px; font-size:16px; width:100%; }
    button.link { background:none; border:none; color:var(--green); padding:6px 0; font-size:14px; }
    .row { display:flex; gap:8px; align-items:flex-end; }
    .row > * { flex:1; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { text-align:left; padding:6px; border-bottom:1px solid var(--line); }
    .muted { color:#888; font-size:13px; }
    .hidden { display:none; }
    pre { white-space:pre-wrap; background:#f4f3ee; padding:12px; border-radius:8px; font-size:13px; overflow-x:auto; }
    .banner { background:#fff3cd; color:#7a5b00; padding:8px 16px; font-size:13px; text-align:center; }
  </style>
</head>
<body>
  <header>🍶 Kombucha Orders</header>
  <div id="offlineBanner" class="banner hidden">Offline — changes will sync when back online</div>

  <!-- Login view -->
  <main id="loginView">
    <div class="card">
      <h3>Log in</h3>
      <label>Email</label>
      <input id="loginEmail" type="email" autocomplete="username" />
      <label>Password</label>
      <input id="loginPassword" type="password" autocomplete="current-password" />
      <p id="loginError" class="muted"></p>
      <button class="primary" id="loginBtn">Log in</button>
    </div>
  </main>

  <!-- App view -->
  <div id="appView" class="hidden">
    <nav>
      <button data-view="new" class="active">New</button>
      <button data-view="deliveries">Deliveries</button>
      <button data-view="dashboard">Dashboard</button>
      <button data-view="recibo">Recibo</button>
      <button data-view="settings">Settings</button>
    </nav>
    <main>
      <div id="view-new" class="view"></div>
      <div id="view-deliveries" class="view hidden"></div>
      <div id="view-dashboard" class="view hidden"></div>
      <div id="view-recibo" class="view hidden"></div>
      <div id="view-settings" class="view hidden"></div>
    </main>
  </div>

  <script src="lib.js"></script>
  <script type="module">
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut }
      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
    import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager }
      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

    // Replace with your Firebase web app config (see docs/FIREBASE_SETUP.md)
    const FIREBASE_CONFIG = {
      apiKey: "TODO", authDomain: "TODO", projectId: "TODO",
      storageBucket: "TODO", messagingSenderId: "TODO", appId: "TODO",
    };

    const app = initializeApp(FIREBASE_CONFIG);
    const auth = getAuth(app);
    const db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });

    // Expose to later-task code via a single namespace.
    window.APP = { app, auth, db, state: { customers: [], flavours: [], deliveries: [], settings: null }, current: {} };

    // Online/offline banner
    const banner = document.getElementById("offlineBanner");
    window.addEventListener("online", () => banner.classList.add("hidden"));
    window.addEventListener("offline", () => banner.classList.remove("hidden"));
    if (!navigator.onLine) banner.classList.remove("hidden");

    // Auth wiring
    const loginView = document.getElementById("loginView");
    const appView = document.getElementById("appView");
    document.getElementById("loginBtn").addEventListener("click", async () => {
      const email = document.getElementById("loginEmail").value.trim();
      const pw = document.getElementById("loginPassword").value;
      document.getElementById("loginError").textContent = "";
      try { await signInWithEmailAndPassword(auth, email, pw); }
      catch (e) { document.getElementById("loginError").textContent = "Login failed: " + e.code; }
    });

    window.APP.logout = () => signOut(auth);

    onAuthStateChanged(auth, (user) => {
      if (user) {
        window.APP.user = user;
        loginView.classList.add("hidden");
        appView.classList.remove("hidden");
        if (window.APP.onLogin) window.APP.onLogin(); // data layer subscribes (Task 9)
      } else {
        loginView.classList.remove("hidden");
        appView.classList.add("hidden");
      }
    });

    // Nav switching
    document.querySelectorAll("nav button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
        document.getElementById("view-" + btn.dataset.view).classList.remove("hidden");
        if (window.APP.onViewShown) window.APP.onViewShown(btn.dataset.view);
      });
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Manual verification**

Run: `python3 -m http.server 8000` in the repo root, open `http://localhost:8000`.
Expected: the Login view renders. (Login itself will error until Firebase config is filled in during Task 15 — that is expected now.) No JavaScript console errors from `lib.js` loading (`window.KO` is defined — check `KO.formatMoney(1)` in the console returns `"1.00"`).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add app shell, Firebase init, and auth"
```

---

## Task 9: Firestore data layer (subscribe + seed defaults)

**Files:**
- Modify: `index.html` (add a `<script type="module">` section, or extend the existing one, after the auth wiring)

**Interfaces:**
- Consumes: `window.APP.db`, `window.APP.onLogin` hook.
- Produces on `window.APP`:
  - `state.customers`, `state.flavours`, `state.deliveries` (arrays of `{id, ...}`), `state.settings` (`{sizes, reciboHeader}`), kept live via `onSnapshot`.
  - `render()` — re-renders whichever view is active (calls the per-view render fns registered by later tasks via `window.APP.renderers[viewName]`).
  - CRUD helpers: `addDelivery(obj)`, `updateDelivery(id, obj)`, `deleteDelivery(id)`, `addCustomer(name, notes)`, `updateCustomer(id, obj)`, `deleteCustomer(id)`, `addFlavour(name)`, `deleteFlavour(id)`, `saveSettings(obj)`.
  - `customerName(id)`, `flavourName(id)` lookups.

- [ ] **Step 1: Add the data layer.** Append inside the module script (after the nav switching block), so it shares the imports. First extend the imports at the top of the module script:

```js
    import { collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, getDoc }
      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
```

Then append:

```js
    const S = window.APP.state;
    window.APP.renderers = {};

    window.APP.render = function () {
      const active = document.querySelector("nav button.active");
      const view = active ? active.dataset.view : "new";
      if (window.APP.renderers[view]) window.APP.renderers[view]();
    };
    window.APP.onViewShown = function (view) {
      if (window.APP.renderers[view]) window.APP.renderers[view]();
    };

    window.APP.customerName = (id) => (S.customers.find((c) => c.id === id) || {}).name || "(unknown)";
    window.APP.flavourName = (id) => (S.flavours.find((f) => f.id === id) || {}).name || "(unknown)";

    const DEFAULT_SETTINGS = {
      reciboHeader: "OUT - Kombucha Produto",
      sizes: [
        { id: "1L", label: "1 L", price: 8, deposit: 0 },
        { id: "270ml", label: "270 ml", price: 4.5, deposit: 1 },
      ],
    };

    function watch(name, target) {
      onSnapshot(collection(db, name), (snap) => {
        target.length = 0;
        snap.forEach((d) => target.push(Object.assign({ id: d.id }, d.data())));
        window.APP.render();
      });
    }

    window.APP.onLogin = async function () {
      // Seed settings on first run.
      const settingsRef = doc(db, "settings", "app");
      const existing = await getDoc(settingsRef);
      if (!existing.exists()) await setDoc(settingsRef, DEFAULT_SETTINGS);
      onSnapshot(settingsRef, (d) => {
        S.settings = d.exists() ? d.data() : DEFAULT_SETTINGS;
        window.APP.render();
      });
      watch("customers", S.customers);
      watch("flavours", S.flavours);
      watch("deliveries", S.deliveries);
      window.APP.render();
    };

    // CRUD
    window.APP.addDelivery = (o) => addDoc(collection(db, "deliveries"), o);
    window.APP.updateDelivery = (id, o) => updateDoc(doc(db, "deliveries", id), o);
    window.APP.deleteDelivery = (id) => deleteDoc(doc(db, "deliveries", id));
    window.APP.addCustomer = (name, notes) => addDoc(collection(db, "customers"), { name, notes: notes || "" });
    window.APP.updateCustomer = (id, o) => updateDoc(doc(db, "customers", id), o);
    window.APP.deleteCustomer = (id) => deleteDoc(doc(db, "customers", id));
    window.APP.addFlavour = (name) => addDoc(collection(db, "flavours"), { name });
    window.APP.deleteFlavour = (id) => deleteDoc(doc(db, "flavours", id));
    window.APP.saveSettings = (o) => setDoc(doc(db, "settings", "app"), o);
```

- [ ] **Step 2: Manual verification (deferred to Task 15).**

The data layer cannot fully run until Firebase config + accounts exist (Task 15). For now verify there are no syntax errors: reload `http://localhost:8000` and confirm the Login view still renders with no console errors. Full data verification happens in Task 15's end-to-end check.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add Firestore data layer with live subscriptions and CRUD"
```

---

## Task 10: New / Edit Delivery view

**Files:**
- Modify: `index.html` (add a plain `<script>` after the module script — it uses `window.APP` and `window.KO` globals; it does NOT need imports)

**Interfaces:**
- Consumes: `window.APP.state`, `addDelivery`, `updateDelivery`, `addCustomer`, `addFlavour`, `KO.deliveryRevenue`, `KO.formatMoney`, `window.APP.user`.
- Produces: `window.APP.renderers.new = renderNew`; sets `window.APP.editDelivery(id)` to load an existing delivery into the form and switch to the New view (used by Deliveries list in Task 11). Form supports N line items (size + flavour + qty), add-new customer, add-new flavour, empties per size, live subtotal, save/reset.

- [ ] **Step 1: Add a `<script>` (non-module) at the end of `<body>`**

```html
  <script>
  (function () {
    const A = window.APP, KO = window.KO;
    const container = document.getElementById("view-new");
    let editing = null; // delivery id being edited, or null

    function sizeOptions(selected) {
      return (A.state.settings ? A.state.settings.sizes : [])
        .map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${s.label}</option>`).join("");
    }
    function flavourOptions(selected) {
      const opts = A.state.flavours
        .slice().sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => `<option value="${f.id}" ${f.id === selected ? "selected" : ""}>${f.name}</option>`).join("");
      return opts + `<option value="__new__">➕ Add new flavour…</option>`;
    }
    function customerOptions(selected) {
      const opts = A.state.customers
        .slice().sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${c.name}</option>`).join("");
      return `<option value="">— choose customer —</option>` + opts + `<option value="__new__">➕ Add new customer…</option>`;
    }

    function itemRow(item) {
      item = item || { sizeId: "", flavourId: "", quantity: 1 };
      const div = document.createElement("div");
      div.className = "row item-row";
      div.innerHTML =
        `<div><label>Size</label><select class="it-size">${sizeOptions(item.sizeId)}</select></div>` +
        `<div><label>Flavour</label><select class="it-flav">${flavourOptions(item.flavourId)}</select></div>` +
        `<div style="flex:0 0 64px"><label>Qty</label><input class="it-qty" type="number" min="1" value="${item.quantity}"/></div>` +
        `<button class="link it-del" style="flex:0 0 32px">✕</button>`;
      div.querySelector(".it-flav").addEventListener("change", onFlavourChange);
      div.querySelector(".it-qty").addEventListener("input", updateSubtotal);
      div.querySelector(".it-size").addEventListener("change", updateSubtotal);
      div.querySelector(".it-del").addEventListener("click", (e) => { e.preventDefault(); div.remove(); updateSubtotal(); });
      return div;
    }

    async function onFlavourChange(e) {
      if (e.target.value === "__new__") {
        const name = prompt("New flavour name:");
        if (name && name.trim()) {
          const ref = await A.addFlavour(name.trim());
          // Re-render options; select the new flavour once it arrives via snapshot.
          e.target.dataset.pending = name.trim();
        } else { e.target.value = ""; }
      }
    }

    function emptiesRows() {
      return (A.state.settings ? A.state.settings.sizes : []).map((s) =>
        `<div class="row"><div><label>${s.label} empties back</label>` +
        `<input class="emp-qty" data-size="${s.id}" type="number" min="0" value="0"/></div></div>`).join("");
    }

    function updateSubtotal() {
      const delivery = readForm();
      const total = KO.deliveryRevenue(delivery, A.state.settings ? A.state.settings.sizes : []);
      const el = container.querySelector("#subtotal");
      if (el) el.textContent = KO.formatMoney(total);
    }

    function readForm() {
      const items = [];
      container.querySelectorAll(".item-row").forEach((r) => {
        const sizeId = r.querySelector(".it-size").value;
        const flavourId = r.querySelector(".it-flav").value;
        const quantity = parseInt(r.querySelector(".it-qty").value, 10) || 0;
        if (sizeId && flavourId && flavourId !== "__new__" && quantity > 0)
          items.push({ sizeId, flavourId, quantity });
      });
      const empties = [];
      container.querySelectorAll(".emp-qty").forEach((i) => {
        const q = parseInt(i.value, 10) || 0;
        if (q > 0) empties.push({ sizeId: i.dataset.size, quantity: q });
      });
      return {
        customerId: container.querySelector("#cust").value,
        date: container.querySelector("#date").value,
        items, empties,
        note: container.querySelector("#note").value.trim(),
      };
    }

    function todayStr() {
      const d = new Date();
      const off = d.getTimezoneOffset();
      return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
    }

    function renderNew() {
      if (!A.state.settings) { container.innerHTML = "<p class='muted'>Loading…</p>"; return; }
      container.innerHTML =
        `<div class="card">` +
        `<h3>${editing ? "Edit" : "New"} delivery</h3>` +
        `<label>Customer</label><select id="cust">${customerOptions("")}</select>` +
        `<label>Date</label><input id="date" type="date" value="${todayStr()}"/>` +
        `<h4>Bottles delivered</h4><div id="items"></div>` +
        `<button class="link" id="addItem">➕ Add line</button>` +
        `<h4>Empties received back</h4>${emptiesRows()}` +
        `<label>Note (optional)</label><textarea id="note" rows="2"></textarea>` +
        `<p><strong>Subtotal: €<span id="subtotal">0.00</span></strong></p>` +
        `<p id="formErr" class="muted"></p>` +
        `<button class="primary" id="save">${editing ? "Update" : "Save"} delivery</button>` +
        (editing ? `<button class="link" id="cancelEdit">Cancel edit</button>` : "") +
        `</div>`;

      const itemsDiv = container.querySelector("#items");
      itemsDiv.appendChild(itemRow());

      container.querySelector("#cust").addEventListener("change", async (e) => {
        if (e.target.value === "__new__") {
          const name = prompt("New customer name:");
          if (name && name.trim()) { await A.addCustomer(name.trim()); e.target.dataset.pending = name.trim(); }
          else e.target.value = "";
        }
      });
      container.querySelector("#addItem").addEventListener("click", (e) => { e.preventDefault(); itemsDiv.appendChild(itemRow()); });
      container.querySelector("#save").addEventListener("click", onSave);
      if (editing) container.querySelector("#cancelEdit").addEventListener("click", (e) => { e.preventDefault(); editing = null; renderNew(); });
      updateSubtotal();
    }

    async function onSave(e) {
      e.preventDefault();
      const d = readForm();
      const err = container.querySelector("#formErr");
      if (!d.customerId || d.customerId === "__new__") { err.textContent = "Please choose a customer."; return; }
      if (!d.date) { err.textContent = "Please choose a date."; return; }
      if (d.items.length === 0) { err.textContent = "Add at least one bottle line."; return; }
      try {
        if (editing) { await A.updateDelivery(editing, d); editing = null; }
        else { d.enteredBy = A.user ? A.user.email : ""; await A.addDelivery(d); }
        renderNew();
        err.textContent = "Saved ✓";
      } catch (ex) { err.textContent = "Save failed: " + ex.message; }
    }

    A.editDelivery = function (id) {
      const d = A.state.deliveries.find((x) => x.id === id);
      if (!d) return;
      editing = id;
      renderNew();
      container.querySelector("#cust").value = d.customerId;
      container.querySelector("#date").value = d.date;
      const itemsDiv = container.querySelector("#items");
      itemsDiv.innerHTML = "";
      (d.items || []).forEach((it) => itemsDiv.appendChild(itemRow(it)));
      if ((d.items || []).length === 0) itemsDiv.appendChild(itemRow());
      (d.empties || []).forEach((emp) => {
        const inp = container.querySelector(`.emp-qty[data-size="${emp.sizeId}"]`);
        if (inp) inp.value = emp.quantity;
      });
      container.querySelector("#note").value = d.note || "";
      updateSubtotal();
      // switch to this view
      document.querySelector('nav button[data-view="new"]').click();
    };

    A.renderers.new = renderNew;
  })();
  </script>
```

- [ ] **Step 2: Manual verification (deferred to Task 15 for data writes).**

Reload the page. Since data requires Firebase (Task 15), confirm no console errors and that the New view HTML structure is created once settings load. Full add/edit verification is in Task 15's end-to-end check.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add new/edit delivery form"
```

---

## Task 11: Deliveries list view

**Files:**
- Modify: `index.html` (append another non-module `<script>`)

**Interfaces:**
- Consumes: `A.state.deliveries`, `A.customerName`, `A.flavourName`, `A.deleteDelivery`, `A.editDelivery`, `KO.deliveryRevenue`, `KO.formatMoney`, `A.state.settings.sizes`.
- Produces: `A.renderers.deliveries`.

- [ ] **Step 1: Add the view script**

```html
  <script>
  (function () {
    const A = window.APP, KO = window.KO;
    const container = document.getElementById("view-deliveries");

    function itemSummary(d, sizes) {
      return (d.items || []).map((it) => {
        const s = KO.sizeById(sizes, it.sizeId);
        return it.quantity + "× " + (s ? s.label : it.sizeId) + " " + A.flavourName(it.flavourId);
      }).join(", ");
    }

    function render() {
      const sizes = A.state.settings ? A.state.settings.sizes : [];
      const list = A.state.deliveries.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
      if (list.length === 0) { container.innerHTML = "<p class='muted'>No deliveries yet.</p>"; return; }
      container.innerHTML = list.map((d) =>
        `<div class="card">` +
        `<strong>${A.customerName(d.customerId)}</strong> — ${d.date}<br/>` +
        `<span class="muted">${itemSummary(d, sizes)}</span><br/>` +
        `Revenue: €${KO.formatMoney(KO.deliveryRevenue(d, sizes))}` +
        ((d.empties || []).length ? ` · Empties back: ${(d.empties).map((e) => e.quantity + "× " + e.sizeId).join(", ")}` : "") +
        `<div style="margin-top:8px">` +
        `<button class="link" data-edit="${d.id}">Edit</button> · ` +
        `<button class="link" data-del="${d.id}">Delete</button></div>` +
        `</div>`).join("");

      container.querySelectorAll("[data-edit]").forEach((b) =>
        b.addEventListener("click", () => A.editDelivery(b.dataset.edit)));
      container.querySelectorAll("[data-del]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (confirm("Delete this delivery?")) await A.deleteDelivery(b.dataset.del);
        }));
    }

    A.renderers.deliveries = render;
  })();
  </script>
```

- [ ] **Step 2: Manual verification (deferred to Task 15).**

Confirm no console errors on reload. Full verification in Task 15.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add deliveries list view with edit/delete"
```

---

## Task 12: Dashboard view

**Files:**
- Modify: `index.html` (append another non-module `<script>`)

**Interfaces:**
- Consumes: `KO.monthlyRevenue`, `KO.revenueByCustomer`, `KO.monthlyRevenueSeries`, `KO.recentMonthKeys`, `KO.outstandingByCustomer`, `KO.flavourCounts`, `KO.barChartSVG`, `KO.formatMoney`, `KO.monthName`, `A.customerName`, `A.flavourName`.
- Produces: `A.renderers.dashboard`. Holds a month picker in `A.current.dashMonth` (defaults to current month).

- [ ] **Step 1: Add the view script**

```html
  <script>
  (function () {
    const A = window.APP, KO = window.KO;
    const container = document.getElementById("view-dashboard");

    function currentMonthKey() {
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    }

    function render() {
      const sizes = A.state.settings ? A.state.settings.sizes : [];
      const mk = A.current.dashMonth || (A.current.dashMonth = currentMonthKey());
      const revenue = KO.monthlyRevenue(A.state.deliveries, sizes, mk);
      const byCust = KO.revenueByCustomer(A.state.deliveries, sizes, mk);
      const series = KO.monthlyRevenueSeries(A.state.deliveries, sizes, KO.recentMonthKeys(mk, 6));
      const outstanding = KO.outstandingByCustomer(A.state.deliveries, sizes);
      const flavours = KO.flavourCounts(A.state.deliveries, mk);

      const revChart = KO.barChartSVG(series.map((s) => ({ label: KO.monthName(s.monthKey).slice(0, 3), value: s.amount })));
      const custChart = KO.barChartSVG(byCust.map((c) => ({ label: A.customerName(c.customerId).slice(0, 6), value: c.amount })));

      container.innerHTML =
        `<div class="card"><label>Month</label><input id="dashMonth" type="month" value="${mk}"/></div>` +
        `<div class="card"><h3>Revenue: €${KO.formatMoney(revenue)}</h3>${revChart}</div>` +
        `<div class="card"><h4>By customer</h4>` +
          (byCust.length ? custChart + "<table>" + byCust.map((c) =>
            `<tr><td>${A.customerName(c.customerId)}</td><td>€${KO.formatMoney(c.amount)}</td></tr>`).join("") + "</table>"
            : "<p class='muted'>No revenue this month.</p>") + `</div>` +
        `<div class="card"><h4>Outstanding bottles & deposit</h4>` +
          (outstanding.length ? "<table><tr><th>Customer</th><th>Out</th><th>Deposit</th></tr>" +
            outstanding.map((o) =>
              `<tr><td>${A.customerName(o.customerId)}</td>` +
              `<td>${Object.keys(o.perSize).map((sid) => o.perSize[sid] + "× " + sid).join(", ") || "0"}</td>` +
              `<td>€${KO.formatMoney(o.depositHeld)}</td></tr>`).join("") + "</table>"
            : "<p class='muted'>Nothing outstanding.</p>") + `</div>` +
        `<div class="card"><h4>Flavour popularity (${KO.monthName(mk)})</h4>` +
          (flavours.length ? "<table>" + flavours.map((f) =>
            `<tr><td>${A.flavourName(f.flavourId)}</td><td>${f.quantity}</td></tr>`).join("") + "</table>"
            : "<p class='muted'>No deliveries this month.</p>") + `</div>`;

      container.querySelector("#dashMonth").addEventListener("change", (e) => {
        A.current.dashMonth = e.target.value; render();
      });
    }

    A.renderers.dashboard = render;
  })();
  </script>
```

- [ ] **Step 2: Manual verification (deferred to Task 15).**

Confirm no console errors on reload. Full verification in Task 15.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add dashboard with revenue, share, outstanding, and flavours"
```

---

## Task 13: Recibo Verde view

**Files:**
- Modify: `index.html` (append another non-module `<script>`)

**Interfaces:**
- Consumes: `KO.generateRecibo`, `A.state.deliveries`, `A.state.customers`, `A.state.settings`.
- Produces: `A.renderers.recibo`. Holds selected customer in `A.current.reciboCust` and month in `A.current.reciboMonth`.

- [ ] **Step 1: Add the view script**

```html
  <script>
  (function () {
    const A = window.APP, KO = window.KO;
    const container = document.getElementById("view-recibo");

    function currentMonthKey() {
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    }

    function render() {
      if (!A.state.settings) { container.innerHTML = "<p class='muted'>Loading…</p>"; return; }
      const custId = A.current.reciboCust || "";
      const mk = A.current.reciboMonth || (A.current.reciboMonth = currentMonthKey());
      const custOpts = `<option value="">— choose —</option>` + A.state.customers
        .slice().sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => `<option value="${c.id}" ${c.id === custId ? "selected" : ""}>${c.name}</option>`).join("");

      let text = "";
      if (custId) text = KO.generateRecibo(A.state.deliveries, custId, mk, A.state.settings.sizes, A.state.settings.reciboHeader);

      container.innerHTML =
        `<div class="card">` +
        `<label>Customer</label><select id="rcust">${custOpts}</select>` +
        `<label>Month</label><input id="rmonth" type="month" value="${mk}"/>` +
        `</div>` +
        (custId ? `<div class="card"><pre id="rtext">${text.replace(/</g, "&lt;")}</pre>` +
          `<button class="primary" id="copyBtn">Copy to clipboard</button>` +
          `<p id="copyMsg" class="muted"></p></div>`
          : `<p class="muted">Choose a customer to generate the recibo text.</p>`);

      container.querySelector("#rcust").addEventListener("change", (e) => { A.current.reciboCust = e.target.value; render(); });
      container.querySelector("#rmonth").addEventListener("change", (e) => { A.current.reciboMonth = e.target.value; render(); });
      const copyBtn = container.querySelector("#copyBtn");
      if (copyBtn) copyBtn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(text); container.querySelector("#copyMsg").textContent = "Copied ✓"; }
        catch (e) { container.querySelector("#copyMsg").textContent = "Copy failed — select the text manually."; }
      });
    }

    A.renderers.recibo = render;
  })();
  </script>
```

- [ ] **Step 2: Manual verification (deferred to Task 15).**

Confirm no console errors on reload. Full verification in Task 15.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add recibo verde generator view with copy button"
```

---

## Task 14: Settings view

**Files:**
- Modify: `index.html` (append another non-module `<script>`)

**Interfaces:**
- Consumes: `A.state.settings`, `A.saveSettings`, `A.state.customers`, `A.updateCustomer`, `A.deleteCustomer`, `A.state.flavours`, `A.deleteFlavour`, `A.state.deliveries`, `A.logout`, `A.user`, `KO.formatMoney`.
- Produces: `A.renderers.settings`. Blocks deleting a customer/flavour still referenced by any delivery.

- [ ] **Step 1: Add the view script**

```html
  <script>
  (function () {
    const A = window.APP, KO = window.KO;
    const container = document.getElementById("view-settings");

    function customerInUse(id) { return A.state.deliveries.some((d) => d.customerId === id); }
    function flavourInUse(id) { return A.state.deliveries.some((d) => (d.items || []).some((it) => it.flavourId === id)); }

    function render() {
      const st = A.state.settings;
      if (!st) { container.innerHTML = "<p class='muted'>Loading…</p>"; return; }

      container.innerHTML =
        `<div class="card"><h4>Account</h4><p class="muted">${A.user ? A.user.email : ""}</p>` +
          `<button class="link" id="logoutBtn">Log out</button></div>` +
        `<div class="card"><h4>Bottle sizes & prices</h4>` +
          st.sizes.map((s, i) =>
            `<div class="row" data-idx="${i}">` +
            `<div><label>Label</label><input class="s-label" value="${s.label}"/></div>` +
            `<div><label>Price €</label><input class="s-price" type="number" step="0.5" value="${s.price}"/></div>` +
            `<div><label>Deposit €</label><input class="s-dep" type="number" step="0.5" value="${s.deposit}"/></div>` +
            `</div>`).join("") +
          `<label>Recibo header text</label><input id="recHeader" value="${st.reciboHeader}"/>` +
          `<button class="primary" id="saveSettings">Save settings</button>` +
          `<p id="setMsg" class="muted"></p></div>` +
        `<div class="card"><h4>Customers</h4>` +
          A.state.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map((c) =>
            `<div class="row"><div>${c.name}</div>` +
            `<button class="link" data-delcust="${c.id}" style="flex:0 0 60px">Delete</button></div>`).join("") +
          `</div>` +
        `<div class="card"><h4>Flavours</h4>` +
          A.state.flavours.slice().sort((a,b)=>a.name.localeCompare(b.name)).map((f) =>
            `<div class="row"><div>${f.name}</div>` +
            `<button class="link" data-delflav="${f.id}" style="flex:0 0 60px">Delete</button></div>`).join("") +
          `</div>` +
        `<div class="card"><h4>Backup</h4>` +
          `<button class="link" id="exportBtn">Export all data (JSON)</button></div>`;

      container.querySelector("#logoutBtn").addEventListener("click", () => A.logout());

      container.querySelector("#saveSettings").addEventListener("click", async () => {
        const sizes = Array.from(container.querySelectorAll(".row[data-idx]")).map((row, i) => ({
          id: st.sizes[i].id,
          label: row.querySelector(".s-label").value.trim(),
          price: parseFloat(row.querySelector(".s-price").value) || 0,
          deposit: parseFloat(row.querySelector(".s-dep").value) || 0,
        }));
        await A.saveSettings({ sizes, reciboHeader: container.querySelector("#recHeader").value.trim() });
        container.querySelector("#setMsg").textContent = "Saved ✓";
      });

      container.querySelectorAll("[data-delcust]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (customerInUse(b.dataset.delcust)) { alert("Cannot delete: this customer has deliveries."); return; }
          if (confirm("Delete this customer?")) await A.deleteCustomer(b.dataset.delcust);
        }));
      container.querySelectorAll("[data-delflav]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (flavourInUse(b.dataset.delflav)) { alert("Cannot delete: this flavour is used by deliveries."); return; }
          if (confirm("Delete this flavour?")) await A.deleteFlavour(b.dataset.delflav);
        }));

      container.querySelector("#exportBtn").addEventListener("click", () => {
        const data = {
          version: 1, exportedAt: new Date().toISOString(),
          settings: A.state.settings, customers: A.state.customers,
          flavours: A.state.flavours, deliveries: A.state.deliveries,
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "kombucha-backup.json"; a.click();
        URL.revokeObjectURL(url);
      });
    }

    A.renderers.settings = render;
  })();
  </script>
```

- [ ] **Step 2: Manual verification (deferred to Task 15).**

Confirm no console errors on reload. Full verification in Task 15.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add settings view with sizes, customers, flavours, export"
```

---

## Task 15: Firebase setup, security rules, deploy, and end-to-end verification

**Files:**
- Create: `firestore.rules`
- Create: `docs/FIREBASE_SETUP.md`
- Modify: `index.html` (fill in real `FIREBASE_CONFIG` values)
- Modify: `README.md` (deploy + setup instructions)

**Interfaces:** none (integration/config task).

- [ ] **Step 1: Create `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function allowed() {
      return request.auth != null &&
        request.auth.token.email in [
          "REPLACE_WITH_ACCOUNT_1@example.com",
          "REPLACE_WITH_ACCOUNT_2@example.com"
        ];
    }
    match /{document=**} {
      allow read, write: if allowed();
    }
  }
}
```

- [ ] **Step 2: Create `docs/FIREBASE_SETUP.md`**

```markdown
# Firebase setup (one-time)

1. Go to https://console.firebase.google.com and create a project (free Spark plan).
2. **Authentication** → Get started → enable **Email/Password**. Under Users, add two
   accounts (you and your wife) with email + password.
3. **Firestore Database** → Create database → start in production mode → pick a region
   (e.g. `europe-west`).
4. **Rules**: paste the contents of `firestore.rules`, replacing the two placeholder
   emails with your two account emails, then Publish.
5. **Project settings** (gear icon) → *Your apps* → **Web app** (`</>`). Register the
   app. Copy the `firebaseConfig` values.
6. In `index.html`, replace the `FIREBASE_CONFIG` object's `TODO` values with those
   values. Commit and push.
7. Open the GitHub Pages URL, log in with one of the accounts, and you're live.

Firebase web config values are safe to commit — access is controlled by the rules,
not by hiding the config.
```

- [ ] **Step 3: Perform the Firebase setup** following `docs/FIREBASE_SETUP.md`, and paste the real config values into `FIREBASE_CONFIG` in `index.html`. (This is a manual step done with the user; the two accounts and the rules must be created in the Firebase console.)

- [ ] **Step 4: Enable GitHub Pages**

In the GitHub repo: Settings → Pages → Source = "Deploy from a branch", Branch = `main`, folder `/ (root)`. Save. Note the published URL.

- [ ] **Step 5: Update `README.md`** — add a "Run locally", "Firebase setup" (link to `docs/FIREBASE_SETUP.md`), and "Deploy (GitHub Pages)" section with the published URL, and "Add to Home Screen" instructions for iPhone.

- [ ] **Step 6: End-to-end verification (the real test of Tasks 8–14)**

Open the published URL (or `python3 -m http.server 8000` with real config) and verify:
1. Log in with one account; the app view appears.
2. **New**: create the customer "Palm Spot", add a line 1L / a new flavour "Ginger" / qty 4, save. Subtotal shows €32.00.
3. Re-enter the June example for a customer: 3 deliveries (June 3: 2×1L + 7×270ml returned; June 10: 2×1L + 10×270ml; June 24: 2×1L).
4. **Deliveries**: the deliveries appear newest-first; edit one and confirm changes persist; delete one and confirm it disappears.
5. **Dashboard**: pick June 2026 — revenue and per-customer bars render; outstanding shows 270ml still out and the deposit held.
6. **Recibo**: choose that customer + June 2026 — the text matches the €86 format; "Copy" copies it.
7. **Settings**: change 1L price to 9, save, and confirm the dashboard recalculates; try deleting an in-use customer and confirm it is blocked; Export downloads a JSON file.
8. Open the same URL on a second device/browser, log in with the other account, and confirm the same data appears (shared sync).

- [ ] **Step 7: Run unit tests once more**

Run: `node --test`
Expected: PASS (all `lib.js` tests).

- [ ] **Step 8: Commit and push**

```bash
git add firestore.rules docs/FIREBASE_SETUP.md index.html README.md
git commit -m "feat: add Firebase config, security rules, setup guide, and deploy docs"
git push
```

---

## Self-Review Notes

- **Spec coverage:** delivery entry (T10), customer/flavour dropdowns with add-new (T10), sizes/prices/deposits (T9 defaults, T14 edit), deliveries list with edit/delete (T11), dashboard revenue + share + outstanding + flavours (T12), recibo verde generator (T6 logic, T13 UI), two-account auth + shared Firestore + offline (T8, T9), security rules (T15), export backup (T14), block delete-in-use (T14). All spec sections map to tasks.
- **Deposit vs revenue:** revenue functions never include deposits (T2, T4); recibo nets deposits (T6). Consistent.
- **Type consistency:** `sizes` items are `{id,label,price,deposit}` everywhere; `delivery` shape identical across T2/T4/T5/T6/T10; `KO` function names used in UI match those defined in T1–T7.
- **No placeholders:** every code step contains complete code; the only intentional `TODO`s are the Firebase config values, filled in T15 as designed.
