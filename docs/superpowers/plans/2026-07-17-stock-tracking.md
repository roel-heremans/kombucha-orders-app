# Available-to-Sell Stock & Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track sellable-bottle stock ("Available to sell", per size) from a dated physical count (stocktake), driven forward by production (adds) and deliveries (subtracts), and derive private consumption by reconciling each new stocktake against expected — replacing the rough produced−sold estimate.

**Architecture:** Pure tested helpers in `lib.js`; a new admin-only `stocktakes` collection with a rule; a data layer + CRUD; and additions to the existing Production-view IIFE (Available-to-sell card, Record-stocktake form, stocktakes/consumption list), removing the old produced−sold family line.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step), Firebase (Firestore + auth), `node --test`, GitHub Pages.

## Global Constraints

- No build step; single `index.html` + `lib.js` + CDN Firebase. No deps.
- Pure logic in `lib.js` (UMD return object) with tests in `test/lib.test.js`; run `npm test`.
- Firebase/DOM glue verified **manually in the browser**; rules verified in the Playground.
- Each view is its own `DOMContentLoaded` IIFE reading `window.APP` (A) and `window.KO` (KO).
- HTML built from data escaped with `A.esc(...)`.
- `stocktakes` is **admin-only** (not in restaurant data layer / not restaurant-readable).
- Stocktake doc shape: `{ date: "YYYY-MM-DD", counts: { sizeId: number, … }, createdAt }`.
- Date-range convention: events with `date > afterDate` (exclusive) and `date <= throughDate` (inclusive) count; same-day-as-stocktake events are considered already in the count. `"YYYY-MM-DD"` strings compare correctly.
- Production maps to canonical size ids **`1L`** (`+bottled1L −used1L`) and **`270ml`** (`+count270`).

---

### Task 1: Stock helpers in `lib.js`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

**Interfaces (produced):** `KO.producedPerSize`, `KO.deliveredPerSize`, `KO.latestStocktake`, `KO.availableToSell`, `KO.consumptionPeriods`, `KO.sumConsumption` (signatures below). Reuses `sizeById` (existing).

- [ ] **Step 1: Write the failing tests**

Append to `test/lib.test.js` (reuse the existing `BATCHES` fixture; add these):

