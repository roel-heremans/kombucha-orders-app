# Time-precise Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Order the stock reconciliation by date + time (not just day). Each stock-affecting action (delivery, stocktake, bottling, 270 ml conversion) gains a `time`; the lib compares "moments"; the UI adds time inputs defaulting to now.

**Architecture:** `lib.js` gains `actionMoment(rec)` and the 5 stock functions compare moments instead of dates (backward-compatible: date-only data behaves identically via `T00:00`). The delivery form and production view add `time` inputs and store the field.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step), `node --test`, GitHub Pages. No Firebase rules/schema-migration needed (new fields on admin-only collections).

## Global Constraints

- No build step; `index.html` + `lib.js`. No deps.
- Pure logic in `lib.js` (UMD return object) with tests in `test/lib.test.js`; run `npm test`.
- `date` stays "YYYY-MM-DD" (day-based views unchanged); `time` is "HH:MM".
- A record's **moment** = `date + "T" + (time || "00:00")`; string comparison is chronological. Missing `time` → `00:00`.
- Stock functions (`producedPerSize`, `deliveredPerSize`, `latestStocktake`, `availableToSell`, `consumptionPeriods`) compare moments; `producedPerSize`/`deliveredPerSize` args are moments.
- Only the stock reconciliation uses time; dashboard/recibo/revenue keep using `date`.
- Escape data in `innerHTML` with `A.esc(...)`.

---

### Task 1: Moment-based reconciliation in `lib.js`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

**Interfaces (produced):** `KO.actionMoment(rec)` (exported); the 5 stock functions now compare moments; `consumptionPeriods` entries carry `toMoment`.

- [ ] **Step 1: Update the tests**

In `test/lib.test.js`:

(a) **Replace** the existing `producedPerSize` and `deliveredPerSize` direct tests' argument dates with moments (append `T00:00`), and update the boundary test similarly:

```javascript
test("producedPerSize: bottled1L − used1L and count270, exclusive start / inclusive end", () => {
  assert.deepStrictEqual(KO.producedPerSize(BATCHES, "2026-06-01T00:00", "2026-07-01T00:00"), { "1L": 56, "270ml": 8 });
  assert.deepStrictEqual(KO.producedPerSize(BATCHES, "2026-07-01T00:00", null), { "1L": 37, "270ml": 8 });
});

test("deliveredPerSize sums delivered quantity per size in range", () => {
  assert.deepStrictEqual(KO.deliveredPerSize(PROD_DELIVS, "2026-06-01T00:00", "2026-07-01T00:00"), { "1L": 15, "270ml": 3 });
  assert.deepStrictEqual(KO.deliveredPerSize(PROD_DELIVS, "2026-07-01T00:00", null), { "1L": 30 });
});

test("date-range boundaries: event on afterMoment excluded, on throughMoment included", () => {
  const b = [
    { number: 9, step4: { bottles1L: 10, date: "2026-06-01" } },  // moment 2026-06-01T00:00 == after → excluded
    { number: 10, step4: { bottles1L: 7, date: "2026-07-01" } },  // moment 2026-07-01T00:00 == through → included
  ];
  assert.deepStrictEqual(KO.producedPerSize(b, "2026-06-01T00:00", "2026-07-01T00:00"), { "1L": 7, "270ml": 0 });
  const dv = [
    { date: "2026-06-01", items: [{ sizeId: "1L", flavourId: "a", quantity: 4 }] },
    { date: "2026-07-01", items: [{ sizeId: "1L", flavourId: "a", quantity: 3 }] },
  ];
  assert.deepStrictEqual(KO.deliveredPerSize(dv, "2026-06-01T00:00", "2026-07-01T00:00"), { "1L": 3 });
});
```

(b) **Replace** the `consumptionPeriods reconciles…` test to expect the new `toMoment`:

```javascript
test("consumptionPeriods reconciles expected − actual per interval; [] for <2", () => {
  assert.deepStrictEqual(KO.consumptionPeriods([STOCKTAKES[0]], BATCHES, PROD_DELIVS), []);
  const periods = KO.consumptionPeriods(STOCKTAKES, BATCHES, PROD_DELIVS);
  assert.strictEqual(periods.length, 1);
  assert.deepStrictEqual(periods[0], {
    fromDate: "2026-06-01", toDate: "2026-07-01", toMoment: "2026-07-01T00:00",
    consumed: { "1L": 21, "270ml": 2 } });
});
```

