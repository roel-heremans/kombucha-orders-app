# Dashboard Analytics Implementation Plan (Project A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin Dashboard report over a selectable time window (This month / Last month / This year / Custom range) and show revenue split by customer type (Private vs Restaurant vs total) in a monthly stacked chart and a new all-years yearly chart.

**Architecture:** All analytics are pure functions in `lib.js` (unit-tested via `node --test`), consumed by the single `view-dashboard` IIFE in `index.html`. A new `stackedBarChartSVG` renders the split charts. Everything is derived from existing `deliveries` + customer `type` — no Firebase/schema changes.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step), hand-rolled SVG charts, `node --test` for pure-logic tests, Firebase (unchanged), GitHub Pages.

## Global Constraints

- No build step; single `index.html` + `lib.js` + CDN Firebase. No bundlers/npm runtime deps.
- Pure, testable logic goes in `lib.js` (exported via the UMD return object) with tests in `test/lib.test.js`; run with `npm test` (`node --test`).
- UI/chart changes are verified **manually in the browser** (no DOM/integration harness); verification steps say exactly what to do and observe.
- Each view is its own `DOMContentLoaded` IIFE reading `window.APP` (alias `A`) and `window.KO` (alias `KO`); do not merge views.
- HTML built from data must be escaped with `A.esc(...)`.
- Money formatted with `KO.formatMoney`; a euro amount displays as `"€" + KO.formatMoney(v)`.
- Customer type is `"private"` or (default when missing/other) `"restaurant"`, matching existing `revenueByCustomerType`.
- Month keys are `"YYYY-MM"` strings; they compare correctly with `<`, `<=`, `>=` lexicographically.
- Charts reuse the existing tap-tip mechanism: any element with a `data-tip` attribute, when tapped, has its text shown in the `.chart-tip` element inside the enclosing `.chartwrap`.
- Split-chart colors: **Restaurant = `#4a7c59`** (the app green), **Private = `#3d6b8c`** (blue). Legend labels exactly **Private** and **Restaurant**. (These two are chosen for hue+lightness separation; the `dataviz` skill may be consulted to sanity-check, but use these exact values.)

---

### Task 1: Month-window helpers + window analytics in `lib.js`

**Files:**
- Modify: `lib.js` (add functions; export them)
- Test: `test/lib.test.js` (append tests)

**Interfaces:**
- Produces:
  - `KO.monthKeysBetween(startMk, endMk)` → ascending `["YYYY-MM", …]` inclusive; handles year boundaries; returns `[endMk]` when `startMk > endMk`.
  - `KO.inWindow(dateStr, startMk, endMk)` → boolean; true when `monthKey(dateStr)` is within `[startMk, endMk]` inclusive.
  - `KO.revenueInWindow(deliveries, sizes, startMk, endMk)` → number.
  - `KO.revenueByCustomerInWindow(deliveries, sizes, startMk, endMk)` → `[{customerId, amount}]` sorted by amount desc.
  - `KO.flavourCountsInWindow(deliveries, startMk, endMk)` → `[{flavourId, quantity}]` sorted by quantity desc.
  - `KO.windowLabel(startMk, endMk)` → e.g. `"Jul 2026"`, `"Jan–Jul 2026"`, `"Nov 2025–Feb 2026"`.
- Consumes: existing `monthKey`, `monthName`, `deliveryRevenue`, `sizeById` in `lib.js`.

- [ ] **Step 1: Write the failing tests**

Append to `test/lib.test.js` (reuse the existing `SIZES` and `DELIVS` fixtures at the top of that file):

