# Production / Fermentation Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin-only Production tab to log kombucha batches (Batch 001, 002…) through their 4 steps + 270 ml conversions, with a windowed summary of how much was made, sold, and consumed by the family (produced − sold).

**Architecture:** Pure batch/liters helpers in `lib.js` (unit-tested); a new admin-only `batches` Firestore collection with role rules; a `view-production` IIFE with a time-window control (reusing the dashboard window helpers), a windowed summary, and per-batch read/edit cards including a 270 ml conversion editor.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step), Firebase (Firestore + auth), `node --test`, GitHub Pages.

## Global Constraints

- No build step; single `index.html` + `lib.js` + CDN Firebase. No bundlers/npm runtime deps.
- Pure, testable logic in `lib.js` (UMD return object) with tests in `test/lib.test.js`; run `npm test` (`node --test`).
- Firebase/DOM glue verified **manually in the browser** (no DOM harness).
- Each view is its own `DOMContentLoaded` IIFE reading `window.APP` (alias `A`) and `window.KO` (alias `KO`).
- HTML built from data escaped with `A.esc(...)`.
- `batches` is **admin-only** (not in the restaurant data layer, not readable/writable by restaurants).
- Batch doc shape: `{ number, step1:{waterLiters,date}, step2:{jars,date}, step3:{date}, step4:{bottles1L,date}, conversions:[{count270,used1L,date}], createdAt }`. All step objects/fields optional; the view reads defensively.
- Reuse the existing window helpers: `KO.resolveWindow`, `KO.windowLabel`, `KO.inWindow`.
- The Production window state is its own `A.current.prodWindow = { preset, startMk, endMk }` (independent of the dashboard), default `this-month`.

---

### Task 1: Production + liters helpers in `lib.js`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

**Interfaces (produced):**
- `KO.nextBatchNumber(batches)` → `max(number) + 1` (or 1 if none).
- `KO.formatBatchNumber(n)` → `"Batch " + zero-pad-3` (`"Batch 001"`, no truncation ≥1000).
- `KO.bottles1LForConversion(count270)` → `Math.ceil(count270 * 270 / 1000)`.
- `KO.sizeLiters(size)` → liters of one bottle (`size.liters` if numeric, else parse label `"1 L"`→1 / `"270 ml"`→0.27; 0 if unparseable).
- `KO.soldLitersInWindow(deliveries, sizes, startMk, endMk)` → Σ delivered `sizeLiters × qty` in window.
- `KO.productionSummary(batches, startMk, endMk)` → `{ bottled1L, made270, used1L }`.
- Consumes existing `inWindow`, `sizeById`.

- [ ] **Step 1: Write the failing tests**

Append to `test/lib.test.js` (uses existing `SIZES`/`DELIVS`; adds a `BATCHES` fixture):