```javascript
const STOCKTAKES = [
  { date: "2026-06-01", counts: { "1L": 20, "270ml": 5 } },
  { date: "2026-07-01", counts: { "1L": 40, "270ml": 8 } },
];
const PROD_DELIVS = [
  { date: "2026-06-20", items: [{ sizeId: "1L", flavourId: "x", quantity: 10 }] },
  { date: "2026-06-25", items: [{ sizeId: "270ml", flavourId: "y", quantity: 3 },
                                { sizeId: "1L", flavourId: "z", quantity: 5 }] },
  { date: "2026-07-05", items: [{ sizeId: "1L", flavourId: "x", quantity: 30 }] },
];

test("producedPerSize: bottled1L − used1L and count270, exclusive start / inclusive end", () => {
  assert.deepStrictEqual(KO.producedPerSize(BATCHES, "2026-06-01", "2026-07-01"), { "1L": 56, "270ml": 8 });
  assert.deepStrictEqual(KO.producedPerSize(BATCHES, "2026-07-01", null), { "1L": 37, "270ml": 8 });
});

test("deliveredPerSize sums delivered quantity per size in range", () => {
  assert.deepStrictEqual(KO.deliveredPerSize(PROD_DELIVS, "2026-06-01", "2026-07-01"), { "1L": 15, "270ml": 3 });
  assert.deepStrictEqual(KO.deliveredPerSize(PROD_DELIVS, "2026-07-01", null), { "1L": 30 });
});

test("latestStocktake picks the greatest date <= asOf, or null", () => {
  assert.strictEqual(KO.latestStocktake([], null), null);
  assert.strictEqual(KO.latestStocktake(STOCKTAKES, null).date, "2026-07-01");
  assert.strictEqual(KO.latestStocktake(STOCKTAKES, "2026-06-15").date, "2026-06-01");
});

test("availableToSell = latest stocktake + produced − delivered since; null if none", () => {
  assert.strictEqual(KO.availableToSell([], BATCHES, PROD_DELIVS), null);
  assert.deepStrictEqual(KO.availableToSell(STOCKTAKES, BATCHES, PROD_DELIVS), { "1L": 47, "270ml": 16 });
});

test("consumptionPeriods reconciles expected − actual per interval; [] for <2", () => {
  assert.deepStrictEqual(KO.consumptionPeriods([STOCKTAKES[0]], BATCHES, PROD_DELIVS), []);
  const periods = KO.consumptionPeriods(STOCKTAKES, BATCHES, PROD_DELIVS);
  assert.strictEqual(periods.length, 1);
  assert.deepStrictEqual(periods[0], {
    fromDate: "2026-06-01", toDate: "2026-07-01", consumed: { "1L": 21, "270ml": 2 } });
});

test("sumConsumption folds periods per size", () => {
  const periods = KO.consumptionPeriods(STOCKTAKES, BATCHES, PROD_DELIVS);
  assert.deepStrictEqual(KO.sumConsumption(periods), { "1L": 21, "270ml": 2 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — Expected: FAIL (`KO.producedPerSize is not a function`, etc.).

- [ ] **Step 3: Add the implementation**

In `lib.js`, add after `productionSummary`:

```javascript
  function producedPerSize(batches, afterDate, throughDate) {
    const inR = function (d) { return d && (!afterDate || d > afterDate) && (!throughDate || d <= throughDate); };
    let n1L = 0, made270 = 0;
    (batches || []).forEach(function (b) {
      if (b && b.step4 && inR(b.step4.date)) n1L += b.step4.bottles1L || 0;
      ((b && b.conversions) || []).forEach(function (c) {
        if (c && inR(c.date)) { n1L -= c.used1L || 0; made270 += c.count270 || 0; }
      });
    });
    return { "1L": n1L, "270ml": made270 };
  }

  function deliveredPerSize(deliveries, afterDate, throughDate) {
    const inR = function (d) { return d && (!afterDate || d > afterDate) && (!throughDate || d <= throughDate); };
    const by = {};
    (deliveries || []).forEach(function (dv) {
      if (!inR(dv.date)) return;
      (dv.items || []).forEach(function (it) { by[it.sizeId] = (by[it.sizeId] || 0) + (it.quantity || 0); });
    });
    return by;
  }

  function latestStocktake(stocktakes, asOfDate) {
    let best = null;
    (stocktakes || []).forEach(function (s) {
      if (!s || !s.date) return;
      if (asOfDate && s.date > asOfDate) return;
      if (!best || s.date > best.date) best = s;
    });
    return best;
  }

  function availableToSell(stocktakes, batches, deliveries) {
    const base = latestStocktake(stocktakes, null);
    if (!base) return null;
    const produced = producedPerSize(batches, base.date, null);
    const delivered = deliveredPerSize(deliveries, base.date, null);
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
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    const periods = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i];
      const produced = producedPerSize(batches, prev.date, cur.date);
      const delivered = deliveredPerSize(deliveries, prev.date, cur.date);
      const pc = prev.counts || {}, cc = cur.counts || {};
      const keys = {};
      [pc, cc, produced, delivered].forEach(function (m) { Object.keys(m).forEach(function (k) { keys[k] = true; }); });
      const consumed = {};
      Object.keys(keys).forEach(function (sid) {
        const expected = (pc[sid] || 0) + (produced[sid] || 0) - (delivered[sid] || 0);
        consumed[sid] = expected - (cc[sid] || 0);
      });
      periods.push({ fromDate: prev.date, toDate: cur.date, consumed: consumed });
    }
    return periods;
  }

  function sumConsumption(periods) {
    const out = {};
    (periods || []).forEach(function (p) {
      Object.keys(p.consumed || {}).forEach(function (sid) { out[sid] = (out[sid] || 0) + p.consumed[sid]; });
    });
    return out;
  }
```

- [ ] **Step 4: Export them**

Add `producedPerSize, deliveredPerSize, latestStocktake, availableToSell, consumptionPeriods, sumConsumption` to the `return { ... }` object in `lib.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add stock/available-to-sell + consumption helpers to lib.js"
```

---

### Task 2: Firestore rule for stocktakes (admin-only)

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Add the match block**

In `firestore.rules`, after the `match /batches/{id} { ... }` block, add:

```
    match /stocktakes/{id} {
      allow read, write: if isAdmin();
    }
```

- [ ] **Step 2: Deploy (manual — human)**

In Firebase Console → Firestore → Rules, paste the full updated file and **Publish**. Performed by the controller/human.

- [ ] **Step 3: Verify (manual — human)**

Playground: admin email → `get`/`create` on `/stocktakes/x` = Allowed; a non-admin authenticated uid → `get` on `/stocktakes/x` = Denied.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat: admin-only Firestore rule for stocktakes"
```

---

### Task 3: Stocktakes data layer + CRUD

**Files:**
- Modify: `index.html` — module script: `stocktakes: []` in state, `watch("stocktakes", S.stocktakes)` in admin `onLogin`, `addStocktake`/`deleteStocktake` helpers.

**Interfaces (produced):** `S.stocktakes`; `A.addStocktake(o)`→Promise(ref), `A.deleteStocktake(id)`→Promise.

- [ ] **Step 1: Add stocktakes to state**

