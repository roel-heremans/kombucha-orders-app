# Restaurant Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let restaurant customers place order requests from their own phone; admins (Roel + Nina) see them in-app, fulfil them via the existing delivery form, and mark them delivered.

**Architecture:** One `index.html` with a role-based split. Admins get the existing app plus a new **Orders** tab; restaurants get a stripped-down order form + their own order history. Orders live in a new `orders` collection and are a thin layer that *feeds* a normal delivery on fulfilment, leaving all existing revenue/recibo/dashboard code untouched. No backend — restaurant logins are created client-side with a secondary Firebase app instance.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step), Firebase v10.12.0 (Firestore + Email/Password auth) from CDN, `node --test` for pure-logic unit tests, GitHub Pages hosting.

## Global Constraints

- No build step; single `index.html` + `lib.js` + CDN Firebase. Do not add bundlers or npm runtime deps.
- Pure, testable logic goes in `lib.js` (exported via the UMD wrapper) with tests in `test/lib.test.js`; run with `npm test` (`node --test`).
- UI/Firebase glue is verified **manually in the browser** (no DOM/integration test harness exists in this repo). Verification steps say exactly what to click and observe.
- Admin identity is the email allowlist `["roel.heremans@gmail.com", "reissnina@gmail.com"]` — used verbatim in both `firestore.rules` and the client role check.
- Firebase stays on the free Spark plan (no Cloud Functions).
- Each view is its own `DOMContentLoaded` IIFE that reads `window.APP` (aliased `A`) and `window.KO` (aliased `KO`); follow this pattern — do not merge views.
- HTML built from user/data strings must be escaped with `A.esc(...)`.
- Firebase config object is `FIREBASE_CONFIG` in the module script; reuse it, don't duplicate the literal.

---

### Task 1: Pure order helpers in `lib.js`

**Files:**
- Modify: `lib.js` (add two functions + export them in the return object at the end)
- Test: `test/lib.test.js` (append tests)

**Interfaces:**
- Produces:
  - `KO.orderItemsSummary(order, sizes, flavourName)` → `string`. `order` is `{ items: [{sizeId, flavourId, quantity}] }`, `sizes` is the settings sizes array, `flavourName` is an optional `(flavourId) => string`. Returns e.g. `"8x 1 L Ginger, 6x 270 ml Hibiscus"`. Unknown size falls back to the raw `sizeId`; if `flavourName` is omitted, the raw `flavourId` is used. Empty/absent items → `""`.
  - `KO.orderStatusLabel(status)` → `string`. `"delivered"` → `"✅ Delivered"`, `"cancelled"` → `"✖ Cancelled"`, anything else → `"⏳ Requested"`.
- Consumes: existing `sizeById(sizes, id)` in `lib.js`.

- [ ] **Step 1: Write the failing tests**

Append to `test/lib.test.js`:

```javascript
test("orderItemsSummary joins items with size label and flavour name", () => {
  const order = { items: [
    { sizeId: "1L", flavourId: "gin", quantity: 8 },
    { sizeId: "270ml", flavourId: "hib", quantity: 6 },
  ] };
  const names = { gin: "Ginger", hib: "Hibiscus" };
  const out = KO.orderItemsSummary(order, SIZES, (id) => names[id] || id);
  assert.strictEqual(out, "8x 1 L Ginger, 6x 270 ml Hibiscus");
});

test("orderItemsSummary falls back to raw ids when size/flavour unknown", () => {
  const order = { items: [{ sizeId: "500ml", flavourId: "xyz", quantity: 2 }] };
  assert.strictEqual(KO.orderItemsSummary(order, SIZES), "2x 500ml xyz");
});

test("orderItemsSummary returns empty string for no items", () => {
  assert.strictEqual(KO.orderItemsSummary({}, SIZES), "");
  assert.strictEqual(KO.orderItemsSummary({ items: [] }, SIZES), "");
});

test("orderStatusLabel maps statuses", () => {
  assert.strictEqual(KO.orderStatusLabel("requested"), "⏳ Requested");
  assert.strictEqual(KO.orderStatusLabel("delivered"), "✅ Delivered");
  assert.strictEqual(KO.orderStatusLabel("cancelled"), "✖ Cancelled");
  assert.strictEqual(KO.orderStatusLabel("weird"), "⏳ Requested");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the new tests error with `KO.orderItemsSummary is not a function` / `KO.orderStatusLabel is not a function`. Existing tests still pass.

- [ ] **Step 3: Add the implementation**

In `lib.js`, add these two functions just before the `function escapeXml` definition (near line 200):

```javascript
  function orderItemsSummary(order, sizes, flavourName) {
    return (order.items || []).map(function (it) {
      const s = sizeById(sizes, it.sizeId);
      const label = s ? s.label : it.sizeId;
      const fname = flavourName ? flavourName(it.flavourId) : it.flavourId;
      return it.quantity + "x " + label + " " + fname;
    }).join(", ");
  }

  function orderStatusLabel(status) {
    if (status === "delivered") return "✅ Delivered";
    if (status === "cancelled") return "✖ Cancelled";
    return "⏳ Requested";
  }