```javascript
const BATCHES = [
  { number: 1, step4: { bottles1L: 60, date: "2026-06-14" },
    conversions: [ { count270: 4, used1L: 2, date: "2026-06-18" } ] },
  { number: 2, step4: { bottles1L: 40, date: "2026-07-02" },
    conversions: [ { count270: 8, used1L: 3, date: "2026-07-10" },
                   { count270: 4, used1L: 2, date: "2026-06-20" } ] },
];

test("nextBatchNumber handles empty, sequence, and gaps", () => {
  assert.strictEqual(KO.nextBatchNumber([]), 1);
  assert.strictEqual(KO.nextBatchNumber(BATCHES), 3);
  assert.strictEqual(KO.nextBatchNumber([{ number: 5 }, { number: 2 }]), 6);
});

test("formatBatchNumber zero-pads to 3 and never truncates", () => {
  assert.strictEqual(KO.formatBatchNumber(1), "Batch 001");
  assert.strictEqual(KO.formatBatchNumber(23), "Batch 023");
  assert.strictEqual(KO.formatBatchNumber(1000), "Batch 1000");
});

test("bottles1LForConversion is ceil of count*0.27", () => {
  assert.strictEqual(KO.bottles1LForConversion(0), 0);
  assert.strictEqual(KO.bottles1LForConversion(1), 1);
  assert.strictEqual(KO.bottles1LForConversion(4), 2);
  assert.strictEqual(KO.bottles1LForConversion(8), 3);
  assert.strictEqual(KO.bottles1LForConversion(10), 3);
});

test("sizeLiters parses labels and honors an explicit liters field", () => {
  assert.strictEqual(KO.sizeLiters({ label: "1 L" }), 1);
  assert.strictEqual(KO.sizeLiters({ label: "1L" }), 1);
  assert.strictEqual(KO.sizeLiters({ label: "1.5 L" }), 1.5);
  assert.ok(Math.abs(KO.sizeLiters({ label: "270 ml" }) - 0.27) < 1e-9);
  assert.ok(Math.abs(KO.sizeLiters({ label: "500 ml" }) - 0.5) < 1e-9);
  assert.strictEqual(KO.sizeLiters({ label: "weird", liters: 0.33 }), 0.33);
  assert.strictEqual(KO.sizeLiters({ label: "nope" }), 0);
});

test("soldLitersInWindow sums delivered volume across sizes", () => {
  // June: 2x1L(2) + (2x1L+10x270ml)(2+2.7) + 4x270ml(1.08) = 7.78
  assert.ok(Math.abs(KO.soldLitersInWindow(DELIVS, SIZES, "2026-06", "2026-06") - 7.78) < 1e-9);
  assert.ok(Math.abs(KO.soldLitersInWindow(DELIVS, SIZES, "2026-07", "2026-07") - 1) < 1e-9);
});

test("productionSummary windows bottling by step4.date and conversions by their date", () => {
  assert.deepStrictEqual(KO.productionSummary(BATCHES, "2026-06", "2026-06"),
    { bottled1L: 60, made270: 8, used1L: 4 });
  assert.deepStrictEqual(KO.productionSummary(BATCHES, "2026-07", "2026-07"),
    { bottled1L: 40, made270: 8, used1L: 3 });
  assert.deepStrictEqual(KO.productionSummary([], "2026-06", "2026-06"),
    { bottled1L: 0, made270: 0, used1L: 0 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — Expected: FAIL (`KO.nextBatchNumber is not a function`, etc.).

- [ ] **Step 3: Add the implementation**

In `lib.js`, add near the other helpers (after `reciboDocId` is fine):

```javascript
  function nextBatchNumber(batches) {
    return (batches || []).reduce(function (m, b) {
      return Math.max(m, b && typeof b.number === "number" ? b.number : 0);
    }, 0) + 1;
  }

  function formatBatchNumber(n) {
    return "Batch " + String(n).padStart(3, "0");
  }

  function bottles1LForConversion(count270) {
    return Math.ceil((count270 || 0) * 270 / 1000);
  }

  function sizeLiters(size) {
    if (size && typeof size.liters === "number") return size.liters;
    const m = /([\d.]+)\s*(ml|l)\b/i.exec(size && size.label ? size.label : "");
    if (!m) return 0;
    const n = parseFloat(m[1]);
    return /ml/i.test(m[2]) ? n / 1000 : n;
  }

  function soldLitersInWindow(deliveries, sizes, startMk, endMk) {
    return (deliveries || []).reduce(function (sum, d) {
      if (!inWindow(d.date, startMk, endMk)) return sum;
      return sum + (d.items || []).reduce(function (s, it) {
        return s + sizeLiters(sizeById(sizes, it.sizeId)) * (it.quantity || 0);
      }, 0);
    }, 0);
  }

  function productionSummary(batches, startMk, endMk) {
    let bottled1L = 0, made270 = 0, used1L = 0;
    (batches || []).forEach(function (b) {
      if (b && b.step4 && b.step4.date && inWindow(b.step4.date, startMk, endMk)) {
        bottled1L += b.step4.bottles1L || 0;
      }
      ((b && b.conversions) || []).forEach(function (c) {
        if (c && c.date && inWindow(c.date, startMk, endMk)) {
          made270 += c.count270 || 0;
          used1L += c.used1L || 0;
        }
      });
    });
    return { bottled1L: bottled1L, made270: made270, used1L: used1L };
  }