In `window.APP = { … state: { … } … }`, add `stocktakes: []` (next to `batches: []`).

- [ ] **Step 2: Watch stocktakes (admin)**

In `window.APP.onLogin`, next to `watch("batches", S.batches)`, add:

```javascript
      watch("stocktakes", S.stocktakes);
```

- [ ] **Step 3: Add CRUD helpers**

Near the batch CRUD helpers, add:

```javascript
    window.APP.addStocktake = (o) => addDoc(collection(db, "stocktakes"), o);
    window.APP.deleteStocktake = (id) => deleteDoc(doc(db, "stocktakes", id));
```

- [ ] **Step 4: Syntax-check + tests**

Run the inline-script syntax check (expected `classic blocks N errors 0`) and `npm test` (green). Command:
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;while((m=re.exec(h))){const s=m[1];if(!s.trim()||/^\s*import\s/m.test(s))continue;i++;try{new Function(s)}catch(e){console.log("ERR",e.message);bad++}}console.log("classic blocks",i,"errors",bad)'
```

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: stocktakes data layer + CRUD helpers"
```

---

### Task 4: Production view — Available to sell + stocktakes + consumption

**Files:**
- Modify: `index.html` — the Production view IIFE (`view-production`): remove the old family line; add helpers + the three stock cards + handlers.

**Interfaces:** consumes `KO.availableToSell`, `KO.latestStocktake`, `KO.consumptionPeriods`, `KO.sumConsumption`, `KO.sizeLiters`; `A.addStocktake`/`deleteStocktake`, `A.state.stocktakes`, `A.state.batches`, `A.state.deliveries`, `A.state.settings.sizes`, `A.serverTimestamp`, `A.esc`.

- [ ] **Step 1: Add `todayStr` + `stRow` helpers to the IIFE**

Near the top of the Production IIFE (after `currentMonthKey`), add:

```javascript
    function todayStr() {
      const d = new Date(); const off = d.getTimezoneOffset();
      return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
    }
    function stRow(st, periods, sizes) {
      const countsStr = sizes.map((s) => `${A.esc(s.label)}: ${(st.counts && st.counts[s.id]) || 0}`).join(" · ");
      const period = periods.find((p) => p.toDate === st.date);
      const consStr = period ? " · consumed " + sizes.map((s) => `${A.esc(s.label)}: ${period.consumed[s.id] || 0}`).join(" · ") : "";
      return `<div class="row" style="justify-content:space-between"><div>` +
        `<strong>${A.esc(st.date)}</strong> — ${countsStr}<span class="muted">${consStr}</span></div>` +
        `<button class="link" data-delst="${st.id}">Delete</button></div>`;
    }
```

- [ ] **Step 2: Remove the family line and compute stock figures in `render()`**

In `render()`, delete the line:

```javascript
      const family = sum.bottled1L - soldL;
```

and after `const batches = …`, add:

```javascript
      const avail = KO.availableToSell(A.state.stocktakes, A.state.batches, A.state.deliveries);
      const baseSt = KO.latestStocktake(A.state.stocktakes, null);
      const periods = KO.consumptionPeriods(A.state.stocktakes, A.state.batches, A.state.deliveries);
      const consumedTotal = KO.sumConsumption(periods);
      const consumedL = sizes.reduce((sum2, s) => sum2 + KO.sizeLiters(s) * (consumedTotal[s.id] || 0), 0);
      const stTakes = A.state.stocktakes.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
```

- [ ] **Step 3: Update the Produced card and insert the stock cards**

In the `container.innerHTML = …`, replace the Produced card block:

```javascript
        `<div class="card"><h4>Produced (${A.esc(label)})</h4>` +
          `<p>1 L bottled: <strong>${sum.bottled1L}</strong> · 270 ml made: <strong>${sum.made270}</strong> · 1 L used for 270 ml: <strong>${sum.used1L}</strong></p>` +
          `<p>Sold: <strong>${litres(soldL)}</strong> · Family consumption (produced − sold): <strong>${litres(family)}</strong></p>` +
          `<p class="muted">Family consumption is most meaningful over a wide window (This year, or a custom range covering all batches).</p></div>` +
```

with (drop the family line; add the three stock cards right after):