```

- [ ] **Step 4: Export the functions**

In the `return { ... }` object at the end of `lib.js` (line ~237), add `orderItemsSummary` and `orderStatusLabel` to the exported list:

```javascript
  return { formatMoney, sizeById, deliveryRevenue, deliveryDepositRefund, monthKey, inMonth, monthName, dayOfMonth, recentMonthKeys, monthlyRevenue, revenueByCustomer, monthlyRevenueSeries, flavourCounts, revenueByCustomerType, outstandingByCustomer, reciboSizeLabel, generateRecibo, orderItemsSummary, orderStatusLabel, barChartSVG };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add order summary and status helpers to lib.js"
```

---

### Task 2: Role-based Firestore security rules

**Files:**
- Modify: `firestore.rules` (full rewrite)

**Interfaces:**
- Produces: security rules enforcing admin-vs-restaurant access for collections `flavours`, `settings`, `customers`, `deliveries`, `orders`. Restaurant users can create/read/cancel only their own `orders`, read `flavours` + `settings` + their own `customers` doc, and nothing else.
- Consumes: nothing (Firestore-side).

- [ ] **Step 1: Rewrite `firestore.rules`**

Replace the entire contents of `firestore.rules` with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null &&
        request.auth.token.email in [
          "roel.heremans@gmail.com",
          "reissnina@gmail.com"
        ];
    }
    function signedIn() { return request.auth != null; }

    // Reference data the restaurant order form needs to render.
    match /flavours/{id} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }
    match /settings/{id} {
      allow read: if signedIn();
      allow write: if isAdmin();
    }

    // Customers: admin full; a restaurant may read only its own linked doc.
    match /customers/{id} {
      allow read: if isAdmin() ||
        (signedIn() && resource.data.uid == request.auth.uid);
      allow write: if isAdmin();
    }

    // Deliveries and everything revenue-related: admin only.
    match /deliveries/{id} {
      allow read, write: if isAdmin();
    }

    // Orders: admin full; restaurant may create + read + cancel ONLY its own.
    match /orders/{id} {
      allow read: if isAdmin() ||
        (signedIn() && resource.data.customerUid == request.auth.uid);
      allow create: if isAdmin() ||
        (signedIn() && request.resource.data.customerUid == request.auth.uid
                    && request.resource.data.status == "requested");
      allow update: if isAdmin() ||
        (signedIn() && resource.data.customerUid == request.auth.uid
                    && resource.data.status == "requested"
                    && request.resource.data.status == "cancelled");
      allow delete: if isAdmin();
    }
  }
}
```

- [ ] **Step 2: Deploy the rules**

In the Firebase Console → Firestore Database → **Rules**, paste the new file contents and click **Publish**. (There is no CLI configured in this repo; the console is the source of truth.)

- [ ] **Step 3: Verify with the Rules Playground (manual)**

In the Firebase Console Rules Playground, confirm each of these:

- Simulated auth email `roel.heremans@gmail.com`, `get` on `/deliveries/x` → **Allowed**.
- Authenticated (non-admin) uid `U1`, `get` on `/orders/o1` where `o1.customerUid == "U1"` → **Allowed**.
- Same user, `get` on `/orders/o2` where `o2.customerUid == "U2"` → **Denied**.
- Same user, `get` on `/deliveries/x` → **Denied**.
- Same user, `create` on `/orders/new` with `customerUid == "U1"`, `status == "requested"` → **Allowed**.
- Same user, `update` on their own requested order setting `status == "delivered"` → **Denied** (only `cancelled` allowed for restaurants).
- Same user, `get` on `/customers/c1` where `c1.uid == "U1"` → **Allowed**; where `c1.uid == "U2"` → **Denied**.