```

- [ ] **Step 4: Export them**

Add `nextBatchNumber, formatBatchNumber, bottles1LForConversion, sizeLiters, soldLitersInWindow, productionSummary` to the `return { ... }` object in `lib.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add production + liters helpers to lib.js"
```

---

### Task 2: Firestore rule for batches (admin-only)

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Add the match block**

In `firestore.rules`, after the `match /reciboFiles/{id} { ... }` block, add:

```
    match /batches/{id} {
      allow read, write: if isAdmin();
    }
```

- [ ] **Step 2: Deploy (manual — human)**

In Firebase Console → Firestore → Rules, paste the full updated file and **Publish**. Performed by the controller/human.

- [ ] **Step 3: Verify (manual — human)**

Playground: admin email → `get`/`create` on `/batches/x` = **Allowed**; a non-admin authenticated uid → `get` on `/batches/x` = **Denied**.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat: admin-only Firestore rule for batches"
```

---

### Task 3: Batches data layer + CRUD

**Files:**
- Modify: `index.html` — module script: `batches: []` in state, `watch("batches", S.batches)` in admin `onLogin`, and `addBatch`/`updateBatch`/`deleteBatch` helpers.

**Interfaces (produced):** `S.batches`; `A.addBatch(o)`→Promise(ref), `A.updateBatch(id,o)`→Promise, `A.deleteBatch(id)`→Promise.

- [ ] **Step 1: Add batches to state**

In `window.APP = { … state: { … } … }`, add `batches: []`:

```javascript
    window.APP = { app, auth, db, state: { customers: [], flavours: [], deliveries: [], orders: [], recibos: [], batches: [], settings: null }, current: {} };
```

- [ ] **Step 2: Watch batches (admin)**

In `window.APP.onLogin`, next to the other `watch(...)` calls, add:

```javascript
      watch("batches", S.batches);
```

- [ ] **Step 3: Add CRUD helpers**

Near the other `window.APP.*` CRUD helpers, add:

```javascript
    window.APP.addBatch = (o) => addDoc(collection(db, "batches"), o);
    window.APP.updateBatch = (id, o) => updateDoc(doc(db, "batches", id), o);
    window.APP.deleteBatch = (id) => deleteDoc(doc(db, "batches", id));
```

- [ ] **Step 4: Syntax-check + tests**

Run the inline-script syntax check (expected `classic blocks N errors 0`, where N is the current count) and `npm test` (green). Command:
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;while((m=re.exec(h))){const s=m[1];if(!s.trim()||/^\s*import\s/m.test(s))continue;i++;try{new Function(s)}catch(e){console.log("ERR",e.message);bad++}}console.log("classic blocks",i,"errors",bad)'
```

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: batches data layer + CRUD helpers"
```

---

### Task 4: Production view (nav tab + summary + batch cards + edit form)

**Files:**
- Modify: `index.html` — add the Production nav button (after Dashboard) and `view-production` div (after `view-dashboard`); add a new Production view `<script>` IIFE.

**Interfaces:** consumes Task 1 helpers, `KO.resolveWindow`/`windowLabel`, `A.addBatch`/`updateBatch`/`deleteBatch`, `A.state.batches`, `A.state.deliveries`, `A.state.settings.sizes`, `A.serverTimestamp`, `A.esc`.

- [ ] **Step 1: Add the nav button + view div**

In `<nav>`, add after the Dashboard button:
```html
      <button data-view="production">Production</button>
```
In the views container, add after `view-dashboard`:
```html
      <div id="view-production" class="view hidden"></div>
```

- [ ] **Step 2: Add the Production view script**

Add a new `<script>` block (a DOMContentLoaded IIFE, placed among the other view scripts):