(c) **Add** `actionMoment` + same-day ordering tests:

```javascript
test("actionMoment combines date + time, defaults time to 00:00", () => {
  assert.strictEqual(KO.actionMoment({ date: "2026-08-01", time: "18:30" }), "2026-08-01T18:30");
  assert.strictEqual(KO.actionMoment({ date: "2026-08-01" }), "2026-08-01T00:00");
  assert.strictEqual(KO.actionMoment({}), "");
});

test("reconciliation orders same-day actions by time", () => {
  const sts = [
    { date: "2026-08-01", time: "08:00", counts: { "1L": 10 } },
    { date: "2026-08-01", time: "18:00", counts: { "1L": 12 } },
  ];
  const before = [{ date: "2026-08-01", time: "14:00", items: [{ sizeId: "1L", quantity: 3 }] }]; // between 08:00 and 18:00
  assert.deepStrictEqual(KO.consumptionPeriods(sts, [], before)[0].consumed, { "1L": -5, "270ml": 0 }); // 10−3 expected=7, counted 12 → −5
  const after = [{ date: "2026-08-01", time: "20:00", items: [{ sizeId: "1L", quantity: 3 }] }];       // after the 18:00 count
  assert.deepStrictEqual(KO.consumptionPeriods(sts, [], after)[0].consumed, { "1L": -2, "270ml": 0 });  // delivery excluded → 10, counted 12 → −2
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — Expected: FAIL (`KO.actionMoment is not a function`, and the refactor-dependent assertions).

- [ ] **Step 3: Refactor the stock functions to moments**

In `lib.js`, add `actionMoment` and replace the five functions' internals so they compare `actionMoment(...)`:

```javascript
  function actionMoment(rec) {
    return rec && rec.date ? rec.date + "T" + (rec.time || "00:00") : "";
  }

  function producedPerSize(batches, afterMoment, throughMoment) {
    const inR = function (m) { return m && (!afterMoment || m > afterMoment) && (!throughMoment || m <= throughMoment); };
    let n1L = 0, made270 = 0;
    (batches || []).forEach(function (b) {
      if (b && b.step4 && inR(actionMoment(b.step4))) n1L += b.step4.bottles1L || 0;
      ((b && b.conversions) || []).forEach(function (c) {
        if (c && inR(actionMoment(c))) { n1L -= c.used1L || 0; made270 += c.count270 || 0; }
      });
    });
    return { "1L": n1L, "270ml": made270 };
  }

  function deliveredPerSize(deliveries, afterMoment, throughMoment) {
    const inR = function (m) { return m && (!afterMoment || m > afterMoment) && (!throughMoment || m <= throughMoment); };
    const by = {};
    (deliveries || []).forEach(function (dv) {
      if (!inR(actionMoment(dv))) return;
      (dv.items || []).forEach(function (it) { by[it.sizeId] = (by[it.sizeId] || 0) + (it.quantity || 0); });
    });
    return by;
  }

  function latestStocktake(stocktakes, asOfMoment) {
    let best = null, bestM = "";
    (stocktakes || []).forEach(function (s) {
      const m = actionMoment(s);
      if (!m) return;
      if (asOfMoment && m > asOfMoment) return;
      if (!best || m > bestM) { best = s; bestM = m; }
    });
    return best;
  }

  function availableToSell(stocktakes, batches, deliveries) {
    const base = latestStocktake(stocktakes, null);
    if (!base) return null;
    const baseM = actionMoment(base);
    const produced = producedPerSize(batches, baseM, null);
    const delivered = deliveredPerSize(deliveries, baseM, null);
    const counts = base.counts || {};
    const keys = {};
    [counts, produced, delivered].forEach(function (m) { Object.keys(m).forEach(function (k) { keys[k] = true; }); });
    const out = {};
    Object.keys(keys).forEach(function (sid) {
      out[sid] = (counts[sid] || 0) + (produced[sid] || 0) - (delivered[sid] || 0);
    });
    return out;
  }

  function consumptionPeriods(stocktakes, batches, deliveries) {
    const sorted = (stocktakes || []).filter(function (s) { return s && s.date; })
      .slice().sort(function (a, b) { const ma = actionMoment(a), mb = actionMoment(b); return ma < mb ? -1 : ma > mb ? 1 : 0; });
    const periods = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i];
      const produced = producedPerSize(batches, actionMoment(prev), actionMoment(cur));
      const delivered = deliveredPerSize(deliveries, actionMoment(prev), actionMoment(cur));
      const pc = prev.counts || {}, cc = cur.counts || {};
      const keys = {};
      [pc, cc, produced, delivered].forEach(function (m) { Object.keys(m).forEach(function (k) { keys[k] = true; }); });
      const consumed = {};
      Object.keys(keys).forEach(function (sid) {
        const expected = (pc[sid] || 0) + (produced[sid] || 0) - (delivered[sid] || 0);
        consumed[sid] = expected - (cc[sid] || 0);
      });
      periods.push({ fromDate: prev.date, toDate: cur.date, toMoment: actionMoment(cur), consumed: consumed });
    }
    return periods;
  }
