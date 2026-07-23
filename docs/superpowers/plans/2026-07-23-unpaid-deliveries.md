# Unpaid Deliveries / Open Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Track deliveries as paid/unpaid and add an admin "Payments" tab listing everything owed, grouped by customer → month, with per-delivery / per-month / cutoff settling.

**Architecture:** A `paid` boolean on each delivery. A tested pure `KO.openPayments` builds the grouped worklist; the new Payments view renders it. A Paid checkbox on the delivery form, a badge+toggle in the Deliveries list, and batch mutations for month/cutoff settling.

**Tech Stack:** Vanilla JS single-file app (`index.html` + UMD `lib.js`), Firestore, `node --test`, no build step.

## Global Constraints

- No new dependencies, no build step, no new script tags (new `<script>` blocks in `index.html` are fine — that's the existing per-view pattern).
- Amount owed per delivery = `KO.deliveryRevenue(d, sizes)` (product price only; deposits excluded).
- New deliveries default **unpaid**; `paid` is the single source of truth (no hidden date logic).
- `writeBatch` is already imported in the module block (index.html:94); chunk batch writes at ≤400 ops.
- `.pill` / `.pill-ok` / `.pill-muted` CSS already exists (from the email-indicator feature) — reuse it, do not redefine.
- Escape interpolated customer data with `A.esc(...)`.
- `npm test` must stay green (74 existing + new tests).

---

### Task 1: `openPayments` helper in `lib.js`

**Files:**
- Modify: `lib.js` (add near the revenue helpers; add to exports at line 636)
- Test: `test/lib.test.js` (add a new test)

**Interfaces:**
- Consumes: `deliveryRevenue`, `monthKey` (both already in `lib.js`).
- Produces: `KO.openPayments(deliveries, sizes)` → `{ grandTotal, customers: [{ customerId, total, months: [{ monthKey, total, items: [{ id, date, amount }] }] }] }`. Includes only deliveries where `!d.paid` and `deliveryRevenue > 0`. Customers sorted by `customerId`; months newest-first; items newest-first by date.

- [ ] **Step 1: Write the failing test**

Add to `test/lib.test.js` (at the end of the file):

```javascript
test("openPayments groups unpaid deliveries by customer and month", () => {
  const sizes = [{ id: "1L", label: "1 L", price: 8, deposit: 0 }];
  const delivs = [
    { id: "d1", customerId: "A", date: "2026-06-03", items: [{ sizeId: "1L", quantity: 2 }] },              // unpaid 16
    { id: "d2", customerId: "A", date: "2026-07-10", items: [{ sizeId: "1L", quantity: 1 }] },              // unpaid 8
    { id: "d3", customerId: "A", date: "2026-07-20", items: [{ sizeId: "1L", quantity: 3 }], paid: true },  // paid -> excluded
    { id: "d4", customerId: "B", date: "2026-07-05", items: [{ sizeId: "1L", quantity: 1 }] },              // unpaid 8
    { id: "d5", customerId: "B", date: "2026-07-06", items: [], empties: [] },                              // 0 revenue -> excluded
  ];
  const r = KO.openPayments(delivs, sizes);
  assert.strictEqual(r.grandTotal, 32);
  assert.strictEqual(r.customers.length, 2);
  const cA = r.customers.find((c) => c.customerId === "A");
  assert.strictEqual(cA.total, 24);
  assert.strictEqual(cA.months.length, 2);
  assert.strictEqual(cA.months[0].monthKey, "2026-07"); // newest first
  assert.strictEqual(cA.months[0].total, 8);
  assert.strictEqual(cA.months[1].monthKey, "2026-06");
  assert.strictEqual(cA.months[1].items[0].id, "d1");
  const cB = r.customers.find((c) => c.customerId === "B");
  assert.strictEqual(cB.total, 8);
  assert.strictEqual(cB.months.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `KO.openPayments is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `lib.js` immediately after the `deliveryDepositRefund` function:

```javascript
  function openPayments(deliveries, sizes) {
    const byCust = {};
    let grandTotal = 0;
    (deliveries || []).forEach(function (d) {
      if (d.paid) return;
      const amount = deliveryRevenue(d, sizes);
      if (amount <= 0) return;
      grandTotal += amount;
      const cust = byCust[d.customerId] || (byCust[d.customerId] = { customerId: d.customerId, total: 0, monthsMap: {} });
      cust.total += amount;
      const mk = monthKey(d.date);
      const mo = cust.monthsMap[mk] || (cust.monthsMap[mk] = { monthKey: mk, total: 0, items: [] });
      mo.total += amount;
      mo.items.push({ id: d.id, date: d.date, amount: amount });
    });
    const customers = Object.keys(byCust).sort().map(function (cid) {
      const c = byCust[cid];
      const months = Object.keys(c.monthsMap).sort().reverse().map(function (mk) {
        const mo = c.monthsMap[mk];
        mo.items.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
        return { monthKey: mo.monthKey, total: mo.total, items: mo.items };
      });
      return { customerId: c.customerId, total: c.total, months: months };
    });
    return { grandTotal: grandTotal, customers: customers };
  }
```

- [ ] **Step 4: Add to exports**

In the `return { ... }` object (line 636), add `openPayments` (e.g. right after `outstandingByCustomer`):

```javascript
outstandingByCustomer, openPayments,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 75 tests green.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "Add openPayments helper (unpaid deliveries grouped by customer/month)"
```

---

### Task 2: `paid` data layer — form checkbox + mutations

**Files:**
- Modify: `index.html` — module block near lines 273-274 (mutations); delivery form `buildForm` (line 513), `readForm` (line 487), `editDelivery` (line 595).

**Interfaces:**
- Produces:
  - `window.APP.setDeliveryPaid(id, paid)` → `updateDoc(doc(db,"deliveries",id), { paid })`.
  - `window.APP.setDeliveriesPaid(ids, paid)` → chunked `writeBatch` update.
  - The delivery form reads/writes `paid` on the delivery record (default unchecked).

- [ ] **Step 1: Add the mutation functions**

In `index.html`, immediately after line 274 (`window.APP.updateDelivery = ...`), add:

```javascript
    window.APP.setDeliveryPaid = (id, paid) => updateDoc(doc(db, "deliveries", id), { paid });
    window.APP.setDeliveriesPaid = async (ids, paid) => {
      for (let i = 0; i < ids.length; i += 400) {
        const b = writeBatch(db);
        ids.slice(i, i + 400).forEach((id) => b.update(doc(db, "deliveries", id), { paid }));
        await b.commit();
      }
    };
```

- [ ] **Step 2: Add the Paid checkbox to the form**

In `buildForm` (index.html:513), replace the Note line:

```javascript
        `<label>Note (optional)</label><textarea id="note" rows="2"></textarea>` +
```

with the Note line followed by a Paid checkbox:

```javascript
        `<label>Note (optional)</label><textarea id="note" rows="2"></textarea>` +
        `<label style="display:flex;align-items:center;gap:8px;font-weight:normal"><input type="checkbox" id="dpaid" style="width:auto"/> Paid (payment already received)</label>` +
```

- [ ] **Step 3: Include `paid` in `readForm`**

In `readForm` (index.html:487), change the returned object's `note` line:

```javascript
        note: container.querySelector("#note").value.trim(),
```

to also read the checkbox:

```javascript
        note: container.querySelector("#note").value.trim(),
        paid: container.querySelector("#dpaid").checked,
```

- [ ] **Step 4: Populate the checkbox in `editDelivery`**

In `editDelivery` (index.html:595), after the note line:

```javascript
      container.querySelector("#note").value = d.note || "";
```

add:

```javascript
      container.querySelector("#dpaid").checked = !!d.paid;
```

(`fulfilOrder` needs no change — fulfilled deliveries are new and default unpaid via the unchecked checkbox.)

- [ ] **Step 5: Verify tests pass**

Run: `npm test`
Expected: 75 pass (no lib change here; confirms nothing broke).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add paid flag: delivery-form checkbox + setDeliveryPaid/setDeliveriesPaid"
```

---

### Task 3: Paid/Unpaid badge + toggle in the Deliveries list

**Files:**
- Modify: `index.html` — deliveries `render()` (lines 645-662).

**Interfaces:**
- Consumes: `A.setDeliveryPaid` (Task 2), `KO.deliveryRevenue`.

- [ ] **Step 1: Add badge + toggle to each delivery row**

In the deliveries `render()`, the row template + handlers are currently (index.html:645-661):

```javascript
      container.innerHTML = list.map((d) =>
        `<div class="card">` +
        `<strong>${A.esc(A.customerName(d.customerId))}</strong> — ${d.date}${d.time ? " " + A.esc(d.time) : ""}<br/>` +
        `<span class="muted">${itemSummary(d, sizes)}</span><br/>` +
        `Revenue: €${KO.formatMoney(KO.deliveryRevenue(d, sizes))}` +
        ((d.empties || []).length ? ` · Empties back: ${emptiesSummary(d, sizes)}` : "") +
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
```

Replace that whole block with (adds a payment badge — only when there's revenue to pay — and a Mark paid/unpaid toggle):

```javascript
      container.innerHTML = list.map((d) => {
        const hasRevenue = KO.deliveryRevenue(d, sizes) > 0;
        const paidBadge = hasRevenue
          ? (d.paid ? `<span class="pill pill-ok">Paid ✓</span>` : `<span class="pill pill-muted">Unpaid</span>`)
          : "";
        return `<div class="card">` +
        `<strong>${A.esc(A.customerName(d.customerId))}</strong> — ${d.date}${d.time ? " " + A.esc(d.time) : ""} ${paidBadge}<br/>` +
        `<span class="muted">${itemSummary(d, sizes)}</span><br/>` +
        `Revenue: €${KO.formatMoney(KO.deliveryRevenue(d, sizes))}` +
        ((d.empties || []).length ? ` · Empties back: ${emptiesSummary(d, sizes)}` : "") +
        `<div style="margin-top:8px">` +
        (hasRevenue ? `<button class="link" data-togglepaid="${d.id}">${d.paid ? "Mark unpaid" : "Mark paid"}</button> · ` : "") +
        `<button class="link" data-edit="${d.id}">Edit</button> · ` +
        `<button class="link" data-del="${d.id}">Delete</button></div>` +
        `</div>`;
      }).join("");

      container.querySelectorAll("[data-togglepaid]").forEach((b) =>
        b.addEventListener("click", async () => {
          const d = A.state.deliveries.find((x) => x.id === b.dataset.togglepaid);
          await A.setDeliveryPaid(b.dataset.togglepaid, !(d && d.paid));
        }));
      container.querySelectorAll("[data-edit]").forEach((b) =>
        b.addEventListener("click", () => A.editDelivery(b.dataset.edit)));
      container.querySelectorAll("[data-del]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (confirm("Delete this delivery?")) await A.deleteDelivery(b.dataset.del);
        }));
