# Expenses & Profit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins record expenses (item, category, quantity, amount, note, optional receipt) and the Dashboard shows profit = revenue − expenses for the selected window.

**Architecture:** Single-page app, no build step. Pure logic lives in `lib.js` (UMD; `window.KO` in the browser, `require` in tests) and is unit-tested with `node --test`. `index.html` has one `<script type="module">` block holding Firebase access, exposed on `window.APP`, followed by one plain `<script>` block per view that registers `A.renderers.<view>`. Every Firestore snapshot calls `window.APP.render()`, which re-runs the active view's renderer — forms must therefore be built once and only refreshed (the existing `built` pattern of the New view). Receipt bytes are stored base64 in Firestore (free Spark plan, no Cloud Storage), split from the metadata doc like `recibos`/`reciboFiles`.

**Tech Stack:** Vanilla JS, Firebase JS SDK 10.12 (Auth + Firestore) from gstatic CDN, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-12-expenses-profit-design.md`

## Global Constraints

- Collections: `expenses`, `expenseItems`, `expenseCategories`, `expenseFiles` (same id as the expense). All admin-only read and write.
- Expense fields: `date` (`YYYY-MM-DD`), `time` (`HH:MM`), `itemId`, `categoryId` (copied from the item at save time), `quantity` (number or `null`), `unit` (copied from the item), `amount` (number > 0), `note`, `hasReceipt`, `receiptName`, `receiptType`, `enteredBy`, `createdAt` (server timestamp, create only).
- Receipt files: images shrunk so the long side ≤ 1600 px, JPEG quality 0.8; PDFs must start with `%PDF`; final raw size ≤ 700 KB (700 * 1024 bytes).
- Revenue on the Dashboard is unchanged (deliveries, deposits excluded, counted on delivery date).
- Admin UI copy is English (only the restaurant/customer view is bilingual).
- No new dependencies. `npm test` must pass after every task. Every `<script>` block in `index.html` must pass `node --check` after every task (script in Task 1 Step 6).
- Out of scope: who paid, VAT, recurring expenses, CSV export.

## Review Focus

1. **Snapshot re-render while typing an expense** — any Firestore change (e.g. Nina adds a delivery) must not wipe a half-filled expense form or a chosen receipt. Pinned in Task 3 Step 5 (manual check) and by construction (form built once; snapshots only refresh options + list).
2. **Amount typed with a comma ("12,50")** — must be accepted as 12.5, not rejected or saved as 12. Pinned in Task 1 tests.
3. **Receipt lifecycle** — replacing a receipt overwrites the file, removing it deletes the file doc and clears the fields, deleting the expense deletes the file, and an expense whose file is missing shows "Receipt not available" instead of a broken tab. Pinned in Task 3 Step 5 (manual check list).
4. **Expense pointing at an item/category that no longer exists** (deleted on another device) — list and dashboard show "(unknown)", nothing throws. Pinned in Task 1 test (`expensesByCategoryInWindow` with unknown/missing categoryId) and Task 3/5 via `A.expenseItemName`/`A.expenseCategoryName` fallbacks.
5. **Large phone photo / unreadable HEIC / wrong file type** — a 12 MP photo is shrunk below 700 KB; an image the browser can't decode gives "Can't read this image — please choose a JPEG or PDF."; a `.docx` gives "Only photos or PDF files are allowed." Pinned in Task 1 tests (`scaleToFit`, `receiptKind`) and Task 3 Step 5.

---

### Task 1: Pure expense logic in `lib.js`

**Files:**
- Modify: `lib.js` (add functions before `function installMode(`; add names to the `return { ... }` export object at the bottom)
- Test: `test/lib.test.js` (append)

**Interfaces:**
- Consumes: existing `inWindow(dateStr, startMk, endMk)`, `monthKeysBetween(startMk, endMk)`, `revenueInWindow(deliveries, sizes, startMk, endMk)` in `lib.js`.
- Produces (all on `KO`):
  - `parseAmount(v) → number | NaN` — accepts numbers or strings, comma or dot decimal, trims; `""`/`null`/`undefined` → `NaN`.
  - `validateExpense(input) → { ok: boolean, errors: string[], data: object | null }` — `input = { date, time, itemId, quantity, amount, note }` (strings or numbers). Error codes: `"item_required"`, `"amount_invalid"`, `"quantity_invalid"`, `"date_invalid"`, `"time_invalid"`. On success `data = { date, time, itemId, quantity: number|null, amount: number (rounded to cents), note: string (trimmed) }`.
  - `expensesInWindow(expenses, startMk, endMk) → number`
  - `expensesByCategoryInWindow(expenses, startMk, endMk) → [{ categoryId: string, amount: number }]` sorted by amount desc, then categoryId asc; missing `categoryId` grouped under `""`.
  - `profitSeries(deliveries, expenses, sizes, startMk, endMk) → [{ monthKey, revenue, expenses, profit }]` one entry per month in the window, each value rounded to cents.
  - `scaleToFit(w, h, maxSide) → { w, h }` integers; unchanged when both ≤ maxSide.
  - `receiptKind(type, name) → "pdf" | "image" | null`

- [ ] **Step 1: Write the failing tests** — append to `test/lib.test.js`:

```js
test("parseAmount accepts comma or dot decimals", () => {
  assert.strictEqual(KO.parseAmount("12,50"), 12.5);
  assert.strictEqual(KO.parseAmount(" 3.2 "), 3.2);
  assert.strictEqual(KO.parseAmount(7), 7);
  assert.ok(Number.isNaN(KO.parseAmount("")));
  assert.ok(Number.isNaN(KO.parseAmount(null)));
  assert.ok(Number.isNaN(KO.parseAmount("abc")));
});

test("validateExpense accepts a full expense and normalises it", () => {
  const r = KO.validateExpense({ date: "2026-10-12", time: "09:05", itemId: "tea", quantity: "2,5", amount: "12,346", note: "  bio  " });
  assert.deepStrictEqual(r, { ok: true, errors: [],
    data: { date: "2026-10-12", time: "09:05", itemId: "tea", quantity: 2.5, amount: 12.35, note: "bio" } });
});

test("validateExpense: quantity and note are optional", () => {
  const r = KO.validateExpense({ date: "2026-10-12", time: "09:05", itemId: "tea", quantity: "", amount: 4 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.quantity, null);
  assert.strictEqual(r.data.note, "");
});

test("validateExpense reports every problem", () => {
  const r = KO.validateExpense({ date: "12/10/2026", time: "9h", itemId: "", quantity: "-1", amount: "0" });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.data, null);
  assert.deepStrictEqual(r.errors.sort(),
    ["amount_invalid", "date_invalid", "item_required", "quantity_invalid", "time_invalid"]);
  assert.deepStrictEqual(KO.validateExpense({ date: "2026-10-12", time: "09:05", itemId: "__new__", amount: 1 }).errors, ["item_required"]);
});

const EXP = [
  { date: "2026-09-03", categoryId: "ing", amount: 10 },
  { date: "2026-09-20", categoryId: "bot", amount: 30.1 },
  { date: "2026-10-01", categoryId: "ing", amount: 5.2 },
  { date: "2026-10-02", amount: 1 },                    // no category (item deleted / old data)
  { date: "2026-11-01", categoryId: "ing", amount: 99 },
];

test("expensesInWindow sums amounts inside the window", () => {
  assert.strictEqual(KO.formatMoney(KO.expensesInWindow(EXP, "2026-09", "2026-10")), "46.30");
  assert.strictEqual(KO.expensesInWindow(EXP, "2026-12", "2026-12"), 0);
  assert.strictEqual(KO.expensesInWindow([], "2026-09", "2026-09"), 0);
});

test("expensesByCategoryInWindow groups and sorts desc, unknown category as ''", () => {
  assert.deepStrictEqual(KO.expensesByCategoryInWindow(EXP, "2026-09", "2026-10"), [
    { categoryId: "bot", amount: 30.1 },
    { categoryId: "ing", amount: 15.2 },
    { categoryId: "", amount: 1 },
  ]);
});

test("profitSeries gives revenue, expenses and profit per month", () => {
  // DELIVS (top of this file): Jun 2026 revenue = 2*8 + 2*8 + 10*4.5 + 4*4.5 = 95; Jul = 8
  const exp = [{ date: "2026-06-10", categoryId: "ing", amount: 100.004 }, { date: "2026-07-02", categoryId: "x", amount: 3 }];
  assert.deepStrictEqual(KO.profitSeries(DELIVS, exp, SIZES, "2026-06", "2026-08"), [
    { monthKey: "2026-06", revenue: 95, expenses: 100, profit: -5 },
    { monthKey: "2026-07", revenue: 8, expenses: 3, profit: 5 },
    { monthKey: "2026-08", revenue: 0, expenses: 0, profit: 0 },
  ]);
});

test("scaleToFit shrinks the long side to maxSide, keeps aspect", () => {
  assert.deepStrictEqual(KO.scaleToFit(4032, 3024, 1600), { w: 1600, h: 1200 });
  assert.deepStrictEqual(KO.scaleToFit(3024, 4032, 1600), { w: 1200, h: 1600 });
  assert.deepStrictEqual(KO.scaleToFit(800, 600, 1600), { w: 800, h: 600 });
});

test("receiptKind classifies by type, falling back to file name", () => {
  assert.strictEqual(KO.receiptKind("application/pdf", "a.pdf"), "pdf");
  assert.strictEqual(KO.receiptKind("", "FATURA.PDF"), "pdf");
  assert.strictEqual(KO.receiptKind("image/jpeg", "x.jpg"), "image");
  assert.strictEqual(KO.receiptKind("", "IMG_1234.HEIC"), "image");
  assert.strictEqual(KO.receiptKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx"), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: the 9 new tests fail with `KO.<name> is not a function`; all earlier tests pass.

- [ ] **Step 3: Implement** — in `lib.js`, insert directly before `  function installMode(userAgent, isStandalone) {`:

```js
  // Amounts typed on a phone may use a decimal comma ("12,50").
  function parseAmount(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "number") return v;
    const s = String(v).trim().replace(",", ".");
    if (s === "" || !/^-?\d*\.?\d+$/.test(s)) return NaN;
    return parseFloat(s);
  }

  function validateExpense(input) {
    const errors = [];
    const date = String(input.date || "");
    const time = String(input.time || "");
    const itemId = String(input.itemId || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("date_invalid");
    if (!/^\d{2}:\d{2}$/.test(time)) errors.push("time_invalid");
    if (!itemId || itemId === "__new__") errors.push("item_required");
    const amount = parseAmount(input.amount);
    if (!(amount > 0)) errors.push("amount_invalid");
    const qRaw = input.quantity;
    const qEmpty = qRaw === null || qRaw === undefined || String(qRaw).trim() === "";
    const quantity = qEmpty ? null : parseAmount(qRaw);
    if (!qEmpty && !(quantity > 0)) errors.push("quantity_invalid");
    if (errors.length) return { ok: false, errors: errors, data: null };
    return { ok: true, errors: [], data: {
      date: date, time: time, itemId: itemId, quantity: quantity,
      amount: Math.round(amount * 100) / 100, note: String(input.note || "").trim(),
    } };
  }

  function expensesInWindow(expenses, startMk, endMk) {
    return (expenses || []).reduce(function (sum, e) {
      return e.date && inWindow(e.date, startMk, endMk) ? sum + (e.amount || 0) : sum;
    }, 0);
  }

  function expensesByCategoryInWindow(expenses, startMk, endMk) {
    const byId = {};
    (expenses || []).forEach(function (e) {
      if (!e.date || !inWindow(e.date, startMk, endMk)) return;
      const k = e.categoryId || "";
      byId[k] = (byId[k] || 0) + (e.amount || 0);
    });
    return Object.keys(byId)
      .map(function (k) { return { categoryId: k, amount: Math.round(byId[k] * 100) / 100 }; })
      .sort(function (a, b) { return b.amount - a.amount || (a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0); });
  }

  function profitSeries(deliveries, expenses, sizes, startMk, endMk) {
    const r2 = function (n) { return Math.round(n * 100) / 100; };
    return monthKeysBetween(startMk, endMk).map(function (mk) {
      const revenue = r2(revenueInWindow(deliveries, sizes, mk, mk));
      const exp = r2(expensesInWindow(expenses, mk, mk));
      return { monthKey: mk, revenue: revenue, expenses: exp, profit: r2(revenue - exp) };
    });
  }

  function scaleToFit(w, h, maxSide) {
    const long = Math.max(w, h);
    if (long <= maxSide) return { w: w, h: h };
    const f = maxSide / long;
    return { w: Math.round(w * f), h: Math.round(h * f) };
  }

  function receiptKind(type, name) {
    const t = String(type || "").toLowerCase();
    const n = String(name || "").toLowerCase();
    if (t === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
    if (t.indexOf("image/") === 0 || /\.(jpe?g|png|webp|gif|heic|heif)$/.test(n)) return "image";
    return null;
  }

```

Then add to the export object at the bottom of `lib.js`: change `linkPatch, relinkWrites, installMode,` to
`linkPatch, relinkWrites, parseAmount, validateExpense, expensesInWindow, expensesByCategoryInWindow, profitSeries, scaleToFit, receiptKind, installMode,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "Add expense validation and profit calculations to lib"
```

- [ ] **Step 6 (used by every later task): script syntax check.** Save this as the scratch command you run after every `index.html` change:

```bash
python3 - <<'EOF'
import re, subprocess, tempfile, os
s = open('index.html').read()
bad = 0
for i, m in enumerate(re.findall(r'<script([^>]*)>(.*?)</script>', s, re.S)):
    ext = '.mjs' if 'module' in m[0] else '.js'
    f = os.path.join(tempfile.gettempdir(), f'ko_s{i}{ext}')
    open(f, 'w').write(m[1])
    r = subprocess.run(['node', '--check', f], capture_output=True, text=True)
    if r.returncode: bad += 1; print('script', i, r.stderr[:800])
print('syntax ok' if not bad else f'{bad} script(s) failed')
EOF
```

---

### Task 2: Data layer, state, rules and backup

**Files:**
- Modify: `index.html` — the `<script type="module">` block (state init line containing `window.APP = { app, auth, db, state: {`; the `watch(...)` calls inside `window.APP.onLogin`; data functions near `window.APP.fetchReciboFile`; name helpers near `window.APP.flavourName`) and the Settings export handler (`#exportBtn`).
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: nothing new.
- Produces (on `window.APP`, alias `A` in view scripts):
  - `A.state.expenses`, `A.state.expenseItems`, `A.state.expenseCategories` — arrays of `{ id, ...fields }`, live via `watch`.
  - `A.expenseItemName(id) → string` (`"(unknown)"` fallback), `A.expenseCategoryName(id) → string` (`"(unknown)"` fallback; `""` id → `"(no category)"`).
  - `A.addExpenseCategory(name) → Promise<DocumentReference>`; `A.updateExpenseCategory(id, patch) → Promise`; `A.deleteExpenseCategory(id) → Promise`.
  - `A.addExpenseItem({ name, categoryId, unit }) → Promise<DocumentReference>`; `A.updateExpenseItem(id, patch) → Promise`; `A.deleteExpenseItem(id) → Promise`.
  - `A.saveExpense(id | null, data, receipt) → Promise<string>` (the expense id). `receipt`: `undefined` = keep current (or none on create), `null` = remove, `{ data: base64, contentType, name }` = set/replace.
  - `A.deleteExpense(id) → Promise` (deletes `expenses/id` and `expenseFiles/id` in one batch).
  - `A.fetchExpenseFile(id) → Promise<DocumentSnapshot>`.

- [ ] **Step 1: State arrays.** In the `window.APP = { ... state: { ... } ... }` line, add `expenses: [], expenseItems: [], expenseCategories: [],` after `signups: [],`.

- [ ] **Step 2: Watches.** In `window.APP.onLogin`, after `watch("signups", S.signups);` add:

```js
      watch("expenses", S.expenses);
      watch("expenseItems", S.expenseItems);
      watch("expenseCategories", S.expenseCategories);
```

- [ ] **Step 3: Name helpers.** After the `window.APP.flavourName = ...` line add:

```js
    window.APP.expenseItemName = (id) => (S.expenseItems.find((x) => x.id === id) || {}).name || "(unknown)";
    window.APP.expenseCategoryName = (id) => (!id ? "(no category)" : (S.expenseCategories.find((x) => x.id === id) || {}).name || "(unknown)");
```

- [ ] **Step 4: Data functions.** After `window.APP.fetchReciboFile = ...` add:

```js
    window.APP.addExpenseCategory = (name) => addDoc(collection(db, "expenseCategories"), { name });
    window.APP.updateExpenseCategory = (id, o) => updateDoc(doc(db, "expenseCategories", id), o);
    window.APP.deleteExpenseCategory = (id) => deleteDoc(doc(db, "expenseCategories", id));
    window.APP.addExpenseItem = (o) => addDoc(collection(db, "expenseItems"), { name: o.name, categoryId: o.categoryId, unit: o.unit || "" });
    window.APP.updateExpenseItem = (id, o) => updateDoc(doc(db, "expenseItems", id), o);
    window.APP.deleteExpenseItem = (id) => deleteDoc(doc(db, "expenseItems", id));
    // receipt: undefined = keep (none on create), null = remove, {data, contentType, name} = set.
    // Metadata and file bytes go in one batch so they never disagree.
    window.APP.saveExpense = async function (id, data, receipt) {
      const ref = id ? doc(db, "expenses", id) : doc(collection(db, "expenses"));
      const d = Object.assign({}, data);
      const b = writeBatch(db);
      if (receipt) {
        Object.assign(d, { hasReceipt: true, receiptName: receipt.name, receiptType: receipt.contentType });
        b.set(doc(db, "expenseFiles", ref.id), { data: receipt.data, contentType: receipt.contentType });
      } else if (receipt === null) {
        Object.assign(d, { hasReceipt: false, receiptName: "", receiptType: "" });
        b.delete(doc(db, "expenseFiles", ref.id));
      } else if (!id) {
        Object.assign(d, { hasReceipt: false, receiptName: "", receiptType: "" });
      }
      if (id) b.update(ref, d);
      else { d.createdAt = serverTimestamp(); b.set(ref, d); }
      await b.commit();
      return ref.id;
    };
    window.APP.deleteExpense = function (id) {
      const b = writeBatch(db);
      b.delete(doc(db, "expenses", id));
      b.delete(doc(db, "expenseFiles", id));
      return b.commit();
    };
    window.APP.fetchExpenseFile = (id) => getDoc(doc(db, "expenseFiles", id));
```

- [ ] **Step 5: Rules.** In `firestore.rules`, after the `match /stocktakes/{id} { ... }` block add:

```
    // Expenses (admin only). File bytes live in expenseFiles under the expense id.
    match /expenses/{id} {
      allow read, write: if isAdmin();
    }
    match /expenseItems/{id} {
      allow read, write: if isAdmin();
    }
    match /expenseCategories/{id} {
      allow read, write: if isAdmin();
    }
    match /expenseFiles/{id} {
      allow read, write: if isAdmin();
    }
```

- [ ] **Step 6: Backup export.** In the `#exportBtn` handler's `const data = { ... }`, after `orders: A.state.orders,` add:

```js
          expenses: A.state.expenses, expenseItems: A.state.expenseItems,
          expenseCategories: A.state.expenseCategories,
```

- [ ] **Step 7: Verify.** Run `npm test 2>&1 | grep -E "^# (pass|fail)"` (expect `# fail 0`) and the Task 1 Step 6 syntax check (expect `syntax ok`).

- [ ] **Step 8: Commit**

```bash
git add index.html firestore.rules
git commit -m "Add expenses data layer, admin-only rules and backup export"
```

---

### Task 3: Expenses tab (form, new item/category, receipts, list)

**Files:**
- Modify: `index.html` — nav (add button), `<main>` (add view div), and a new plain `<script>` block inserted directly after the Payments view's script block (the block that ends with `A.renderers.payments = render;\n  });\n  </script>`).

**Interfaces:**
- Consumes: Task 1 `KO.validateExpense`, `KO.receiptKind`, `KO.scaleToFit`, `KO.formatMoney`, `KO.monthKey`; Task 2 `A.state.expenses|expenseItems|expenseCategories`, `A.expenseItemName`, `A.expenseCategoryName`, `A.addExpenseCategory`, `A.addExpenseItem`, `A.saveExpense`, `A.deleteExpense`, `A.fetchExpenseFile`; existing `A.base64ToBlob`, `A.toast(msg, isError)`, `A.esc`, `A.user`, `A.renderers`.
- Produces: `A.renderers.expenses`.

- [ ] **Step 1: Nav + view.** In the admin `<nav>`, after `<button data-view="payments">Payments</button>` add `<button data-view="expenses">Expenses</button>`. In `<main>`, after `<div id="view-payments" class="view hidden"></div>` add `<div id="view-expenses" class="view hidden"></div>`.

- [ ] **Step 2: The view script.** Insert this block after the Payments script block:

```html
  <script>
  document.addEventListener("DOMContentLoaded", function () {
    const A = window.APP, KO = window.KO;
    const container = document.getElementById("view-expenses");
    const MAX_FILE = 700 * 1024;
    let built = false;        // form shell built; snapshots then only refresh options + list
    let editing = null;       // expense being edited, or null
    let receipt;              // undefined = keep/none, null = remove, {data, contentType, name, size}
    let processing = false;

    const ERR = {
      item_required: "Choose an item.", amount_invalid: "Enter an amount above 0.",
      quantity_invalid: "Quantity must be above 0 (or leave it empty).",
      date_invalid: "Enter a date.", time_invalid: "Enter a time.",
    };

    function todayStr() {
      const d = new Date();
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }
    function nowTime() {
      const d = new Date();
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    }
    function currentMonthKey() { return todayStr().slice(0, 7); }
    function euro(v) { return "€" + KO.formatMoney(v); }
    const byName = (a, b) => a.name.localeCompare(b.name);

    function itemOptionsHtml() {
      return `<option value="">— choose item —</option>` +
        A.state.expenseItems.slice().sort(byName).map((it) =>
          `<option value="${it.id}">${A.esc(it.name)}</option>`).join("") +
        `<option value="__new__">➕ Add new item…</option>`;
    }
    function categoryOptionsHtml() {
      return `<option value="">— choose category —</option>` +
        A.state.expenseCategories.slice().sort(byName).map((c) =>
          `<option value="${c.id}">${A.esc(c.name)}</option>`).join("") +
        `<option value="__new__">➕ Add new category…</option>`;
    }
    function selectedItem() {
      const id = container.querySelector("#exItem").value;
      return A.state.expenseItems.find((x) => x.id === id) || null;
    }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => { const s = String(r.result); const c = s.indexOf(","); resolve(c >= 0 ? s.slice(c + 1) : s); };
        r.onerror = reject;
        r.readAsDataURL(file);
      });
    }
    function rawSize(b64) { return Math.floor(b64.length * 3 / 4); }

    function imageToJpegBase64(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const { w, h } = KO.scaleToFit(img.naturalWidth, img.naturalHeight, 1600);
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d").drawImage(img, 0, 0, w, h);
            const s = canvas.toDataURL("image/jpeg", 0.8);
            resolve(s.slice(s.indexOf(",") + 1));
          } catch (e) { reject(e); }
          finally { URL.revokeObjectURL(url); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Can't read this image — please choose a JPEG or PDF.")); };
        img.src = url;
      });
    }

    // → {data, contentType, name, size}; throws Error with a user-facing message.
    async function processReceipt(file) {
      const kind = KO.receiptKind(file.type, file.name);
      if (kind === "pdf") {
        if (file.size > MAX_FILE) throw new Error("PDF too large (max 700 KB). Please shrink it and try again.");
        const data = await fileToBase64(file);
        const head = data.length >= 8 ? atob(data.substring(0, 8)) : "";
        if (head.indexOf("%PDF") !== 0) throw new Error("That file is not a valid PDF.");
        return { data, contentType: "application/pdf", name: file.name, size: rawSize(data) };
      }
      if (kind === "image") {
        const data = await imageToJpegBase64(file);
        if (rawSize(data) > MAX_FILE) throw new Error("Photo still too large after shrinking (max 700 KB). Try a PDF or a smaller photo.");
        return { data, contentType: "image/jpeg", name: file.name.replace(/\.[^.]*$/, "") + ".jpg", size: rawSize(data) };
      }
      throw new Error("Only photos or PDF files are allowed.");
    }

    function receiptInfoHtml() {
      if (processing) return "Processing…";
      if (receipt) return "📎 " + A.esc(receipt.name) + " (" + Math.round(receipt.size / 1024) + " KB)";
      if (receipt === undefined && editing && editing.hasReceipt) return "📎 Current: " + A.esc(editing.receiptName || "receipt");
      return "";
    }
    function updateReceiptInfo() {
      container.querySelector("#exFileInfo").innerHTML = receiptInfoHtml();
      const hasOne = !!receipt || (receipt === undefined && editing && editing.hasReceipt);
      container.querySelector("#exFileClear").classList.toggle("hidden", !hasOne || processing);
      container.querySelector("#exSave").disabled = processing;
    }
    function updateItemInfo() {
      const it = selectedItem();
      container.querySelector("#exCat").textContent = it ? A.expenseCategoryName(it.categoryId) : "—";
      container.querySelector("#exQtyLabel").textContent = "Quantity" + (it && it.unit ? " (" + it.unit + ")" : "");
    }

    function buildForm() {
      const e = editing;
      container.innerHTML =
        `<div class="card"><h3>${e ? "Edit expense" : "New expense"}</h3>` +
        `<div class="row"><div><label>Date</label><input id="exDate" type="date" value="${e ? e.date : todayStr()}"/></div>` +
        `<div><label>Time</label><input id="exTime" type="time" value="${e ? e.time : nowTime()}"/></div></div>` +
        `<label>Item</label><select id="exItem">${itemOptionsHtml()}</select>` +
        `<div id="exNewItem" class="hidden" style="border:1px dashed var(--line);border-radius:8px;padding:8px;margin-top:6px">` +
          `<label>New item name</label><input id="exNiName" type="text"/>` +
          `<label>Category</label><select id="exNiCat">${categoryOptionsHtml()}</select>` +
          `<input id="exNiNewCat" class="hidden" type="text" placeholder="New category name" style="margin-top:6px"/>` +
          `<label>Unit (e.g. kg, L, pcs — optional)</label><input id="exNiUnit" type="text"/>` +
          `<div class="row" style="margin-top:6px"><button class="link" id="exNiSave">Add item</button>` +
          `<button class="link" id="exNiCancel" style="flex:0 0 70px">Cancel</button></div>` +
          `<p id="exNiErr" class="muted" style="color:#c0392b"></p></div>` +
        `<p class="muted" style="margin:6px 0 0">Category: <span id="exCat">—</span></p>` +
        `<div class="row"><div><label id="exQtyLabel">Quantity</label><input id="exQty" type="text" inputmode="decimal" value="${e && e.quantity != null ? e.quantity : ""}"/></div>` +
        `<div><label>Amount (€)</label><input id="exAmount" type="text" inputmode="decimal" value="${e ? e.amount : ""}"/></div></div>` +
        `<label>Note</label><input id="exNote" type="text" value="${e ? A.esc(e.note || "") : ""}"/>` +
        `<label>Receipt (photo or PDF, optional)</label><input id="exFile" type="file" accept="image/*,application/pdf"/>` +
        `<div class="row"><div id="exFileInfo" class="muted"></div>` +
        `<button class="link hidden" id="exFileClear" style="flex:0 0 32px">✕</button></div>` +
        `<p id="exErr" class="muted" style="color:#c0392b"></p>` +
        `<div class="row"><button class="primary" id="exSave">${e ? "Update" : "Save"}</button>` +
        (e ? `<button class="link" id="exCancel" style="flex:0 0 80px">Cancel</button>` : "") + `</div></div>` +
        `<div id="exListWrap"></div>`;

      const itemSel = container.querySelector("#exItem");
      if (e) itemSel.value = e.itemId;
      itemSel.addEventListener("change", () => {
        container.querySelector("#exNewItem").classList.toggle("hidden", itemSel.value !== "__new__");
        updateItemInfo();
      });
      container.querySelector("#exNiCat").addEventListener("change", (ev) =>
        container.querySelector("#exNiNewCat").classList.toggle("hidden", ev.target.value !== "__new__"));
      container.querySelector("#exNiCancel").addEventListener("click", (ev) => {
        ev.preventDefault();
        itemSel.value = ""; container.querySelector("#exNewItem").classList.add("hidden"); updateItemInfo();
      });
      container.querySelector("#exNiSave").addEventListener("click", onAddItem);
      container.querySelector("#exFile").addEventListener("change", onFileChosen);
      container.querySelector("#exFileClear").addEventListener("click", (ev) => {
        ev.preventDefault();
        receipt = (editing && editing.hasReceipt) ? null : undefined;
        container.querySelector("#exFile").value = "";
        updateReceiptInfo();
      });
      container.querySelector("#exSave").addEventListener("click", onSave);
      const cancel = container.querySelector("#exCancel");
      if (cancel) cancel.addEventListener("click", (ev) => { ev.preventDefault(); resetForm(); });
      updateItemInfo();
      updateReceiptInfo();
      built = true;
    }

    // Snapshot refresh: keep whatever the user selected/typed.
    function refreshOptions() {
      const itemSel = container.querySelector("#exItem");
      const v = itemSel.value; itemSel.innerHTML = itemOptionsHtml(); itemSel.value = v;
      const catSel = container.querySelector("#exNiCat");
      const cv = catSel.value; catSel.innerHTML = categoryOptionsHtml(); catSel.value = cv;
      updateItemInfo();
    }

    function resetForm() { editing = null; receipt = undefined; processing = false; built = false; render(); }

    async function onAddItem(ev) {
      ev.preventDefault();
      const err = container.querySelector("#exNiErr");
      const name = container.querySelector("#exNiName").value.trim();
      let catId = container.querySelector("#exNiCat").value;
      const newCat = container.querySelector("#exNiNewCat").value.trim();
      const unit = container.querySelector("#exNiUnit").value.trim();
      if (!name) { err.textContent = "Enter the item name."; return; }
      if (A.state.expenseItems.some((x) => x.name.toLowerCase() === name.toLowerCase())) { err.textContent = "That item already exists."; return; }
      if (!catId || (catId === "__new__" && !newCat)) { err.textContent = "Choose or enter a category."; return; }
      ev.target.disabled = true;
      try {
        if (catId === "__new__") {
          const existing = A.state.expenseCategories.find((c) => c.name.toLowerCase() === newCat.toLowerCase());
          catId = existing ? existing.id : (await A.addExpenseCategory(newCat)).id;
        }
        const ref = await A.addExpenseItem({ name, categoryId: catId, unit });
        // The snapshot for the new item may not have arrived yet; add it locally so it can be selected.
        if (!A.state.expenseItems.some((x) => x.id === ref.id)) A.state.expenseItems.push({ id: ref.id, name, categoryId: catId, unit });
        refreshOptions();
        container.querySelector("#exItem").value = ref.id;
        container.querySelector("#exNewItem").classList.add("hidden");
        ["#exNiName", "#exNiNewCat", "#exNiUnit"].forEach((s) => (container.querySelector(s).value = ""));
        err.textContent = "";
        updateItemInfo();
      } catch (e) { err.textContent = "Failed: " + (e.code || e.message); }
      finally { ev.target.disabled = false; }
    }

    async function onFileChosen(ev) {
      const file = ev.target.files && ev.target.files[0];
      const err = container.querySelector("#exErr");
      if (!file) return;
      processing = true; err.textContent = ""; updateReceiptInfo();
      try { receipt = await processReceipt(file); }
      catch (e) { receipt = undefined; ev.target.value = ""; err.textContent = e.message; }
      finally { processing = false; updateReceiptInfo(); }
    }

    async function onSave(ev) {
      ev.preventDefault();
      const err = container.querySelector("#exErr");
      const v = (id) => container.querySelector("#" + id).value;
      const res = KO.validateExpense({ date: v("exDate"), time: v("exTime"), itemId: v("exItem"),
        quantity: v("exQty"), amount: v("exAmount"), note: v("exNote") });
      if (!res.ok) { err.textContent = res.errors.map((c) => ERR[c] || c).join(" "); return; }
      const it = A.state.expenseItems.find((x) => x.id === res.data.itemId);
      if (!it) { err.textContent = ERR.item_required; return; }
      const data = Object.assign({}, res.data, { categoryId: it.categoryId || "", unit: it.unit || "" });
      if (!editing) data.enteredBy = A.user ? A.user.email : "";
      ev.target.disabled = true; err.textContent = "";
      try {
        await A.saveExpense(editing ? editing.id : null, data, receipt);
        A.toast(editing ? "Expense updated ✓" : "Expense saved ✓");
        resetForm();
      } catch (e) {
        err.textContent = "Save failed: " + (e.code || e.message);
        ev.target.disabled = false;
      }
    }

    function listHtml() {
      const mk = A.current.expenseMonth || (A.current.expenseMonth = currentMonthKey());
      const rows = A.state.expenses.filter((e) => e.date && KO.monthKey(e.date) === mk)
        .sort((a, b) => (a.date + (a.time || "") < b.date + (b.time || "") ? 1 : -1));
      const total = rows.reduce((s, e) => s + (e.amount || 0), 0);
      return `<div class="card"><div class="row"><div><label>Month</label><input id="exMonth" type="month" value="${mk}"/></div>` +
        `<div><h4 style="margin:0 0 10px">Total: ${euro(total)}</h4></div></div>` +
        (rows.length ? rows.map((e) =>
          `<div style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px">` +
          `<div><strong>${A.esc(A.expenseItemName(e.itemId))}</strong> — ${euro(e.amount || 0)}` +
            (e.hasReceipt ? ` <button class="link" data-exfile="${e.id}" style="width:auto;display:inline">📎</button>` : "") + `</div>` +
          `<div class="muted">${A.esc(e.date)} ${A.esc(e.time || "")} · ${A.esc(A.expenseCategoryName(e.categoryId))}` +
            (e.quantity != null ? ` · ${e.quantity}${e.unit ? " " + A.esc(e.unit) : ""}` : "") + `</div>` +
          (e.note ? `<div class="muted">${A.esc(e.note)}</div>` : "") +
          `<div class="row"><button class="link" data-exedit="${e.id}">Edit</button>` +
          `<button class="link" data-exdel="${e.id}" style="flex:0 0 60px">Delete</button></div></div>`).join("")
          : `<p class="muted">No expenses this month.</p>`) +
        `<p id="exListMsg" class="muted"></p></div>`;
    }

    function renderList() {
      const wrap = container.querySelector("#exListWrap");
      wrap.innerHTML = listHtml();
      wrap.querySelector("#exMonth").addEventListener("change", (ev) => {
        if (ev.target.value) { A.current.expenseMonth = ev.target.value; renderList(); }
      });
      wrap.querySelectorAll("[data-exedit]").forEach((b) => b.addEventListener("click", () => {
        const e = A.state.expenses.find((x) => x.id === b.dataset.exedit);
        if (!e) return;
        editing = e; receipt = undefined; processing = false; built = false; render();
        window.scrollTo(0, 0);
      }));
      wrap.querySelectorAll("[data-exdel]").forEach((b) => b.addEventListener("click", async () => {
        if (!confirm("Delete this expense?")) return;
        try {
          await A.deleteExpense(b.dataset.exdel);
          if (editing && editing.id === b.dataset.exdel) resetForm();
          A.toast("Expense deleted");
        } catch (e) { A.toast("Delete failed: " + (e.code || e.message), true); }
      }));
      wrap.querySelectorAll("[data-exfile]").forEach((b) => b.addEventListener("click", async () => {
        const win = window.open("", "_blank");
        const setMsg = (t) => { const m = container.querySelector("#exListMsg"); if (m) m.textContent = t; };
        try {
          const snap = await A.fetchExpenseFile(b.dataset.exfile);
          if (!snap.exists()) { if (win) win.close(); setMsg("Receipt not available."); return; }
          const d = snap.data();
          const url = URL.createObjectURL(A.base64ToBlob(d.data, d.contentType));
          if (win) win.location.href = url; else window.location.href = url;
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (ex) {
          if (win) win.close();
          setMsg("Could not open the receipt: " + (ex.code || ex.message));
        }
      }));
    }

    function render() {
      if (!A.state.settings) { container.innerHTML = "<p class='muted'>Loading…</p>"; built = false; return; }
      // The expense being edited may have been deleted on another device.
      if (editing && !A.state.expenses.some((x) => x.id === editing.id)) { editing = null; receipt = undefined; built = false; }
      if (built && container.querySelector("#exItem")) refreshOptions(); else buildForm();
      renderList();
    }

    A.renderers.expenses = render;
  });
  </script>