```

(`sumConsumption` is unchanged.)

- [ ] **Step 4: Export `actionMoment`**

Add `actionMoment` to the `return { ... }` object in `lib.js` (the other five are already exported).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` — Expected: PASS (the updated + new tests, and the unchanged `availableToSell`/`sumConsumption`/`latestStocktake` tests).

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: order stock reconciliation by date+time (actionMoment)"
```

---

### Task 2: Time on deliveries (delivery form)

**Files:**
- Modify: `index.html` — the delivery-form IIFE: add a `nowTime()` helper, a Time input in `buildForm`, `time` in `readForm`, populate in `A.editDelivery`; and the deliveries-list view to show the time.

- [ ] **Step 1: Add `nowTime()` to the delivery-form IIFE**

Next to `todayStr()` in the delivery-form IIFE, add:

```javascript
    function nowTime() {
      const d = new Date();
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    }
```

- [ ] **Step 2: Add the Time input in `buildForm`**

Replace the date line:

```javascript
        `<label>Date</label><input id="date" type="date" value="${todayStr()}"/>` +
```

with a date + time row:

```javascript
        `<div class="row"><div><label>Date</label><input id="date" type="date" value="${todayStr()}"/></div>` +
        `<div><label>Time</label><input id="dtime" type="time" value="${nowTime()}"/></div></div>` +
```

- [ ] **Step 3: Include `time` in `readForm`**

In the delivery-form `readForm` return object, add `time`:

```javascript
      return {
        customerId: container.querySelector("#cust").value,
        date: container.querySelector("#date").value,
        time: container.querySelector("#dtime").value,
        items, empties,
        note: container.querySelector("#note").value.trim(),
      };
```

- [ ] **Step 4: Populate the time when editing**

In `A.editDelivery`, right after the line `container.querySelector("#date").value = d.date;`, add:

```javascript
      container.querySelector("#dtime").value = d.time || "";
```

(`A.fulfilOrder` leaves `#dtime` at its `nowTime()` default — fulfilment time = now — which is correct.)

- [ ] **Step 5: Show the time in the Deliveries list**

In the deliveries-list view, change:

```javascript
        `<strong>${A.esc(A.customerName(d.customerId))}</strong> — ${d.date}<br/>` +
```

to:

```javascript
        `<strong>${A.esc(A.customerName(d.customerId))}</strong> — ${d.date}${d.time ? " " + A.esc(d.time) : ""}<br/>` +
```

- [ ] **Step 6: Syntax-check + tests**

Run the inline-script syntax check (expected `classic blocks 8 errors 0`) and `npm test` (green):
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;while((m=re.exec(h))){const s=m[1];if(!s.trim()||/^\s*import\s/m.test(s))continue;i++;try{new Function(s)}catch(e){console.log("ERR",e.message);bad++}}console.log("classic blocks",i,"errors",bad)'
```

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: capture delivery time (default now) for time-precise inventory"
```

---

### Task 3: Time on stocktakes + production (production view)

**Files:**
- Modify: `index.html` — the production IIFE: `nowTime()` helper; Time on the stocktake form + save; Time on batch Step 4 + conversion rows + batch `readForm`; `stRow` matches its period by `toMoment` and shows the time.

- [ ] **Step 1: Add `nowTime()` to the production IIFE**

Next to `todayStr()` in the production IIFE, add:

```javascript
    function nowTime() {
      const d = new Date();
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    }
```

- [ ] **Step 2: Time on the conversion row (`convRowHtml`)**

Add a Time input after the `cv-date` div:

```javascript
        `<div><label>Date</label><input class="cv-date" type="date" value="${A.esc(c.date || "")}"/></div>` +
        `<div><label>Time</label><input class="cv-time" type="time" value="${A.esc(c.time || (c.date ? "" : nowTime()))}"/></div>` +
```

- [ ] **Step 3: Time on Step 4 (`batchEditCard`)**

Change the Step 4 date div to add a Time input:

```javascript
        `<div><label>Date</label><input id="bDate4" type="date" value="${A.esc(s4.date || "")}"/></div>` +
        `<div><label>Time</label><input id="bTime4" type="time" value="${A.esc(s4.time || (s4.date ? "" : nowTime()))}"/></div></div>` +
```

(The `</div>` that closed the Step-4 row moves to the end of the new Time div, as shown.)

- [ ] **Step 4: Include times in the batch `readForm`**

Update the conversions push and `step4`:

```javascript
        if (date && count270 > 0) convs.push({ count270, used1L, date, time: r.querySelector(".cv-time").value });
```

and

```javascript
        step4: { bottles1L: numOr0("#bBottles"), date: val("#bDate4"), time: val("#bTime4") },
```

- [ ] **Step 5: Time on the stocktake form + save**

Change the stocktake date line to a date + time row:

```javascript
          `<div class="row"><div><label>Date</label><input id="stDate" type="date" value="${todayStr()}"/></div>` +
          `<div><label>Time</label><input id="stTime" type="time" value="${nowTime()}"/></div></div>` +
```

and in the `#stSave` handler include `time`:

```javascript
        const date = container.querySelector("#stDate").value;
        const time = container.querySelector("#stTime").value;
        ...
          await A.addStocktake({ date, time, counts, createdAt: A.serverTimestamp() });
```

- [ ] **Step 6: `stRow` — match by moment, show the time**

Replace `stRow`'s period lookup + date display:

```javascript
    function stRow(st, periods, sizes) {
      const countsStr = sizes.map((s) => `${A.esc(s.label)}: ${(st.counts && st.counts[s.id]) || 0}`).join(" · ");
      const period = periods.find((p) => p.toMoment === KO.actionMoment(st));
      const consStr = period ? " · consumed " + sizes.map((s) => `${A.esc(s.label)}: ${period.consumed[s.id] || 0}`).join(" · ") : "";
      return `<div class="row" style="justify-content:space-between"><div>` +
        `<strong>${A.esc(st.date)}${st.time ? " " + A.esc(st.time) : ""}</strong> — ${countsStr}<span class="muted">${consStr}</span></div>` +
        `<button class="link" data-delst="${st.id}">Delete</button></div>`;
    }
```

- [ ] **Step 7: Syntax-check + tests**

Run the inline-script syntax check (expected `classic blocks 8 errors 0`) and `npm test` (green).

- [ ] **Step 8: Manual verification (deferred to controller/human — needs live Firebase)**

As admin: on the **New** delivery form and **Production** (stocktake + batch Step 4 + a 270 ml conversion), each shows a Time box pre-filled with now. Record a stocktake at (say) 08:00, a delivery at 14:00, another stocktake at 18:00, all the same day → Available to sell + the consumption interval reflect the delivery as *inside* that interval; redo with the delivery at 20:00 → it falls *after* and the numbers change. Editing a delivery/batch shows the saved time; the Deliveries list and stocktake rows show times. Dashboard/recibo unaffected. Old records (no time) still reconcile.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "feat: capture stocktake + production times; match consumption by moment"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** `actionMoment` + moment refactor + `toMoment` (Task 1); delivery time (Task 2); stocktake + bottling + conversion times, moment-based `stRow` (Task 3). ✓
- **Types consistent:** stock functions compare `actionMoment(...)`; `producedPerSize`/`deliveredPerSize` take moments; `consumptionPeriods.toMoment` matched by `KO.actionMoment(st)` in `stRow`; `time` stored on delivery/stocktake/step4/conversion, read back by the same forms. ✓
- **No placeholders.** Full code + commands throughout.

## Notes for the implementer

- Only `lib.js` is unit-tested (Task 1 TDD). Tasks 2–3 are browser-verified against live Firebase (adding fields — no rules change).
- Backward-compat is the crux: date-only records → `T00:00`, so day-based views and the unchanged higher-level tests keep working; only the direct `producedPerSize`/`deliveredPerSize` test args move to moments (+ the new time tests).
- Keep every date/time value escaped with `A.esc` where interpolated; `<input type="time">` holds "HH:MM".
```