Record the outcomes as a comment in the PR / commit message.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat: role-based Firestore rules for admin + restaurant orders"
```

---

### Task 3: Role routing + restaurant view shell

Splits login into two roles and adds an empty restaurant container. After this task, admins see the unchanged app; restaurant users land on a placeholder restaurant screen. Orders/order-form come in later tasks.

**Files:**
- Modify: `index.html` — HTML: add Orders nav button + `view-orders` div (lines 50–62); add a top-level `restaurantView` container after `appView`. Module script: add `ADMIN_EMAILS`, add `orders: []` to state, branch `onAuthStateChanged` (lines 115–125), add `A.onRestaurantLogin`.

**Interfaces:**
- Consumes: existing `window.APP` namespace, `FIREBASE_CONFIG`, `auth`, `db`, `onSnapshot`, `collection`.
- Produces:
  - `A.role` — `"admin"` or `"restaurant"` after login.
  - `A.myCustomer` — the restaurant's linked customer object (or `null` if unlinked), for restaurant tasks.
  - `S.orders` — array of order docs (admin side, populated in Task 4; declared here).
  - `restaurantView` DOM element with children `#restaurantBody`.
  - `A.onRestaurantLogin(uid)` — subscribes restaurant-visible data (settings, flavours, own customer, own orders) using filtered queries.
  - `A.renderers.orders` slot (registered in Task 4).

- [ ] **Step 1: Add imports for queries and timestamps**

In the module script imports (line 73–74), extend the firestore import to include `query`, `where`, `serverTimestamp`, `deleteApp`, `createUserWithEmailAndPassword`. Update the two firestore import lines and the auth import line:

```javascript
    import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword }
      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
    import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager }
      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
    import { collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, getDoc, query, where, serverTimestamp }
      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
```