```javascript
test("monthKeysBetween is inclusive and ascending, across year boundary", () => {
  assert.deepStrictEqual(KO.monthKeysBetween("2026-01", "2026-03"), ["2026-01", "2026-02", "2026-03"]);
  assert.deepStrictEqual(KO.monthKeysBetween("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepStrictEqual(KO.monthKeysBetween("2026-05", "2026-05"), ["2026-05"]);
});

test("monthKeysBetween returns [endMk] when start is after end", () => {
  assert.deepStrictEqual(KO.monthKeysBetween("2026-08", "2026-03"), ["2026-03"]);
});

test("inWindow includes the range endpoints", () => {
  assert.strictEqual(KO.inWindow("2026-06-15", "2026-06", "2026-07"), true);
  assert.strictEqual(KO.inWindow("2026-07-01", "2026-06", "2026-07"), true);
  assert.strictEqual(KO.inWindow("2026-05-31", "2026-06", "2026-07"), false);
  assert.strictEqual(KO.inWindow("2026-08-01", "2026-06", "2026-07"), false);
});

test("revenueInWindow sums deliveries across the window", () => {
  // DELIVS: A 2026-06-03 (2x1L=16), A 2026-06-10 (2x1L+10x270ml=16+45=61),
  //         B 2026-06-15 (4x270ml=18), A 2026-07-01 (1x1L=8)
  assert.strictEqual(KO.revenueInWindow(DELIVS, SIZES, "2026-06", "2026-06"), 95);
  assert.strictEqual(KO.revenueInWindow(DELIVS, SIZES, "2026-06", "2026-07"), 103);
  assert.strictEqual(KO.revenueInWindow(DELIVS, SIZES, "2026-08", "2026-09"), 0);
});

test("revenueByCustomerInWindow groups and sorts desc", () => {
  const out = KO.revenueByCustomerInWindow(DELIVS, SIZES, "2026-06", "2026-07");
  // A: 16+61+8=85, B: 18
  assert.deepStrictEqual(out, [{ customerId: "A", amount: 85 }, { customerId: "B", amount: 18 }]);
});

test("flavourCountsInWindow counts quantities in the window, sorted desc", () => {
  const out = KO.flavourCountsInWindow(DELIVS, "2026-06", "2026-06");
  // June items: gin 2 + gin 2 + lem 10 + gin 4 => gin 8? A6/3 gin2, A6/10 gin2+lem10, B6/15 gin4
  const gin = out.find((x) => x.flavourId === "gin");
  const lem = out.find((x) => x.flavourId === "lem");
  assert.strictEqual(gin.quantity, 8);
  assert.strictEqual(lem.quantity, 10);
  assert.strictEqual(out[0].quantity >= out[out.length - 1].quantity, true);
});

test("windowLabel formats single month, same-year range, and cross-year range", () => {
  assert.strictEqual(KO.windowLabel("2026-07", "2026-07"), "Jul 2026");
  assert.strictEqual(KO.windowLabel("2026-01", "2026-07"), "Jan–Jul 2026");
  assert.strictEqual(KO.windowLabel("2025-11", "2026-02"), "Nov 2025–Feb 2026");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — new tests error with `KO.monthKeysBetween is not a function` etc. Existing tests still pass.

- [ ] **Step 3: Add the implementation**

In `lib.js`, add these functions (place them after `recentMonthKeys` / near the other month helpers, before `outstandingByCustomer`):

```javascript
  function monthKeysBetween(startMk, endMk) {
    if (startMk > endMk) return [endMk];
    let y = parseInt(startMk.slice(0, 4), 10);
    let m = parseInt(startMk.slice(5, 7), 10);
    const ey = parseInt(endMk.slice(0, 4), 10);
    const em = parseInt(endMk.slice(5, 7), 10);
    const keys = [];
    while (y < ey || (y === ey && m <= em)) {
      keys.push(y + "-" + String(m).padStart(2, "0"));
      m++; if (m === 13) { m = 1; y++; }
    }
    return keys;
  }

  function inWindow(dateStr, startMk, endMk) {
    const mk = monthKey(dateStr);
    return mk >= startMk && mk <= endMk;
  }

  function revenueInWindow(deliveries, sizes, startMk, endMk) {
    return deliveries.reduce(function (sum, d) {
      return inWindow(d.date, startMk, endMk) ? sum + deliveryRevenue(d, sizes) : sum;
    }, 0);
  }

  function revenueByCustomerInWindow(deliveries, sizes, startMk, endMk) {
    const byId = {};
    deliveries.forEach(function (d) {
      if (!inWindow(d.date, startMk, endMk)) return;
      byId[d.customerId] = (byId[d.customerId] || 0) + deliveryRevenue(d, sizes);
    });
    return Object.keys(byId)
      .map(function (id) { return { customerId: id, amount: byId[id] }; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  function flavourCountsInWindow(deliveries, startMk, endMk) {
    const byId = {};
    deliveries.forEach(function (d) {
      if (!inWindow(d.date, startMk, endMk)) return;
      (d.items || []).forEach(function (it) {
        byId[it.flavourId] = (byId[it.flavourId] || 0) + it.quantity;
      });
    });
    return Object.keys(byId)
      .map(function (id) { return { flavourId: id, quantity: byId[id] }; })
      .sort(function (a, b) { return b.quantity - a.quantity; });
  }

  function windowLabel(startMk, endMk) {
    const abbr = function (mk) { return monthName(mk).slice(0, 3); };
    const year = function (mk) { return mk.slice(0, 4); };
    if (startMk === endMk) return abbr(startMk) + " " + year(startMk);
    if (year(startMk) === year(endMk)) return abbr(startMk) + "–" + abbr(endMk) + " " + year(endMk);
    return abbr(startMk) + " " + year(startMk) + "–" + abbr(endMk) + " " + year(endMk);
  }
```

- [ ] **Step 4: Export the functions**

Add `monthKeysBetween, inWindow, revenueInWindow, revenueByCustomerInWindow, flavourCountsInWindow, windowLabel` to the `return { ... }` object at the end of `lib.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add month-window helpers and window analytics to lib.js"
```

---

### Task 2: Revenue-split-by-type functions in `lib.js`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

**Interfaces:**
- Produces:
  - `KO.revenueByTypeInWindow(deliveries, sizes, customers, startMk, endMk)` → `{ private, restaurant, total }`.
  - `KO.revenueTypeSeries(deliveries, sizes, customers, monthKeys)` → `[{ monthKey, private, restaurant, total }]`, one per given month key, in the given order.
  - `KO.revenueTypeByYear(deliveries, sizes, customers)` → `[{ year, private, restaurant, total }]` for all years with data, ascending by year.
- Consumes: `deliveryRevenue`, `inWindow` (Task 1).

- [ ] **Step 1: Write the failing tests**

Append to `test/lib.test.js`. Add a customers fixture near the top-level fixtures if not present, or inline it here:

```javascript
const CUSTS = [
  { id: "A", name: "Alice", type: "restaurant" },
  { id: "B", name: "Bob", type: "private" },
];

test("revenueByTypeInWindow splits private vs restaurant", () => {
  // Window 2026-06..2026-07: A(restaurant)=16+61+8=85, B(private)=18
  const out = KO.revenueByTypeInWindow(DELIVS, SIZES, CUSTS, "2026-06", "2026-07");
  assert.deepStrictEqual(out, { private: 18, restaurant: 85, total: 103 });
});

test("revenueByTypeInWindow treats unknown/missing type as restaurant", () => {
  const custs = [{ id: "A", name: "Alice" }]; // no type => restaurant; B absent => restaurant
  const out = KO.revenueByTypeInWindow(DELIVS, SIZES, custs, "2026-06", "2026-07");
  assert.deepStrictEqual(out, { private: 0, restaurant: 103, total: 103 });
});

test("revenueTypeSeries returns one entry per month key, in order", () => {
  const out = KO.revenueTypeSeries(DELIVS, SIZES, CUSTS, ["2026-06", "2026-07"]);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0], { monthKey: "2026-06", private: 18, restaurant: 77, total: 95 });
  assert.deepStrictEqual(out[1], { monthKey: "2026-07", private: 0, restaurant: 8, total: 8 });
});

test("revenueTypeByYear aggregates per year ascending", () => {
  const out = KO.revenueTypeByYear(DELIVS, SIZES, CUSTS);
  assert.deepStrictEqual(out, [{ year: "2026", private: 18, restaurant: 85, total: 103 }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `KO.revenueByTypeInWindow is not a function` etc.

- [ ] **Step 3: Add the implementation**

In `lib.js`, add after the Task 1 functions:

```javascript
  function typeMap(customers) {
    const t = {};
    (customers || []).forEach(function (c) { t[c.id] = c.type === "private" ? "private" : "restaurant"; });
    return t;
  }

  function revenueByTypeInWindow(deliveries, sizes, customers, startMk, endMk) {
    const t = typeMap(customers);
    let priv = 0, rest = 0;
    deliveries.forEach(function (d) {
      if (!inWindow(d.date, startMk, endMk)) return;
      const r = deliveryRevenue(d, sizes);
      if ((t[d.customerId] || "restaurant") === "private") priv += r; else rest += r;
    });
    return { private: priv, restaurant: rest, total: priv + rest };
  }

  function revenueTypeSeries(deliveries, sizes, customers, monthKeys) {
    return monthKeys.map(function (mk) {
      const r = revenueByTypeInWindow(deliveries, sizes, customers, mk, mk);
      return { monthKey: mk, private: r.private, restaurant: r.restaurant, total: r.total };
    });
  }

  function revenueTypeByYear(deliveries, sizes, customers) {
    const t = typeMap(customers);
    const byYear = {};
    deliveries.forEach(function (d) {
      const y = d.date.slice(0, 4);
      const e = byYear[y] || (byYear[y] = { private: 0, restaurant: 0 });
      const r = deliveryRevenue(d, sizes);
      if ((t[d.customerId] || "restaurant") === "private") e.private += r; else e.restaurant += r;
    });
    return Object.keys(byYear).sort().map(function (y) {
      return { year: y, private: byYear[y].private, restaurant: byYear[y].restaurant,
        total: byYear[y].private + byYear[y].restaurant };
    });
  }
```

- [ ] **Step 4: Export the functions**

Add `revenueByTypeInWindow, revenueTypeSeries, revenueTypeByYear` to the `return { ... }` object in `lib.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add revenue-split-by-type analytics (window, series, yearly) to lib.js"
```

---

### Task 3: Stacked bar chart in `lib.js`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

**Interfaces:**
- Produces: `KO.stackedBarChartSVG(bars, opts)` → SVG string.
  - `bars`: `[{ label, tip, segments: [{ value, color }] }]`. Each bar height ∝ sum of its segment values; segments stack bottom-to-top; each segment `<rect>` carries `data-tip="<tip>"` and a `<title>` of the same, plus an x-axis `<text>` label per bar.
  - `opts`: `{ width, height }` (defaults 320×160).
- Consumes: existing `escapeXml` in `lib.js`.

- [ ] **Step 1: Write the failing tests**

Append to `test/lib.test.js`:

```javascript
test("stackedBarChartSVG renders an svg with a rect per segment and the tip", () => {
  const bars = [
    { label: "Jun", tip: "Jun 2026 — Total €95", segments: [
      { value: 18, color: "#3d6b8c" }, { value: 77, color: "#4a7c59" }] },
    { label: "Jul", tip: "Jul 2026 — Total €8", segments: [
      { value: 0, color: "#3d6b8c" }, { value: 8, color: "#4a7c59" }] },
  ];
  const svg = KO.stackedBarChartSVG(bars, { width: 320, height: 160 });
  assert.match(svg, /^<svg /);
  assert.strictEqual((svg.match(/<rect/g) || []).length, 4); // 2 bars x 2 segments
  assert.match(svg, /data-tip="Jun 2026 — Total €95"/);
  assert.match(svg, /fill="#4a7c59"/);
  assert.match(svg, /fill="#3d6b8c"/);
  assert.match(svg, />Jun</);
});

test("stackedBarChartSVG escapes the tip text", () => {
  const svg = KO.stackedBarChartSVG(
    [{ label: "X", tip: "a & b <c>", segments: [{ value: 1, color: "#000" }] }], {});
  assert.match(svg, /data-tip="a &amp; b &lt;c&gt;"/);
  assert.doesNotMatch(svg, /data-tip="a & b <c>"/);
});

test("stackedBarChartSVG tolerates empty data", () => {
  const svg = KO.stackedBarChartSVG([], {});
  assert.match(svg, /^<svg /);
  assert.strictEqual((svg.match(/<rect/g) || []).length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `KO.stackedBarChartSVG is not a function`.

- [ ] **Step 3: Add the implementation**

In `lib.js`, add next to `barChartSVG`:

```javascript
  function stackedBarChartSVG(bars, opts) {
    opts = opts || {};
    const width = opts.width || 320;
    const height = opts.height || 160;
    const pad = 24;
    const chartH = height - pad * 2;
    const sums = bars.map(function (b) {
      return (b.segments || []).reduce(function (s, seg) { return s + seg.value; }, 0);
    });
    const max = sums.reduce(function (m, v) { return Math.max(m, v); }, 0) || 1;
    const n = bars.length;
    const slot = n > 0 ? (width - pad * 2) / n : 0;
    const barW = slot * 0.6;
    let out = "";
    bars.forEach(function (b, i) {
      const x = pad + slot * i + (slot - barW) / 2;
      let yCursor = pad + chartH; // bottom baseline
      const tip = escapeXml(b.tip || "");
      (b.segments || []).forEach(function (seg) {
        const h = (seg.value / max) * chartH;
        const y = yCursor - h;
        out += '<rect class="bar" data-tip="' + tip + '" style="cursor:pointer" x="' +
          x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) +
          '" height="' + Math.max(0, h).toFixed(1) + '" fill="' + seg.color +
          '"><title>' + tip + "</title></rect>";
        yCursor = y;
      });
      out += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (height - 6) +
        '" font-size="9" text-anchor="middle" fill="currentColor">' +
        escapeXml(b.label) + "</text>";
    });
    return '<svg viewBox="0 0 ' + width + " " + height +
      '" width="100%" role="img">' + out + "</svg>";
  }
```

- [ ] **Step 4: Export the function**

Add `stackedBarChartSVG` to the `return { ... }` object in `lib.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add stacked bar chart renderer to lib.js"
```

---

### Task 4: Rewire the Dashboard to the time window + split charts

**Files:**
- Modify: `index.html` — the `view-dashboard` IIFE (currently ~lines 595–666).

**Interfaces:**
- Consumes: all Task 1–3 functions; existing `KO.recentMonthKeys`, `KO.monthName`, `KO.outstandingByCustomer`, `KO.sizeById`, `KO.formatMoney`, `A.customerName`, `A.flavourName`, `A.esc`, `A.state.{deliveries,customers,settings}`.
- Produces: a window-driven dashboard. Replaces `A.current.dashMonth` with `A.current.dashWindow = { preset, startMk, endMk }` (default `preset: "this-month"`).

- [ ] **Step 1: Replace the dashboard render with window-aware logic**

Replace the body of the dashboard IIFE from `function currentMonthKey()` down to `A.renderers.dashboard = render;` (keep the `showTip` delegated-listener block and the two `addEventListener` lines for `pointerdown`/`click` exactly as they are — they still work for the new charts). New code:

```javascript
    const TYPE_COLORS = { private: "#3d6b8c", restaurant: "#4a7c59" };

    function currentMonthKey() {
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    }

    function resolveWindow(w) {
      const cur = currentMonthKey();
      if (w.preset === "last-month") { const p = KO.recentMonthKeys(cur, 2)[0]; return { startMk: p, endMk: p }; }
      if (w.preset === "this-year") { return { startMk: cur.slice(0, 4) + "-01", endMk: cur }; }
      if (w.preset === "custom") {
        let s = w.startMk || cur, e = w.endMk || cur;
        if (s > e) s = e;
        return { startMk: s, endMk: e };
      }
      return { startMk: cur, endMk: cur }; // this-month (default)
    }

    function euro(v) { return "€" + KO.formatMoney(v); }

    function legendHtml(items) {
      return `<div class="muted" style="margin-top:6px;font-size:12px">` +
        items.map((it) =>
          `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${it.color};margin:0 4px 0 10px;vertical-align:middle"></span>${A.esc(it.label)}`
        ).join("") + `</div>`;
    }

    function typeBars(rows, labelOf) {
      // rows: [{ private, restaurant, total, ... }]; labelOf(row) -> {label, tipLabel}
      return rows.map((r) => {
        const meta = labelOf(r);
        return {
          label: meta.label,
          tip: `${meta.tipLabel} — Private ${euro(r.private)} · Restaurant ${euro(r.restaurant)} · Total ${euro(r.total)}`,
          segments: [
            { value: r.private, color: TYPE_COLORS.private },
            { value: r.restaurant, color: TYPE_COLORS.restaurant },
          ],
        };
      });
    }

    function render() {
      const sizes = A.state.settings ? A.state.settings.sizes : [];
      const w = A.current.dashWindow || (A.current.dashWindow = { preset: "this-month" });
      const { startMk, endMk } = resolveWindow(w);
      const label = KO.windowLabel(startMk, endMk);

      const monthKeys = KO.monthKeysBetween(startMk, endMk);
      const typeSeries = KO.revenueTypeSeries(A.state.deliveries, sizes, A.state.customers, monthKeys);
      const winTotals = KO.revenueByTypeInWindow(A.state.deliveries, sizes, A.state.customers, startMk, endMk);
      const byCust = KO.revenueByCustomerInWindow(A.state.deliveries, sizes, startMk, endMk);
      const flavours = KO.flavourCountsInWindow(A.state.deliveries, startMk, endMk);
      const outstanding = KO.outstandingByCustomer(A.state.deliveries, sizes);
      const yearly = KO.revenueTypeByYear(A.state.deliveries, sizes, A.state.customers);

      const monthChart = KO.stackedBarChartSVG(
        typeBars(typeSeries, (r) => ({ label: KO.monthName(r.monthKey).slice(0, 3), tipLabel: KO.windowLabel(r.monthKey, r.monthKey) })),
        {});
      const yearChart = KO.stackedBarChartSVG(
        typeBars(yearly, (r) => ({ label: r.year, tipLabel: r.year })),
        {});
      const custChart = KO.barChartSVG(
        byCust.map((c) => ({ label: A.customerName(c.customerId).slice(0, 6), title: A.customerName(c.customerId), value: c.amount })),
        { format: euro });
      const typeLegend = legendHtml([
        { label: "Private", color: TYPE_COLORS.private },
        { label: "Restaurant", color: TYPE_COLORS.restaurant },
      ]);

      const isCustom = w.preset === "custom";
      container.innerHTML =
        `<div class="card"><label>Window</label>` +
          `<select id="dashPreset">` +
            `<option value="this-month" ${w.preset === "this-month" ? "selected" : ""}>This month</option>` +
            `<option value="last-month" ${w.preset === "last-month" ? "selected" : ""}>Last month</option>` +
            `<option value="this-year" ${w.preset === "this-year" ? "selected" : ""}>This year</option>` +
            `<option value="custom" ${isCustom ? "selected" : ""}>Custom range…</option>` +
          `</select>` +
          (isCustom ?
            `<div class="row"><div><label>Start</label><input id="dashStart" type="month" value="${startMk}"/></div>` +
            `<div><label>End</label><input id="dashEnd" type="month" value="${endMk}"/></div></div>` : "") +
          `<p class="muted" style="margin-top:6px">Showing: ${A.esc(label)}</p></div>` +
        `<div class="card"><h3>Revenue: ${euro(winTotals.total)}</h3>` +
          `<p class="muted">Private ${euro(winTotals.private)} · Restaurant ${euro(winTotals.restaurant)}</p>` +
          `<div class="chartwrap"><div class="chart-tip muted">Tap a bar to see its value</div>${monthChart}</div>` +
          typeLegend + `</div>` +
        `<div class="card"><h4>Yearly revenue (all years)</h4>` +
          (yearly.length ? `<div class="chartwrap"><div class="chart-tip muted">Tap a bar to see its value</div>${yearChart}</div>` + typeLegend
            : "<p class='muted'>No revenue yet.</p>") + `</div>` +
        `<div class="card"><h4>By customer</h4>` +
          (byCust.length ? `<div class="chartwrap"><div class="chart-tip muted">Tap a bar to see its value</div>${custChart}</div>` + "<table>" + byCust.map((c) =>
            `<tr><td>${A.esc(A.customerName(c.customerId))}</td><td>${euro(c.amount)}</td></tr>`).join("") + "</table>"
            : "<p class='muted'>No revenue in this window.</p>") + `</div>` +
        `<div class="card"><h4>Outstanding bottles & deposit</h4>` +
          (outstanding.length ? "<table><tr><th>Customer</th><th>Out</th><th>Deposit</th></tr>" +
            outstanding.map((o) =>
              `<tr><td>${A.esc(A.customerName(o.customerId))}</td>` +
              `<td>${Object.keys(o.perSize).map((sid) => { const s = KO.sizeById(sizes, sid); return o.perSize[sid] + "× " + A.esc(s ? s.label : sid); }).join(", ") || "0"}</td>` +
              `<td>${euro(o.depositHeld)}</td></tr>`).join("") + "</table>"
            : "<p class='muted'>Nothing outstanding.</p>") + `</div>` +
        `<div class="card"><h4>Flavour popularity (${A.esc(label)})</h4>` +
          (flavours.length ? "<table>" + flavours.map((f) =>
            `<tr><td>${A.esc(A.flavourName(f.flavourId))}</td><td>${f.quantity}</td></tr>`).join("") + "</table>"
            : "<p class='muted'>No deliveries in this window.</p>") + `</div>`;

      container.querySelector("#dashPreset").addEventListener("change", (e) => {
        A.current.dashWindow = { preset: e.target.value, startMk, endMk };
        render();
      });
      const startInp = container.querySelector("#dashStart");
      const endInp = container.querySelector("#dashEnd");
      if (startInp) startInp.addEventListener("change", (e) => {
        A.current.dashWindow = { preset: "custom", startMk: e.target.value, endMk };
        render();
      });
      if (endInp) endInp.addEventListener("change", (e) => {
        A.current.dashWindow = { preset: "custom", startMk, endMk: e.target.value };
        render();
      });
    }
```

(Note: the existing `showTip` function and its `container.addEventListener("pointerdown"/"click", showTip)` lines stay directly below, unchanged, followed by `A.renderers.dashboard = render;`.)

- [ ] **Step 2: Syntax-check the change**

Run:
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;while((m=re.exec(h))){const s=m[1];if(!s.trim()||/^\s*import\s/m.test(s))continue;i++;try{new Function(s)}catch(e){console.log("ERR",e.message);bad++}}console.log("classic blocks",i,"errors",bad)'
```
Expected: `classic blocks 7 errors 0`.

- [ ] **Step 3: Run the unit tests (guard against lib regressions)**

Run: `npm test`
Expected: PASS (all lib tests green; this task changed no lib code).

- [ ] **Step 4: Manual browser verification**

Run: `python3 -m http.server 8000`, open `http://localhost:8000`, log in as admin, open **Dashboard**. Verify:

- The window control shows a **preset dropdown** defaulting to **This month**, and a "Showing: <label>" line.
- **This month / Last month** → single stacked bar; **This year** → one bar per month Jan→current; **Custom range…** → reveals Start/End month pickers and recomputes for the chosen span.
- The **Revenue** card shows the window total, a "Private €X · Restaurant €Y" line, the **stacked monthly chart** with a **Private/Restaurant legend**, and tapping a bar shows `"<Month> — Private … · Restaurant … · Total …"` in the caption.
- The **Yearly revenue (all years)** card shows one stacked bar per year and does **not** change when you change the window.
- **By customer** and **Flavour popularity** recompute for the window (headings show the window label); **Outstanding** stays the same across windows.
- The old **"By customer type"** table is gone.
- No console errors; switching presets/pickers re-renders correctly.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: window-driven dashboard with split monthly + yearly revenue charts"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** A1 monthly split chart (Task 3 chart + Task 4 wiring), A2 window filter driving all stats (Task 1 + Task 4), A3 yearly split chart (Task 2 `revenueTypeByYear` + Task 4). By-type table removed (Task 4). Outstanding stays all-time; yearly ignores window (Task 4). ✓
- **Types consistent:** `revenueTypeSeries`/`revenueTypeByYear` return `{private,restaurant,total}` consumed by `typeBars`; `stackedBarChartSVG` consumes `{label,tip,segments:[{value,color}]}` produced by `typeBars`; window functions all take `(…, startMk, endMk)`. ✓
- **No placeholders.** All steps contain real code and exact commands.

## Notes for the implementer

- Only `lib.js` has an automated harness. Tasks 1–3 are true TDD; Task 4 is manual browser verification with the exact checks above.
- Keep the `showTip` tap-tip block and its listeners intact in Task 4 — the new charts rely on it via `data-tip`.
- Escape every data value interpolated into `innerHTML` with `A.esc(...)`.
- Firebase is untouched; nothing to deploy but the static site after merge.
```