```

- [ ] **Step 2: Verify tests pass**

Run: `npm test`
Expected: 75 pass.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Show Paid/Unpaid badge and toggle in Deliveries list"
```

---

### Task 4: Payments tab (nav + view + renderer)

**Files:**
- Modify: `index.html` — nav (line 68), views (line 77), and a new `<script>` renderer block (add after the deliveries view's `</script>` at line 666).

**Interfaces:**
- Consumes: `KO.openPayments` (Task 1), `A.setDeliveryPaid` / `A.setDeliveriesPaid` (Task 2), `A.customerName`, `A.esc`, `KO.formatMoney`, `KO.monthName`.

- [ ] **Step 1: Add the nav button**

In `index.html`, after the Recibo nav button (line 67), before Settings:

```html
      <button data-view="recibo">Recibo</button>
      <button data-view="payments">Payments</button>
      <button data-view="settings">Settings</button>
```

- [ ] **Step 2: Add the view container**

In `index.html`, after the recibo view (line 76), before the settings view:

```html
      <div id="view-recibo" class="view hidden"></div>
      <div id="view-payments" class="view hidden"></div>
      <div id="view-settings" class="view hidden"></div>
```

- [ ] **Step 3: Add the renderer script block**

In `index.html`, immediately after the deliveries view's closing `</script>` (line 666), add a new block:

```html
  <script>
  document.addEventListener("DOMContentLoaded", function () {
    const A = window.APP, KO = window.KO;
    const container = document.getElementById("view-payments");

    function yesterdayStr() {
      const d = new Date();
      const off = d.getTimezoneOffset();
      return new Date(d.getTime() - off * 60000 - 86400000).toISOString().slice(0, 10);
    }

    function render() {
      const sizes = A.state.settings ? A.state.settings.sizes : [];
      const data = KO.openPayments(A.state.deliveries, sizes);
      const custs = data.customers.slice().sort((a, b) =>
        A.customerName(a.customerId).localeCompare(A.customerName(b.customerId)));

      let html = `<div class="card"><h3>Open payments</h3>` +
        `<p><strong>Total owed: €${KO.formatMoney(data.grandTotal)}</strong></p>` +
        `<div class="row" style="align-items:flex-end">` +
        `<div><label>Settle all unpaid up to</label><input id="cutoffDate" type="date" value="${yesterdayStr()}"/></div>` +
        `<button class="link" id="settleCutoff" style="flex:0 0 auto">Mark paid</button></div>` +
        `</div>`;

      if (!custs.length) {
        html += `<div class="card"><p class="muted">All caught up — nothing unpaid.</p></div>`;
      } else {
        html += custs.map((c) =>
          `<div class="card"><strong>${A.esc(A.customerName(c.customerId))}</strong> — €${KO.formatMoney(c.total)}` +
          c.months.map((m) =>
            `<div style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px">` +
            `<div class="row"><div><strong>${KO.monthName(m.monthKey)} ${m.monthKey.slice(0, 4)}</strong> — €${KO.formatMoney(m.total)}</div>` +
            `<button class="link" data-monthpaid="${c.customerId}|${m.monthKey}" style="flex:0 0 auto">Mark month paid</button></div>` +
            m.items.map((it) =>
              `<div class="row"><div class="muted">${it.date} — €${KO.formatMoney(it.amount)}</div>` +
              `<button class="link" data-delivpaid="${it.id}" style="flex:0 0 auto">Mark paid</button></div>`).join("") +
            `</div>`).join("") +
          `</div>`).join("");
      }
      container.innerHTML = html;

      const settleBtn = container.querySelector("#settleCutoff");
      if (settleBtn) settleBtn.addEventListener("click", async () => {
        const cutoff = container.querySelector("#cutoffDate").value;
        if (!cutoff) return;
        const ids = A.state.deliveries.filter((d) => !d.paid && d.date <= cutoff).map((d) => d.id);
        if (!ids.length) { alert("No unpaid deliveries up to " + cutoff + "."); return; }
        if (confirm("Mark " + ids.length + " delivery(ies) up to " + cutoff + " as paid?")) {
          await A.setDeliveriesPaid(ids, true);
        }
      });
      container.querySelectorAll("[data-delivpaid]").forEach((b) =>
        b.addEventListener("click", async () => { await A.setDeliveryPaid(b.dataset.delivpaid, true); }));
      container.querySelectorAll("[data-monthpaid]").forEach((b) =>
        b.addEventListener("click", async () => {
          const parts = b.dataset.monthpaid.split("|");
          const cust = data.customers.find((x) => x.customerId === parts[0]);
          const mo = cust && cust.months.find((x) => x.monthKey === parts[1]);
          if (mo) await A.setDeliveriesPaid(mo.items.map((it) => it.id), true);
        }));
    }

    A.renderers.payments = render;
  });
  </script>
```

- [ ] **Step 4: Verify tests pass**

Run: `npm test`
Expected: 75 pass.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add Payments tab: open-payments worklist with per-delivery/month/cutoff settling"
```

---

## Manual verification (browser, after all tasks)

Admin, logged in:
1. **New delivery** with Paid unchecked → save → it appears in the **Payments** tab under its customer/month; the **Deliveries** list shows an **Unpaid** badge.
2. New delivery with **Paid checked** → does not appear in Payments; Deliveries shows **Paid ✓**.
3. In Payments: **Mark paid** on a delivery removes it; **Mark month paid** clears the month; **grand total** and per-customer/month totals update.
4. **Settle all unpaid up to [yesterday]** → confirms count, marks the backlog paid, tab empties down to only today's unpaid.
5. Deliveries list **Mark unpaid** reverses a paid delivery (it reappears in Payments).
6. Empty state shows "All caught up — nothing unpaid." when nothing is owed.