```

- [ ] **Step 3: Verify.** Run `npm test 2>&1 | grep -E "^# (pass|fail)"` (expect `# fail 0`) and the Task 1 Step 6 syntax check (expect `syntax ok`). Also confirm with `grep -c 'data-view="expenses"' index.html` → `1` and `grep -c 'id="view-expenses"' index.html` → `1`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add Expenses tab: form with new item/category, receipts, monthly list"
```

- [ ] **Step 5: Manual checks (done by the user after deploy — list them in the final report, don't block on them):**
  1. Fill the form halfway, have another device add a delivery → form and chosen receipt are untouched.
  2. Amount `12,50` saves as €12.50.
  3. Add with a phone photo → 📎 opens the shrunk JPEG; Edit → replace with a PDF → 📎 opens the PDF; Edit → ✕ → Update → 📎 gone; Delete removes the expense.
  4. A `.docx` gives "Only photos or PDF files are allowed."

---

### Task 4: Settings — expense categories and items

**Files:**
- Modify: `index.html` — the Settings view script block (`const container = document.getElementById("view-settings");`): the `render()` template (insert after the Flavours card, i.e. after the `<div class="card"><details><summary>Flavours (` … `</details></div>` + chunk) and its event wiring (next to the `[data-delflav]` handlers).

**Interfaces:**
- Consumes: Task 2 `A.state.expenses|expenseItems|expenseCategories`, `A.updateExpenseCategory`, `A.deleteExpenseCategory`, `A.updateExpenseItem`, `A.deleteExpenseItem`, `A.expenseCategoryName`.
- Produces: nothing used by later tasks.

- [ ] **Step 1: Template.** Directly after the Flavours card string (ends with `` `</details></div>` + `` right before the `Invite QR` card) insert:

```js
        `<div class="card"><details><summary>Expense categories (${A.state.expenseCategories.length})</summary>` +
          (A.state.expenseCategories.length ? A.state.expenseCategories.slice().sort((a,b)=>a.name.localeCompare(b.name)).map((c) =>
            `<div class="row ecat-edit" data-ecid="${c.id}"><div><input class="ec-name" value="${A.esc(c.name)}"/></div>` +
            `<button class="link ec-save" style="flex:0 0 50px">Save</button>` +
            `<button class="link ec-del" style="flex:0 0 60px">Delete</button></div>`).join("")
            : `<p class="muted">None yet — add them from the Expenses tab.</p>`) +
          `</details></div>` +
        `<div class="card"><details><summary>Expense items (${A.state.expenseItems.length})</summary>` +
          (A.state.expenseItems.length ? A.state.expenseItems.slice().sort((a,b)=>a.name.localeCompare(b.name)).map((it) =>
            `<div class="eitem-edit" data-eiid="${it.id}" style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px">` +
            `<label>Name</label><input class="ei-name" value="${A.esc(it.name)}"/>` +
            `<div class="row"><div><label>Category</label><select class="ei-cat">` +
              A.state.expenseCategories.slice().sort((a,b)=>a.name.localeCompare(b.name)).map((c) =>
                `<option value="${c.id}" ${c.id === it.categoryId ? "selected" : ""}>${A.esc(c.name)}</option>`).join("") +
              (A.state.expenseCategories.some((c) => c.id === it.categoryId) ? "" : `<option value="${A.esc(it.categoryId || "")}" selected>(unknown)</option>`) +
            `</select></div>` +
            `<div><label>Unit</label><input class="ei-unit" value="${A.esc(it.unit || "")}"/></div></div>` +
            `<div class="row"><button class="link ei-save">Save</button>` +
            `<button class="link ei-del" style="flex:0 0 60px">Delete</button></div></div>`).join("")
            : `<p class="muted">None yet — add them from the Expenses tab.</p>`) +
          `<p class="muted">Changing an item's category only affects new expenses; saved expenses keep the category they were entered with.</p>` +
          `</details></div>` +
```

- [ ] **Step 2: Wiring.** After the `[data-delflav]` handler block add:

```js
      container.querySelectorAll(".ecat-edit").forEach((row) => {
        const id = row.dataset.ecid;
        row.querySelector(".ec-save").addEventListener("click", async (e) => {
          const name = row.querySelector(".ec-name").value.trim();
          if (!name) { alert("Name can't be empty."); return; }
          try { await A.updateExpenseCategory(id, { name }); A.toast("Category saved ✓"); }
          catch (ex) { A.toast("Save failed: " + (ex.code || ex.message), true); }
        });
        row.querySelector(".ec-del").addEventListener("click", async () => {
          if (A.state.expenseItems.some((it) => it.categoryId === id)) { alert("Cannot delete: items belong to this category. Move them first."); return; }
          if (A.state.expenses.some((x) => x.categoryId === id)) { alert("Cannot delete: expenses use this category."); return; }
          if (confirm("Delete this category?")) await A.deleteExpenseCategory(id);
        });
      });
      container.querySelectorAll(".eitem-edit").forEach((row) => {
        const id = row.dataset.eiid;
        row.querySelector(".ei-save").addEventListener("click", async () => {
          const name = row.querySelector(".ei-name").value.trim();
          if (!name) { alert("Name can't be empty."); return; }
          try {
            await A.updateExpenseItem(id, { name, categoryId: row.querySelector(".ei-cat").value, unit: row.querySelector(".ei-unit").value.trim() });
            A.toast("Item saved ✓");
          } catch (ex) { A.toast("Save failed: " + (ex.code || ex.message), true); }
        });
        row.querySelector(".ei-del").addEventListener("click", async () => {
          if (A.state.expenses.some((x) => x.itemId === id)) { alert("Cannot delete: expenses use this item."); return; }
          if (confirm("Delete this item?")) await A.deleteExpenseItem(id);
        });
      });
```

- [ ] **Step 3: Verify.** `npm test` → `# fail 0`; Task 1 Step 6 syntax check → `syntax ok`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add expense categories and items management to Settings"
```

---

### Task 5: Dashboard — profit, expenses by category, monthly profit

**Files:**
- Modify: `index.html` — Dashboard view script block (`const container = document.getElementById("view-dashboard");`), inside `render()`.

**Interfaces:**
- Consumes: Task 1 `KO.expensesInWindow`, `KO.expensesByCategoryInWindow`, `KO.profitSeries`; Task 2 `A.state.expenses`, `A.expenseCategoryName`; existing `KO.barChartSVG(data, opts)` where `data = [{ label, title, value }]`, `opts = { format, rotate }`; existing local `euro(v)`, `winTotals`, `startMk`, `endMk`, `label`, `sizes`.
- Produces: nothing.

- [ ] **Step 1: Compute.** In `render()`, after the `const yearly = KO.revenueTypeByYear(...)` line add:

```js
      const expTotal = KO.expensesInWindow(A.state.expenses, startMk, endMk);
      const profit = Math.round((winTotals.total - expTotal) * 100) / 100;
      const expByCat = KO.expensesByCategoryInWindow(A.state.expenses, startMk, endMk);
      const profitRows = KO.profitSeries(A.state.deliveries, A.state.expenses, sizes, startMk, endMk);
      const expCatChart = KO.barChartSVG(
        expByCat.map((c) => ({ label: A.expenseCategoryName(c.categoryId).slice(0, 10), title: A.expenseCategoryName(c.categoryId), value: c.amount })),
        { format: euro, rotate: true });
      const expMonthChart = KO.barChartSVG(
        profitRows.map((r) => ({ label: KO.monthName(r.monthKey).slice(0, 3), title: KO.windowLabel(r.monthKey, r.monthKey), value: r.expenses })),
        { format: euro });
      const red = (v) => (v < 0 ? ` style="color:#c0392b"` : "");
```

- [ ] **Step 2: Cards.** In the `container.innerHTML = ...` template, directly after the Revenue card (the chunk ending `` typeLegend + `</div>` + `` right before `` `<div class="card"><h4>Yearly revenue (all years)</h4>` ``) insert:

```js
        `<div class="card"><h3${red(profit)}>Profit (${A.esc(label)}): ${euro(profit)}</h3>` +
          `<table><tr><td>Revenue</td><td>${euro(winTotals.total)}</td></tr>` +
          `<tr><td>Expenses</td><td>${euro(expTotal)}</td></tr></table></div>` +
        `<div class="card"><h4>Expenses by category</h4>` +
          (expByCat.length ? `<div class="chartwrap"><div class="chart-tip muted">Tap a bar to see its value</div>${expCatChart}</div>` +
            "<table>" + expByCat.map((c) =>
              `<tr><td>${A.esc(A.expenseCategoryName(c.categoryId))}</td><td>${euro(c.amount)}</td></tr>`).join("") + "</table>"
            : "<p class='muted'>No expenses in this window.</p>") + `</div>` +
        `<div class="card"><h4>Monthly profit</h4>` +
          (profitRows.some((r) => r.expenses > 0) ? `<div class="chartwrap"><div class="chart-tip muted">Expenses per month — tap a bar</div>${expMonthChart}</div>` : "") +
          `<table><tr><th>Month</th><th>Revenue</th><th>Expenses</th><th>Profit</th></tr>` +
          profitRows.map((r) =>
            `<tr><td>${A.esc(KO.windowLabel(r.monthKey, r.monthKey))}</td><td>${euro(r.revenue)}</td><td>${euro(r.expenses)}</td>` +
            `<td${red(r.profit)}>${euro(r.profit)}</td></tr>`).join("") + `</table></div>` +
```

- [ ] **Step 3: Verify.** `npm test` → `# fail 0`; Task 1 Step 6 syntax check → `syntax ok`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Show profit, expenses by category and monthly profit on the Dashboard"
```

---

### Task 6: Docs

**Files:**
- Modify: `docs/FIREBASE_SETUP.md` (only if it contains a rules section or a list of collections — add the four new collections there); `README.md` (only if it lists the app's tabs/features — add "Expenses" with one line).

- [ ] **Step 1:** `grep -n -iE "collection|rules|payments" docs/FIREBASE_SETUP.md README.md` and add matching one-line entries for Expenses / the new collections where such lists exist. Change nothing else.
- [ ] **Step 2: Commit** (skip if nothing changed)

```bash
git add docs/FIREBASE_SETUP.md README.md
git commit -m "Document the Expenses tab and its collections"
```

**Deploy note for the final report:** `firestore.rules` must be pasted into Firebase console → Firestore → Rules and published before the Expenses tab works (otherwise reads fail with `permission-denied`). Pushing `main` deploys the app to GitHub Pages — ask the user before pushing.