(Note: line 68's existing `import { initializeApp } ...` is now replaced by the combined `initializeApp, deleteApp` line above — remove the old standalone `initializeApp` import to avoid a duplicate.)

- [ ] **Step 2: Add the Orders nav button and view container**

In the `<nav>` (lines 51–55), add an Orders button after Deliveries:

```html
      <button data-view="new" class="active">New</button>
      <button data-view="deliveries">Deliveries</button>
      <button data-view="orders">Orders <span id="ordersBadge" class="badge hidden"></span></button>
      <button data-view="dashboard">Dashboard</button>
      <button data-view="recibo">Recibo</button>
      <button data-view="settings">Settings</button>
```

In the views container (lines 58–62), add:

```html
      <div id="view-orders" class="view hidden"></div>
```

after the `view-deliveries` div.

- [ ] **Step 3: Add the restaurant view container**

Immediately after the closing `</div>` of `appView` (line 64), add:

```html
  <!-- Restaurant view (non-admin users) -->
  <div id="restaurantView" class="hidden">
    <header style="padding:12px 16px;border-bottom:1px solid var(--line)">
      <strong id="restaurantTitle">Kombucha orders</strong>
      <button class="link" id="restaurantLogout" style="float:right">Log out</button>
    </header>
    <main id="restaurantBody" style="padding:16px"></main>
  </div>
```

- [ ] **Step 4: Add a small badge style**

In the `<style>` block, add a badge rule (place near other small UI rules):

```css
    .badge { display:inline-block; min-width:18px; padding:0 5px; border-radius:9px;
      background:#c0392b; color:#fff; font-size:11px; line-height:18px; text-align:center; }
    .badge.hidden { display:none; }
```

- [ ] **Step 5: Add ADMIN_EMAILS and orders state**

After `FIREBASE_CONFIG` is defined (after line 84), add:

```javascript
    const ADMIN_EMAILS = ["roel.heremans@gmail.com", "reissnina@gmail.com"];
```

Change the state initializer (line 93) to include `orders: []`:

```javascript
    window.APP = { app, auth, db, state: { customers: [], flavours: [], deliveries: [], orders: [], settings: null }, current: {} };
```

- [ ] **Step 6: Branch the auth handler by role**

Replace the `onAuthStateChanged(auth, (user) => {...})` block (lines 115–125) with:

```javascript
    const restaurantView = document.getElementById("restaurantView");
    document.getElementById("restaurantLogout").addEventListener("click", () => signOut(auth));

    onAuthStateChanged(auth, (user) => {
      if (!user) {
        loginView.classList.remove("hidden");
        appView.classList.add("hidden");
        restaurantView.classList.add("hidden");
        return;
      }
      window.APP.user = user;
      loginView.classList.add("hidden");
      if (ADMIN_EMAILS.includes(user.email)) {
        window.APP.role = "admin";
        restaurantView.classList.add("hidden");
        appView.classList.remove("hidden");
        if (window.APP.onLogin) window.APP.onLogin();
      } else {
        window.APP.role = "restaurant";
        appView.classList.add("hidden");
        restaurantView.classList.remove("hidden");
        if (window.APP.onRestaurantLogin) window.APP.onRestaurantLogin(user.uid);
      }
    });
```

- [ ] **Step 7: Add the restaurant data layer**

After the admin `window.APP.onLogin = ...` block (after line 182), add:

```javascript
    window.APP.onRestaurantLogin = function (uid) {
      // Reference data (rules allow any signed-in user to read these).
      const settingsRef = doc(db, "settings", "app");
      onSnapshot(settingsRef, (d) => { S.settings = d.exists() ? d.data() : DEFAULT_SETTINGS; window.APP.renderRestaurant(); });
      onSnapshot(collection(db, "flavours"), (snap) => {
        S.flavours.length = 0;
        snap.forEach((d) => S.flavours.push(Object.assign({ id: d.id }, d.data())));
        window.APP.renderRestaurant();
      });
      // Own customer doc (matched by uid).
      onSnapshot(query(collection(db, "customers"), where("uid", "==", uid)), (snap) => {
        const list = [];
        snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
        window.APP.myCustomer = list[0] || null;
        window.APP.renderRestaurant();
      });
      // Own orders.
      onSnapshot(query(collection(db, "orders"), where("customerUid", "==", uid)), (snap) => {
        S.orders.length = 0;
        snap.forEach((d) => S.orders.push(Object.assign({ id: d.id }, d.data())));
        window.APP.renderRestaurant();
      });
    };
    window.APP.renderRestaurant = function () {}; // replaced in Task 6
```

- [ ] **Step 8: Verify manually in the browser**

Run: `python3 -m http.server 8000` and open `http://localhost:8000`.

- Log in as an admin email → the existing app appears with a new (empty) **Orders** tab; clicking it shows a blank panel; no console errors.
- (Restaurant path is verified in Task 6 once a login exists. For now confirm the app still fully works for admins: New/Deliveries/Dashboard/Recibo/Settings all render.)

Expected: admin app unchanged and functional; Orders tab present but empty.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "feat: role-based routing and restaurant view shell"
```

---

### Task 4: Admin Orders tab — list, badge, cancel

**Files:**
- Modify: `index.html` — module script: add `watch("orders", S.orders)` to `onLogin`; add order CRUD helpers `A.addOrder`, `A.cancelOrder`, `A.setOrderDelivered`. Add a new view IIFE `<script>` for `view-orders` (place after the deliveries-view script block).

**Interfaces:**
- Consumes: `KO.orderItemsSummary`, `KO.orderStatusLabel` (Task 1); `A.customerName`, `A.flavourName`, `A.state.settings.sizes`, `A.esc`; `A.fulfilOrder(orderId)` (produced in Task 5 — the Fulfil button calls it).
- Produces:
  - `A.addOrder(order)` → Promise (adds to `orders` collection).
  - `A.cancelOrder(orderId)` → Promise (sets `status:"cancelled"`).
  - `A.setOrderDelivered(orderId, deliveryId)` → Promise (sets `status:"delivered"`, `deliveryId`).
  - `A.renderers.orders` — renders the admin Orders tab.
  - `#ordersBadge` — shows the count of `requested` orders.

- [ ] **Step 1: Subscribe to orders in the admin data layer**

In `window.APP.onLogin` (near line 178–180), add an orders watcher next to the others:

```javascript
      watch("customers", S.customers);
      watch("flavours", S.flavours);
      watch("deliveries", S.deliveries);
      watch("orders", S.orders);
```

- [ ] **Step 2: Add order CRUD helpers**

After the existing CRUD helpers (after line 193), add:

```javascript
    window.APP.addOrder = (o) => addDoc(collection(db, "orders"), o);
    window.APP.cancelOrder = (id) => updateDoc(doc(db, "orders", id), { status: "cancelled" });
    window.APP.setOrderDelivered = (id, deliveryId) => updateDoc(doc(db, "orders", id), { status: "delivered", deliveryId });
```

- [ ] **Step 3: Add the Orders view script**

Add a new `<script>` block after the deliveries-view script (after its closing `</script>`, around line 376 area — anywhere among the view IIFEs is fine):

```html
  <script>
  document.addEventListener("DOMContentLoaded", function () {
    const A = window.APP, KO = window.KO;
    const container = document.getElementById("view-orders");
    const badge = document.getElementById("ordersBadge");

    function sortedOrders() {
      const rank = { requested: 0, delivered: 1, cancelled: 2 };
      return A.state.orders.slice().sort(function (a, b) {
        const r = (rank[a.status] || 0) - (rank[b.status] || 0);
        if (r !== 0) return r;
        const ta = (a.createdAt && a.createdAt.seconds) || 0;
        const tb = (b.createdAt && b.createdAt.seconds) || 0;
        return tb - ta;
      });
    }

    function updateBadge() {
      const n = A.state.orders.filter((o) => o.status === "requested").length;
      badge.textContent = n;
      badge.classList.toggle("hidden", n === 0);
    }

    function render() {
      updateBadge();
      const sizes = A.state.settings ? A.state.settings.sizes : [];
      const orders = sortedOrders();
      if (orders.length === 0) { container.innerHTML = "<p class='muted'>No orders yet.</p>"; return; }
      container.innerHTML = orders.map(function (o) {
        const summary = KO.orderItemsSummary(o, sizes, A.flavourName);
        const status = KO.orderStatusLabel(o.status);
        const when = o.preferredDate ? `<div class="muted">Preferred: ${A.esc(o.preferredDate)}</div>` : "";
        const note = o.note ? `<div class="muted">Note: ${A.esc(o.note)}</div>` : "";
        const actions = o.status === "requested"
          ? `<div class="row"><button class="primary" data-fulfil="${o.id}">Fulfil…</button>` +
            `<button class="link" data-cancel="${o.id}">Cancel</button></div>`
          : "";
        return `<div class="card"><strong>${A.esc(A.customerName(o.customerId))}</strong> — ${status}` +
          `<div>${A.esc(summary)}</div>${when}${note}${actions}</div>`;
      }).join("");

      container.querySelectorAll("[data-fulfil]").forEach((b) =>
        b.addEventListener("click", () => A.fulfilOrder(b.dataset.fulfil)));
      container.querySelectorAll("[data-cancel]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (confirm("Cancel this order?")) await A.cancelOrder(b.dataset.cancel);
        }));
    }

    A.renderers.orders = render;
  });
  </script>
```

- [ ] **Step 4: Verify manually**

Because there is no restaurant login yet, seed one test order directly: in the Firebase Console → Firestore, add a doc to `orders` with `customerId` = an existing customer id, `customerUid` = "test", `status` = "requested", `items` = `[{sizeId:"1L", flavourId:<a real flavour id>, quantity:8}]`, `preferredDate` = "2026-07-18".

Run: `python3 -m http.server 8000`, log in as admin, open **Orders**.

Expected:
- The order appears as a card: customer name, `⏳ Requested`, `8x 1 L <flavour>`, `Preferred: 2026-07-18`, with **Fulfil…** and **Cancel** buttons.
- The **Orders** tab shows a red badge `1`.
- Click **Cancel** → confirm → card flips to `✖ Cancelled`, badge disappears. (Fulfil is wired in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: admin Orders tab with pending list, badge, and cancel"
```

---

### Task 5: Fulfil an order — pre-fill the delivery form and mark delivered

**Files:**
- Modify: `index.html` — the delivery-form view IIFE (lines ~197–375): add module-level `fulfilling` tracking, add `A.fulfilOrder(orderId)` (mirrors `A.editDelivery`), and extend `onSave` to mark the order delivered after the delivery is created.

**Interfaces:**
- Consumes: `A.state.orders`, `A.setOrderDelivered(orderId, deliveryId)` (Task 4), existing `buildForm`, `itemRow`, `readForm`, `renderNew`.
- Produces: `A.fulfilOrder(orderId)` — switches to the New tab, pre-fills customer + item rows from the order, and remembers the order so the next successful save marks it delivered.

- [ ] **Step 1: Add fulfilling state**

In the delivery-form IIFE, next to `let editing = null;` (line 200), add:

```javascript
    let fulfilling = null; // order id being fulfilled, or null
```

- [ ] **Step 2: Clear `fulfilling` when the form resets to a plain new delivery**

In `buildForm`, the `cancelEdit` handler and other resets already set `editing = null`. Add `fulfilling = null` to the cancel-edit handler (line 326) so cancelling an edit also clears any stale fulfil link:

```javascript
      if (editing) container.querySelector("#cancelEdit").addEventListener("click", (e) => { e.preventDefault(); editing = null; fulfilling = null; built = false; renderNew(); });
```

- [ ] **Step 3: Add `A.fulfilOrder`**

After the `A.editDelivery = function (id) {...};` block (after line 372), add:

```javascript
    A.fulfilOrder = function (orderId) {
      const o = A.state.orders.find((x) => x.id === orderId);
      if (!o) return;
      editing = null;
      fulfilling = orderId;
      built = false;
      renderNew();
      container.querySelector("#cust").value = o.customerId;
      if (o.preferredDate) container.querySelector("#date").value = o.preferredDate;
      const itemsDiv = container.querySelector("#items");
      itemsDiv.innerHTML = "";
      (o.items || []).forEach((it) => itemsDiv.appendChild(itemRow(it)));
      if ((o.items || []).length === 0) itemsDiv.appendChild(itemRow());
      container.querySelector("#note").value = o.note || "";
      updateSubtotal();
      document.querySelector('nav button[data-view="new"]').click();
    };
```

- [ ] **Step 4: Mark the order delivered on save**

In `onSave` (lines 337–351), extend the non-editing branch to capture the new delivery ref and mark the order. Replace the `try { ... }` body with:

```javascript
      try {
        if (editing) { await A.updateDelivery(editing, d); editing = null; }
        else {
          d.enteredBy = A.user ? A.user.email : "";
          const ref = await A.addDelivery(d);
          if (fulfilling) { await A.setOrderDelivered(fulfilling, ref.id); fulfilling = null; }
        }
        built = false;
        renderNew();
        container.querySelector("#formErr").textContent = "Saved ✓";
      } catch (ex) { err.textContent = "Save failed: " + ex.message; }
```

- [ ] **Step 5: Verify manually**

Ensure a `requested` order exists (seed one as in Task 4 if needed). Run the server, log in as admin, open **Orders**, click **Fulfil…** on the order.

Expected:
- The app switches to the **New** tab with the customer pre-selected, the date set to the order's preferred date, and one item row per order item (size + flavour + quantity pre-filled).
- Enter empties if any, click **Save delivery**.
- Back on **Orders**, the order now shows `✅ Delivered` and the badge decrements. On **Deliveries**, the new delivery appears; **Dashboard** revenue reflects it.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: fulfil order pre-fills delivery form and marks order delivered"
```

---

### Task 6: Restaurant order form + own-orders list + cancel

**Files:**
- Modify: `index.html` — add a new `<script>` IIFE that renders into `#restaurantBody` and defines `A.renderRestaurant` (replacing the no-op stub from Task 3).

**Interfaces:**
- Consumes: `A.myCustomer`, `A.state.settings.sizes`, `A.state.flavours`, `A.state.orders`, `A.flavourName`, `A.esc`, `KO.orderItemsSummary`, `KO.orderStatusLabel`, `A.addOrder`, `A.cancelOrder`, `serverTimestamp` (via a helper on `A`).
- Produces: `A.renderRestaurant()` — full restaurant UI. Also needs a server timestamp: expose it from the module script.

- [ ] **Step 1: Expose serverTimestamp to view scripts**

In the module script, after the order CRUD helpers (Task 4, ~line 196), add:

```javascript
    window.APP.serverTimestamp = serverTimestamp;
```

- [ ] **Step 2: Add the restaurant view script**

Add a new `<script>` block after the settings-view script (near the end of the body, before `</body>`):

```html
  <script>
  document.addEventListener("DOMContentLoaded", function () {
    const A = window.APP, KO = window.KO;
    const body = document.getElementById("restaurantBody");
    const title = document.getElementById("restaurantTitle");

    function sizeOptions() {
      return (A.state.settings ? A.state.settings.sizes : [])
        .map((s) => `<option value="${s.id}">${A.esc(s.label)}</option>`).join("");
    }
    function flavourOptions() {
      return `<option value="">— choose flavour —</option>` +
        A.state.flavours.slice().sort((a, b) => a.name.localeCompare(b.name))
          .map((f) => `<option value="${f.id}">${A.esc(f.name)}</option>`).join("");
    }
    function itemRowHtml() {
      return `<div class="row order-item">` +
        `<div><label>Size</label><select class="oi-size">${sizeOptions()}</select></div>` +
        `<div><label>Flavour</label><select class="oi-flav">${flavourOptions()}</select></div>` +
        `<div style="flex:0 0 64px"><label>Qty</label><input class="oi-qty" type="number" min="1" value="1"/></div>` +
        `<button class="link oi-del" style="flex:0 0 32px">✕</button></div>`;
    }

    function myOrders() {
      const uid = A.user ? A.user.uid : null;
      return A.state.orders.filter((o) => o.customerUid === uid).slice().sort((a, b) => {
        const ta = (a.createdAt && a.createdAt.seconds) || 0;
        const tb = (b.createdAt && b.createdAt.seconds) || 0;
        return tb - ta;
      });
    }

    function render() {
      if (A.role !== "restaurant") return;
      if (!A.state.settings) { body.innerHTML = "<p class='muted'>Loading…</p>"; return; }
      if (!A.myCustomer) {
        body.innerHTML = "<div class='card'><p>Your account isn't linked to a customer yet. Please contact us.</p></div>";
        return;
      }
      title.textContent = A.myCustomer.name;
      const sizes = A.state.settings.sizes;
      const orders = myOrders();
      body.innerHTML =
        `<div class="card"><h3>New order</h3>` +
          `<div id="orderItems">${itemRowHtml()}</div>` +
          `<button class="link" id="addOrderLine">➕ Add line</button>` +
          `<label>Preferred date (optional)</label><input id="orderDate" type="date"/>` +
          `<label>Note (optional)</label><textarea id="orderNote" rows="2"></textarea>` +
          `<p id="orderErr" class="muted"></p>` +
          `<button class="primary" id="sendOrder">Send order</button></div>` +
        `<div class="card"><h3>Your orders</h3>` +
          (orders.length === 0 ? "<p class='muted'>No orders yet.</p>" :
            orders.map((o) => {
              const cancel = o.status === "requested"
                ? ` <button class="link" data-cancelmine="${o.id}">Cancel</button>` : "";
              return `<div class="row" style="justify-content:space-between">` +
                `<div><div>${A.esc(KO.orderItemsSummary(o, sizes, A.flavourName))}</div>` +
                `<div class="muted">${KO.orderStatusLabel(o.status)}${o.preferredDate ? " · " + A.esc(o.preferredDate) : ""}</div></div>` +
                `<div>${cancel}</div></div>`;
            }).join("")) +
        `</div>`;

      const itemsDiv = body.querySelector("#orderItems");
      body.querySelector("#addOrderLine").addEventListener("click", (e) => {
        e.preventDefault();
        const tmp = document.createElement("div");
        tmp.innerHTML = itemRowHtml();
        itemsDiv.appendChild(tmp.firstElementChild);
      });
      itemsDiv.addEventListener("click", (e) => {
        if (e.target.classList.contains("oi-del")) { e.preventDefault(); e.target.closest(".order-item").remove(); }
      });
      body.querySelector("#sendOrder").addEventListener("click", onSend);
      body.querySelectorAll("[data-cancelmine]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (confirm("Cancel this order?")) await A.cancelOrder(b.dataset.cancelmine);
        }));
    }

    async function onSend() {
      const err = body.querySelector("#orderErr");
      const items = [];
      body.querySelectorAll(".order-item").forEach((r) => {
        const sizeId = r.querySelector(".oi-size").value;
        const flavourId = r.querySelector(".oi-flav").value;
        const quantity = parseInt(r.querySelector(".oi-qty").value, 10) || 0;
        if (sizeId && flavourId && quantity > 0) items.push({ sizeId, flavourId, quantity });
      });
      if (items.length === 0) { err.textContent = "Add at least one bottle line with a flavour."; return; }
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
        err.textContent = "Order sent ✓";
      } catch (ex) { err.textContent = "Send failed: " + ex.message; }
    }

    A.renderRestaurant = render;
  });
  </script>
```

- [ ] **Step 3: Verify manually (needs a linked restaurant login)**

Until Task 7 exists, create a test restaurant login by hand: in Firebase Console → Authentication, add a user (email + password). Copy its **UID**. In Firestore, set that UID on a customer doc's `uid` field (add `uid` and `email`).

Open the app in a private/incognito window, log in as that restaurant user.

Expected:
- The restaurant view shows the customer name as the title, a **New order** card (size/flavour/qty rows, add line, preferred date, note), and a **Your orders** list.
- Add `8x 1L <flavour>`, tap **Send order** → "Order sent ✓"; the order appears under **Your orders** as `⏳ Requested` with a **Cancel** button.
- In the admin window, the order shows up in the **Orders** tab with a badge.
- Tap **Cancel** in the restaurant view → order becomes `✖ Cancelled`; admin badge clears.
- Confirm the restaurant user sees **no** admin nav, no other customers, no revenue.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: restaurant order form and own-orders list with cancel"
```

---

### Task 7: Create restaurant logins from Settings

**Files:**
- Modify: `index.html` — module script: add `A.createRestaurantLogin(customerId, email, password)` using a secondary Firebase app instance. Settings view IIFE (lines ~546–640): add a "Restaurant logins" card.

**Interfaces:**
- Consumes: `FIREBASE_CONFIG`, `initializeApp`, `deleteApp`, `getAuth`, `createUserWithEmailAndPassword` (imported in Task 3), `updateDoc`, `doc`, `db`, `A.state.customers`, `A.updateCustomer`, `A.esc`.
- Produces: `A.createRestaurantLogin(customerId, email, password)` → Promise. Creates the auth user without disturbing the admin session, then writes `uid` + `email` onto the customer doc.

- [ ] **Step 1: Add the account-creation helper**

In the module script, after the order CRUD helpers (~line 196), add:

```javascript
    window.APP.createRestaurantLogin = async function (customerId, email, password) {
      const name = "rlogin-" + customerId;
      let secondary;
      try { secondary = initializeApp(FIREBASE_CONFIG, name); }
      catch (e) { secondary = initializeApp(FIREBASE_CONFIG, name + "-2"); }
      try {
        const secAuth = getAuth(secondary);
        const cred = await createUserWithEmailAndPassword(secAuth, email, password);
        await updateDoc(doc(db, "customers", customerId), { uid: cred.user.uid, email });
        await signOut(secAuth);
      } finally {
        if (secondary) await deleteApp(secondary);
      }
    };
```

- [ ] **Step 2: Add the "Restaurant logins" card to Settings**

In the settings-view `render()` (before the `Backup` card, ~line 590), append this card to the `container.innerHTML` concatenation:

```javascript
        `<div class="card"><h4>Restaurant logins</h4>` +
          `<p class="muted">Create an app login so a restaurant can place their own orders.</p>` +
          `<label>Customer</label><select id="rlCust">` +
            A.state.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map((c) =>
              `<option value="${c.id}">${A.esc(c.name)}${c.uid ? " ✓ has login" : ""}</option>`).join("") +
          `</select>` +
          `<label>Login email</label><input id="rlEmail" type="email"/>` +
          `<label>Initial password</label><input id="rlPw" type="text" value=""/>` +
          `<button class="primary" id="rlCreate">Create login</button>` +
          `<p id="rlMsg" class="muted"></p></div>` +
```

(Insert this string `+` segment immediately before the `` `<div class="card"><h4>Backup</h4>` `` line.)

- [ ] **Step 3: Wire the create button**

In the settings-view `render()`, after the existing event wiring (e.g. after the `#exportBtn` handler, ~line 631+), add:

```javascript
      const rlCreate = container.querySelector("#rlCreate");
      if (rlCreate) rlCreate.addEventListener("click", async () => {
        const msg = container.querySelector("#rlMsg");
        const customerId = container.querySelector("#rlCust").value;
        const email = container.querySelector("#rlEmail").value.trim();
        const pw = container.querySelector("#rlPw").value;
        if (!customerId || !email || pw.length < 6) { msg.textContent = "Choose a customer, email, and a password of 6+ chars."; return; }
        rlCreate.disabled = true; msg.textContent = "Creating…";
        try {
          await A.createRestaurantLogin(customerId, email, pw);
          msg.textContent = "Login created ✓ — give the restaurant this email + password.";
        } catch (ex) { msg.textContent = "Failed: " + (ex.code || ex.message); }
        finally { rlCreate.disabled = false; }
      });
```

- [ ] **Step 4: Verify manually**

Run the server, log in as admin, open **Settings** → **Restaurant logins**. Pick a customer, enter a fresh email + a 6+ char password, click **Create login**.

Expected:
- Message shows "Login created ✓" and the admin session is **not** logged out (you remain on Settings as yourself).
- Re-open the customer dropdown → the chosen customer now shows "✓ has login".
- In an incognito window, log in with that new email/password → the restaurant view loads for that customer (per Task 6).
- Placing an order as that restaurant appears in the admin **Orders** tab.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: create restaurant logins from Settings via secondary app instance"
```

---

### Task 8: Documentation updates

**Files:**
- Modify: `README.md` (features list + a short "Restaurant ordering" section)
- Modify: `docs/FIREBASE_SETUP.md` (restaurant logins: in-app + console fallback; note auth now serves both roles)

**Interfaces:**
- Consumes/Produces: docs only.

- [ ] **Step 1: Update README features**

In `README.md`, under "Features", add bullets describing restaurant ordering and the admin Orders tab. Add a short section:

```markdown
## Restaurant ordering

Restaurants can place order requests from their own phone:

- An admin creates a login for the restaurant in **Settings → Restaurant
  logins** (links it to that customer).
- The restaurant logs in and sees only a **New order** form and their own
  order history — no revenue, deposits, or other customers.
- New orders appear in the admin **Orders** tab (with a pending badge). An
  admin taps **Fulfil…**, which pre-fills the normal delivery form; saving it
  records the delivery and marks the order **Delivered**.
- A restaurant can **Cancel** an order while it is still Requested.

Notifications (email/WhatsApp) are not built yet — admins see pending orders
in-app. See the design spec for the deferred plan.
```

- [ ] **Step 2: Update FIREBASE_SETUP.md**

Add a section explaining that Email/Password auth now serves both admins (allowlisted emails) and restaurants, how `firestore.rules` enforces the split, how to create a restaurant login in-app, and the console fallback (create the Auth user manually, then set its `uid` + `email` on the customer doc).

- [ ] **Step 3: Commit**

```bash
git add README.md docs/FIREBASE_SETUP.md
git commit -m "docs: document restaurant ordering and login setup"
```

---

## Notes for the implementer

- **Test what's testable automatically:** only `lib.js` has a unit harness (`npm test`). Everything else is DOM/Firebase glue verified in the browser with the exact click-throughs above. Do not fake a test framework for the UI.
- **Firebase is live, not emulated.** Manual verification touches the real project. Use throwaway test emails for restaurant logins and delete test orders/users from the console afterward.
- **Follow the IIFE-per-view pattern.** Each view script is self-contained and reads `window.APP`. Keep restaurant and admin code in separate scripts so admin logic stays untouched.
- **Escaping:** every value interpolated into `innerHTML` from data goes through `A.esc(...)`.