```html
  <script>
  document.addEventListener("DOMContentLoaded", function () {
    const A = window.APP, KO = window.KO;
    const container = document.getElementById("view-production");
    let editingId = null; // batch id being edited inline, or null

    function currentMonthKey() {
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    }
    function litres(v) { return KO.formatMoney(v) + " L"; }

    function batchReadCard(b) {
      const lines = [];
      if (b.step1 && b.step1.date) lines.push(`Tea: ${b.step1.waterLiters || 0} L water · ${A.esc(b.step1.date)}`);
      if (b.step2 && b.step2.date) lines.push(`Jars: ${b.step2.jars || 0} × 8 L · ${A.esc(b.step2.date)}`);
      if (b.step3 && b.step3.date) lines.push(`Polsinelli: ${A.esc(b.step3.date)}`);
      if (b.step4 && b.step4.date) lines.push(`Bottled: ${b.step4.bottles1L || 0} × 1 L · ${A.esc(b.step4.date)}`);
      const convs = (b.conversions || []).filter((c) => c && c.date);
      if (convs.length) lines.push("270 ml: " + convs.map((c) => `${c.count270 || 0}× (${c.used1L || 0}×1L) ${A.esc(c.date)}`).join(" · "));
      const body = lines.length ? lines.map((l) => `<div class="muted">${l}</div>`).join("") : "<div class='muted'>No steps recorded yet.</div>";
      return `<div class="card"><strong>${A.esc(KO.formatBatchNumber(b.number))}</strong>${body}` +
        `<div class="row" style="margin-top:8px"><button class="link" data-editbatch="${b.id}">Edit</button> · ` +
        `<button class="link" data-delbatch="${b.id}">Delete</button></div></div>`;
    }

    function convRowHtml(c) {
      c = c || {};
      return `<div class="row conv-row">` +
        `<div style="flex:0 0 74px"><label>270 ml</label><input class="cv-count" type="number" min="0" value="${c.count270 != null ? c.count270 : ""}"/></div>` +
        `<div style="flex:0 0 66px"><label>1 L used</label><input class="cv-used" type="number" min="0" value="${c.used1L != null ? c.used1L : ""}"/></div>` +
        `<div><label>Date</label><input class="cv-date" type="date" value="${c.date || ""}"/></div>` +
        `<button class="link cv-del" style="flex:0 0 28px">✕</button></div>`;
    }

    function batchEditCard(b) {
      const s1 = b.step1 || {}, s2 = b.step2 || {}, s3 = b.step3 || {}, s4 = b.step4 || {};
      const convs = b.conversions || [];
      return `<div class="card" data-batchform="${b.id}"><strong>${A.esc(KO.formatBatchNumber(b.number))}</strong>` +
        `<h4>1 · Sweetened tea</h4><div class="row"><div><label>Water (L)</label><input id="bWater" type="number" min="0" step="0.5" value="${s1.waterLiters != null ? s1.waterLiters : ""}"/></div>` +
        `<div><label>Boil date</label><input id="bDate1" type="date" value="${s1.date || ""}"/></div></div>` +
        `<h4>2 · 8 L jars</h4><div class="row"><div><label>Jars</label><input id="bJars" type="number" min="0" value="${s2.jars != null ? s2.jars : ""}"/></div>` +
        `<div><label>Date</label><input id="bDate2" type="date" value="${s2.date || ""}"/></div></div>` +
        `<h4>3 · Polsinelli 70 L</h4><label>Date</label><input id="bDate3" type="date" value="${s3.date || ""}"/>` +
        `<h4>4 · Bottling</h4><div class="row"><div><label>1 L bottles</label><input id="bBottles" type="number" min="0" value="${s4.bottles1L != null ? s4.bottles1L : ""}"/></div>` +
        `<div><label>Date</label><input id="bDate4" type="date" value="${s4.date || ""}"/></div></div>` +
        `<h4>270 ml conversions</h4><div id="bConvs">${convs.map(convRowHtml).join("")}</div>` +
        `<button class="link" id="bAddConv">➕ Add conversion</button>` +
        `<p id="bMsg" class="muted"></p>` +
        `<button class="primary" id="bSave">Save batch</button> <button class="link" id="bCancel">Cancel</button></div>`;
    }

    function readForm() {
      const numOr0 = (sel) => { const v = container.querySelector(sel).value; return v === "" ? 0 : parseFloat(v) || 0; };
      const val = (sel) => container.querySelector(sel).value;
      const convs = [];
      container.querySelectorAll(".conv-row").forEach((r) => {
        const count270 = parseInt(r.querySelector(".cv-count").value, 10) || 0;
        const used1L = parseInt(r.querySelector(".cv-used").value, 10) || 0;
        const date = r.querySelector(".cv-date").value;
        if (date && count270 > 0) convs.push({ count270, used1L, date });
      });
      return {
        step1: { waterLiters: numOr0("#bWater"), date: val("#bDate1") },
        step2: { jars: numOr0("#bJars"), date: val("#bDate2") },
        step3: { date: val("#bDate3") },
        step4: { bottles1L: numOr0("#bBottles"), date: val("#bDate4") },
        conversions: convs,
      };
    }

    function render() {
      const w = A.current.prodWindow || (A.current.prodWindow = { preset: "this-month" });
      const { startMk, endMk } = KO.resolveWindow(w.preset, w.startMk, w.endMk, currentMonthKey());
      const label = KO.windowLabel(startMk, endMk);
      const sizes = A.state.settings ? A.state.settings.sizes : [];
      const sum = KO.productionSummary(A.state.batches, startMk, endMk);
      const soldL = KO.soldLitersInWindow(A.state.deliveries, sizes, startMk, endMk);
      const family = sum.bottled1L - soldL;
      const isCustom = w.preset === "custom";
      const batches = A.state.batches.slice().sort((a, b) => (b.number || 0) - (a.number || 0));

      container.innerHTML =
        `<div class="card"><label>Window</label>` +
          `<select id="prodPreset">` +
            `<option value="this-month" ${w.preset === "this-month" ? "selected" : ""}>This month</option>` +
            `<option value="last-month" ${w.preset === "last-month" ? "selected" : ""}>Last month</option>` +
            `<option value="this-year" ${w.preset === "this-year" ? "selected" : ""}>This year</option>` +
            `<option value="custom" ${isCustom ? "selected" : ""}>Custom range…</option>` +
          `</select>` +
          (isCustom ? `<div class="row"><div><label>Start</label><input id="prodStart" type="month" value="${startMk}"/></div>` +
            `<div><label>End</label><input id="prodEnd" type="month" value="${endMk}"/></div></div>` : "") +
          `<p class="muted" style="margin-top:6px">Showing: ${A.esc(label)}</p></div>` +
        `<div class="card"><h4>Produced (${A.esc(label)})</h4>` +
          `<p>1 L bottled: <strong>${sum.bottled1L}</strong> · 270 ml made: <strong>${sum.made270}</strong> · 1 L used for 270 ml: <strong>${sum.used1L}</strong></p>` +
          `<p>Sold: <strong>${litres(soldL)}</strong> · Family consumption (produced − sold): <strong>${litres(family)}</strong></p>` +
          `<p class="muted">Family consumption is most meaningful over a wide window (This year, or a custom range covering all batches).</p></div>` +
        `<div class="card"><button class="primary" id="newBatch">➕ New batch</button></div>` +
        (batches.length ? batches.map((b) => (b.id === editingId ? batchEditCard(b) : batchReadCard(b))).join("")
          : "<p class='muted'>No batches yet.</p>");

      container.querySelector("#prodPreset").addEventListener("change", (e) => { A.current.prodWindow = { preset: e.target.value, startMk, endMk }; render(); });
      const si = container.querySelector("#prodStart"), ei = container.querySelector("#prodEnd");
      if (si) si.addEventListener("change", (e) => { A.current.prodWindow = { preset: "custom", startMk: e.target.value, endMk }; render(); });
      if (ei) ei.addEventListener("change", (e) => { A.current.prodWindow = { preset: "custom", startMk, endMk: e.target.value }; render(); });

      container.querySelector("#newBatch").addEventListener("click", async () => {
        const n = KO.nextBatchNumber(A.state.batches);
        const ref = await A.addBatch({ number: n, conversions: [], createdAt: A.serverTimestamp() });
        editingId = ref.id; render();
      });

      container.querySelectorAll("[data-editbatch]").forEach((btn) =>
        btn.addEventListener("click", () => { editingId = btn.dataset.editbatch; render(); }));
      container.querySelectorAll("[data-delbatch]").forEach((btn) =>
        btn.addEventListener("click", async () => {
          if (confirm("Delete this batch?")) { if (editingId === btn.dataset.delbatch) editingId = null; await A.deleteBatch(btn.dataset.delbatch); }
        }));

      const form = container.querySelector("[data-batchform]");
      if (form) {
        const convsDiv = container.querySelector("#bConvs");
        container.querySelector("#bAddConv").addEventListener("click", (e) => {
          e.preventDefault();
          const tmp = document.createElement("div"); tmp.innerHTML = convRowHtml();
          convsDiv.appendChild(tmp.firstElementChild);
        });
        convsDiv.addEventListener("input", (e) => {
          if (e.target.classList.contains("cv-count")) {
            const row = e.target.closest(".conv-row");
            const cnt = parseInt(e.target.value, 10);
            row.querySelector(".cv-used").value = cnt > 0 ? KO.bottles1LForConversion(cnt) : "";
          }
        });
        convsDiv.addEventListener("click", (e) => {
          if (e.target.classList.contains("cv-del")) { e.preventDefault(); e.target.closest(".conv-row").remove(); }
        });
        container.querySelector("#bCancel").addEventListener("click", (e) => { e.preventDefault(); editingId = null; render(); });
        container.querySelector("#bSave").addEventListener("click", async () => {
          const id = form.dataset.batchform;
          const data = readForm();
          try { await A.updateBatch(id, data); editingId = null; render(); }
          catch (ex) { const m = container.querySelector("#bMsg"); if (m) m.textContent = "Save failed: " + ex.message; }
        });
      }
    }

    A.renderers.production = render;
  });
  </script>
```