```javascript
        `<div class="card"><h4>Produced (${A.esc(label)})</h4>` +
          `<p>1 L bottled: <strong>${sum.bottled1L}</strong> · 270 ml made: <strong>${sum.made270}</strong> · 1 L used for 270 ml: <strong>${sum.used1L}</strong></p>` +
          `<p>Sold: <strong>${litres(soldL)}</strong></p></div>` +
        `<div class="card"><h4>Available to sell</h4>` +
          (avail
            ? `<p>` + sizes.map((s) => `${A.esc(s.label)}: <strong>${avail[s.id] != null ? avail[s.id] : 0}</strong>`).join(" · ") + `</p>` +
              `<p class="muted">Expected as of the stocktake on ${A.esc(baseSt.date)}, plus bottling minus deliveries since.</p>`
            : `<p class="muted">Record a stocktake below to start tracking available stock and consumption.</p>`) + `</div>` +
        `<div class="card"><h4>Record stocktake</h4>` +
          `<p class="muted">Count the sellable bottles on the sill per size and save. Consumption is reconciled against your previous stocktake.</p>` +
          sizes.map((s) => `<div class="row"><div><label>${A.esc(s.label)}</label><input class="st-count" data-size="${s.id}" type="number" min="0" value=""/></div></div>`).join("") +
          `<label>Date</label><input id="stDate" type="date" value="${todayStr()}"/>` +
          `<p id="stMsg" class="muted"></p>` +
          `<button class="primary" id="stSave">Save stocktake</button></div>` +
        `<div class="card"><h4>Stocktakes &amp; consumption</h4>` +
          (stTakes.length
            ? (periods.length
                ? `<p>Total private consumption: <strong>` + sizes.map((s) => `${A.esc(s.label)}: ${consumedTotal[s.id] || 0}`).join(" · ") + `</strong> · ${litres(consumedL)}</p>`
                : `<p class="muted">Record a second stocktake to see consumption.</p>`) +
              stTakes.map((st) => stRow(st, periods, sizes)).join("")
            : "<p class='muted'>No stocktakes yet.</p>") + `</div>` +
```

(The `➕ New batch` card and batch list that follow stay unchanged.)

- [ ] **Step 4: Wire the stocktake handlers**

In `render()`, after the batch handlers (near the end, before the `const form = …` block or after it), add:

```javascript
      const stSave = container.querySelector("#stSave");
      if (stSave) stSave.addEventListener("click", async () => {
        const date = container.querySelector("#stDate").value;
        const setMsg = (t) => { const m = container.querySelector("#stMsg"); if (m) m.textContent = t; };
        if (!date) { setMsg("Choose a date."); return; }
        const counts = {};
        container.querySelectorAll(".st-count").forEach((i) => { counts[i.dataset.size] = parseInt(i.value, 10) || 0; });
        stSave.disabled = true; setMsg("Saving…");
        try {
          await A.addStocktake({ date, counts, createdAt: A.serverTimestamp() });
          const m = container.querySelector("#stMsg"); if (m) m.textContent = "Saved ✓";
        } catch (ex) {
          const m = container.querySelector("#stMsg"); if (m) m.textContent = "Save failed: " + (ex.code || ex.message);
          const b = container.querySelector("#stSave"); if (b) b.disabled = false;
        }
      });
      container.querySelectorAll("[data-delst]").forEach((b) =>
        b.addEventListener("click", async () => { if (confirm("Delete this stocktake?")) await A.deleteStocktake(b.dataset.delst); }));
```

- [ ] **Step 5: Syntax-check + tests**

Run the inline-script syntax check (expected `classic blocks 8 errors 0`) and `npm test` (green — no lib change here).

- [ ] **Step 6: Manual verification (deferred to controller/human — needs live Firebase + rules deployed)**

As admin, open **Production**. Verify: with no stocktake, "Available to sell" prompts to record one; **Record stocktake** (counts per size + date) saves and appears in "Stocktakes & consumption". **Available to sell** then shows the counts; add a batch (bottling) + a delivery dated after the stocktake → Available rises by bottled and falls by delivered. Record a **second** stocktake below expected → the interval shows `consumed` per size and **Total private consumption** (per size + liters) reflects the gap. The old "Family consumption (produced − sold)" line is gone. **Delete** a stocktake works. A **restaurant** login cannot access Production/stocktakes.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: Production — available-to-sell stock, stocktakes, reconciled consumption"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** stock helpers incl. reconciliation (Task 1); admin-only rule (Task 2) + data layer (Task 3); Available-to-sell card + record/delete stocktake + consumption list, old produced−sold line removed (Task 4). ✓
- **Types consistent:** `availableToSell`/`consumptionPeriods` return maps keyed by sizeId consumed by the view over `A.state.settings.sizes`; `addStocktake({date,counts,createdAt})` matches the stocktake shape read by the helpers. ✓
- **No placeholders.** Full code + commands throughout.

## Notes for the implementer

- Only `lib.js` is unit-tested (Task 1 TDD). Tasks 3–4 are browser-verified; Task 2 is a rules change. Tasks 2 & 4 manual verification touch live Firebase (controller/human).
- Empties/returns are NOT stock — only delivery `items` subtract. Production feeds only `1L`/`270ml`.
- Escape every interpolated data value with `A.esc(...)`; counts are numbers.
```