- [ ] **Step 3: Syntax-check + tests**

Run the inline-script syntax check (expected `classic blocks N errors 0`) and `npm test` (green — no lib change here).

- [ ] **Step 4: Manual verification (deferred to controller/human — needs live Firebase + rules deployed)**

As admin, open **Production**. Verify: **+ New batch** creates "Batch 001" (then 002…) and opens its edit form; fill steps 1–4; in **270 ml conversions**, Add conversion → entering "270 ml" auto-fills "1 L used" (ceil, editable) → Save. The batch card shows the recorded steps. The **window control** changes the "Produced" summary; **1 L bottled / 270 ml made / 1 L used / Sold / Family consumption** reflect the window (bottling by step4 date, 270 ml by conversion date, sold by delivery date). **Edit** re-opens the form; **Delete** removes the batch. Confirm a **restaurant login cannot see** Production (no tab / permission denied).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: Production tab — batches, 270ml conversions, windowed made/sold/consumed summary"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** batch model + numbering (Tasks 1/4), 4 steps + 270 ml conversions with auto ceil (Task 4), admin-only rules (Task 2) + data layer (Task 3), windowed summary incl. sold + family consumption (Tasks 1/4), edit/delete/new (Task 4). ✓
- **Types consistent:** `productionSummary`/`soldLitersInWindow`/`sizeLiters`/`bottles1LForConversion`/`nextBatchNumber`/`formatBatchNumber` signatures match their view call sites; batch doc shape consistent across `addBatch`/`updateBatch`/read/edit. ✓
- **No placeholders.** Real code + commands throughout.

## Notes for the implementer

- Only `lib.js` is unit-tested (Task 1 TDD). Tasks 3–4 are glue verified in the browser; Task 2 is a rules change verified in the Playground. Tasks 2 & 4 manual verification touch live Firebase and are done by the controller/human.
- `editingId` is module-level in the Production IIFE so it survives snapshot re-renders (same pattern as the delivery-form `editing`).
- Escape every data value interpolated into `innerHTML` with `A.esc(...)`.
```
