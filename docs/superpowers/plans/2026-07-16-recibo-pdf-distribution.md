# Recibo Verde PDF Distribution Implementation Plan (Project B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins upload a restaurant's monthly Recibo Verde PDF (stored base64 in Firestore, one per customer+month, replace on re-upload) and let that restaurant download/print their own RVs after logging in.

**Architecture:** Two Firestore collections — `recibos` (light metadata, listed) and `reciboFiles` (base64 bytes, fetched only on download), both keyed `<customerId>_<monthKey>`. Admin upload lives in the Recibo view; restaurants get a "My Recibos" section. New role-based rules mirror the orders model. No Cloud Storage / Blaze.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step), Firebase v10.12.0 (Firestore + Email/Password auth) from CDN, `node --test` for pure lib logic, GitHub Pages.

## Global Constraints

- No build step; single `index.html` + `lib.js` + CDN Firebase. No bundlers/npm runtime deps.
- Pure, testable logic in `lib.js` (UMD return object) with tests in `test/lib.test.js`; run `npm test` (`node --test`).
- Firebase/DOM glue is verified **manually in the browser** (no DOM harness); steps say exactly what to do and observe.
- Each view is its own `DOMContentLoaded` IIFE reading `window.APP` (alias `A`) and `window.KO` (alias `KO`); do not merge views.
- HTML built from data must be escaped with `A.esc(...)`.
- Admin identity = allowlist `["roel.heremans@gmail.com","reissnina@gmail.com"]`, used verbatim in `firestore.rules`; the client role check already exists.
- Firebase stays on the free Spark plan; PDFs are base64 in Firestore (no Cloud Storage).
- Recibo doc id is always `<customerId>_<monthKey>` (built by `KO.reciboDocId`).
- PDF cap: raw file `size <= 700 * 1024` bytes (716800); files must be PDFs (`type === "application/pdf"` or name ends `.pdf`).
- Both `recibos` and `reciboFiles` docs carry `customerUid` so the read-own security rule can check it; restaurant list/read queries must filter by `where("customerUid","==",uid)`.
- After an `await` that triggers a Firestore write (which re-renders the active view via the snapshot listener), re-query any status/message DOM node with a fresh `querySelector`/`getElementById` before writing to it (the pre-await node may be detached).

---

### Task 1: `reciboDocId` helper in `lib.js`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

**Interfaces:**
- Produces: `KO.reciboDocId(customerId, monthKey)` → `"<customerId>_<monthKey>"`.

- [ ] **Step 1: Write the failing test**

Append to `test/lib.test.js`:

```javascript
test("reciboDocId builds a deterministic customer_month id", () => {
  assert.strictEqual(KO.reciboDocId("abc123", "2026-07"), "abc123_2026-07");
  assert.strictEqual(KO.reciboDocId("x", "2025-12"), "x_2025-12");
});
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `npm test`
Expected: FAIL — `KO.reciboDocId is not a function`.

- [ ] **Step 3: Add the implementation**

In `lib.js`, add near the other small helpers (e.g. after `reciboSizeLabel`):

```javascript
  function reciboDocId(customerId, monthKey) {
    return customerId + "_" + monthKey;
  }
```

- [ ] **Step 4: Export it**

Add `reciboDocId` to the `return { ... }` object in `lib.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add reciboDocId helper to lib.js"
```

---

### Task 2: Firestore rules for recibos + reciboFiles

**Files:**
- Modify: `firestore.rules`

**Interfaces:**
- Produces: read-own-for-restaurant, write-admin-only rules for `recibos` and `reciboFiles`.

- [ ] **Step 1: Add the two match blocks**

In `firestore.rules`, inside `match /databases/{database}/documents { ... }`, after the existing `match /orders/{id} { ... }` block, add:

```
    match /recibos/{id} {
      allow read: if isAdmin() ||
        (signedIn() && resource.data.customerUid == request.auth.uid);
      allow write: if isAdmin();
    }
    match /reciboFiles/{id} {
      allow read: if isAdmin() ||
        (signedIn() && resource.data.customerUid == request.auth.uid);
      allow write: if isAdmin();
    }
```

(`isAdmin()` and `signedIn()` already exist at the top of the rules file.)

- [ ] **Step 2: Deploy the rules (manual — human)**

In the Firebase Console → Firestore Database → **Rules**, paste the full updated `firestore.rules` and **Publish**. (No CLI configured; console is the source of truth.) This step is performed by the controller/human.

- [ ] **Step 3: Verify with the Rules Playground (manual — human)**

Confirm in the Playground:
- Admin email `roel.heremans@gmail.com`, `get` on `/recibos/x` → **Allowed**; `create` on `/recibos/x` → **Allowed**.
- Non-admin uid `U1`, `get` on `/recibos/r1` where `r1.customerUid == "U1"` → **Allowed**; where `== "U2"` → **Denied**.
- Non-admin uid `U1`, `get` on `/reciboFiles/r1` where `customerUid == "U1"` → **Allowed**; `write` → **Denied**.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat: Firestore rules for recibos + reciboFiles (read-own, write-admin)"
```

---

### Task 3: Data layer + CRUD helpers for recibos

**Files:**
- Modify: `index.html` — module script: imports (add `writeBatch`), `recibos: []` in state, admin `watch("recibos", …)`, restaurant `onRestaurantLogin` subscription, and `uploadRecibo` / `deleteRecibo` / `fetchReciboFile` helpers.

**Interfaces:**
- Consumes: existing `db`, `doc`, `collection`, `onSnapshot`, `getDoc`, `query`, `where`, `serverTimestamp`, `KO.reciboDocId`, the `watch(name, target)` helper, `S`.
- Produces:
  - `S.recibos` — array of recibo metadata docs (`{id, customerId, customerUid, monthKey, fileName, size, …}`).
  - `A.uploadRecibo(customerId, customerUid, monthKey, fileName, size, base64, uploadedBy)` → Promise (batch-writes both docs on id `<customerId>_<monthKey>`).
  - `A.deleteRecibo(id)` → Promise (batch-deletes both docs).
  - `A.fetchReciboFile(id)` → Promise<DocumentSnapshot> of `reciboFiles/<id>`.

- [ ] **Step 1: Add `writeBatch` to the firestore import**

Change the firestore import line (currently ends `…, serverTimestamp }`):

```javascript
    import { collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, getDoc, query, where, serverTimestamp, writeBatch }
      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
```

- [ ] **Step 2: Add `recibos` to state**

In the `window.APP = { … state: { … } … }` initializer, add `recibos: []`:

```javascript
    window.APP = { app, auth, db, state: { customers: [], flavours: [], deliveries: [], orders: [], recibos: [], settings: null }, current: {} };
```

- [ ] **Step 3: Watch recibos in the admin data layer**

In `window.APP.onLogin`, next to the other `watch(...)` calls, add:

```javascript
      watch("recibos", S.recibos);
```

- [ ] **Step 4: Subscribe to own recibos in the restaurant data layer**

In `window.APP.onRestaurantLogin`, after the "Own orders" `onSnapshot` block, add:

```javascript
      // Own recibos (metadata only; file bytes fetched on demand).
      onSnapshot(query(collection(db, "recibos"), where("customerUid", "==", uid)), (snap) => {
        S.recibos.length = 0;
        snap.forEach((d) => S.recibos.push(Object.assign({ id: d.id }, d.data())));
        window.APP.renderRestaurant();
      });
```

- [ ] **Step 5: Add the recibo CRUD helpers**

After the `window.APP.setOrderDelivered = …` line (near the other CRUD helpers), add:

```javascript
    window.APP.uploadRecibo = function (customerId, customerUid, monthKey, fileName, size, base64, uploadedBy) {
      const id = KO.reciboDocId(customerId, monthKey);
      const batch = writeBatch(db);
      batch.set(doc(db, "recibos", id), {
        customerId, customerUid, monthKey, fileName, size,
        uploadedAt: serverTimestamp(), uploadedBy: uploadedBy || "",
      });
      batch.set(doc(db, "reciboFiles", id), { customerUid, data: base64, contentType: "application/pdf" });
      return batch.commit();
    };
    window.APP.deleteRecibo = function (id) {
      const batch = writeBatch(db);
      batch.delete(doc(db, "recibos", id));
      batch.delete(doc(db, "reciboFiles", id));
      return batch.commit();
    };
    window.APP.fetchReciboFile = function (id) { return getDoc(doc(db, "reciboFiles", id)); };
```

- [ ] **Step 6: Syntax-check**

Run:
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;while((m=re.exec(h))){const s=m[1];if(!s.trim()||/^\s*import\s/m.test(s))continue;i++;try{new Function(s)}catch(e){console.log("ERR",e.message);bad++}}console.log("classic blocks",i,"errors",bad)'
```
Expected: `classic blocks 7 errors 0`.

- [ ] **Step 7: Run unit tests (guard lib)**

Run: `npm test`
Expected: PASS (no lib change here beyond Task 1).

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: recibos data layer + upload/delete/fetch helpers"
```

---

### Task 4: Admin upload UI in the Recibo view

**Files:**
- Modify: `index.html` — the `view-recibo` IIFE (render ~738–769).

**Interfaces:**
- Consumes: `A.uploadRecibo`, `A.deleteRecibo`, `KO.reciboDocId`, `KO.windowLabel`, `A.state.recibos`, `A.state.customers`, `A.user`, `A.esc`, the view's existing `custId` / `mk`.
- Produces: an Upload card + uploaded-list under the recibo text, for the selected customer + month.

- [ ] **Step 1: Add the uploader + list to the render**

In the recibo view `render()`, the `container.innerHTML` currently ends with the copy card (or the "choose a customer" hint). Append an upload section when a customer is selected. Add a helper inside the IIFE and include its output:

```javascript
    const MAX_PDF = 700 * 1024;

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const s = String(reader.result);
          const comma = s.indexOf(",");
          resolve(comma >= 0 ? s.slice(comma + 1) : s);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function uploaderHtml(custId, mk, cust) {
      const uploads = A.state.recibos
        .filter((r) => r.customerId === custId)
        .slice().sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1));
      const linked = cust && cust.uid;
      const listHtml = uploads.length
        ? uploads.map((r) =>
            `<div class="row" style="justify-content:space-between">` +
            `<div>${A.esc(KO.windowLabel(r.monthKey, r.monthKey))} — ${A.esc(r.fileName)}</div>` +
            `<button class="link" data-delrec="${r.id}">Delete</button></div>`).join("")
        : "<p class='muted'>No RV PDFs uploaded for this customer.</p>";
      return `<div class="card"><h4>Upload RV PDF</h4>` +
        (linked
          ? `<p class="muted">For ${A.esc(cust.name)} · ${A.esc(KO.windowLabel(mk, mk))} (replaces any existing PDF for that month).</p>` +
            `<input id="ruFile" type="file" accept="application/pdf"/>` +
            `<button class="primary" id="ruUpload">Upload PDF</button>`
          : `<p class="muted">This customer has no app login yet — create one in Settings → Restaurant logins before uploading their recibos.</p>`) +
        `<p id="ruMsg" class="muted"></p>` +
        `<h4 style="margin-top:12px">Uploaded recibos</h4>${listHtml}</div>`;
    }
```

Then, in the `container.innerHTML = …` assignment, when `custId` is set, append `uploaderHtml(custId, mk, cust)`. The current code computes `cust` only inside the text block; ensure `cust` is available in render scope, e.g. near the top of the `if (custId)`: it already does `const cust = A.state.customers.find((c) => c.id === custId);` — hoist that lookup so it's in scope for the uploader. Concretely, change the innerHTML tail so the customer branch becomes:

```javascript
        (custId
          ? `<div class="card"><pre id="rtext">${A.esc(text)}</pre>` +
              `<button class="primary" id="copyBtn">Copy to clipboard</button>` +
              `<p id="copyMsg" class="muted"></p></div>` +
              uploaderHtml(custId, mk, A.state.customers.find((c) => c.id === custId))
          : `<p class="muted">Choose a customer to generate the recibo text.</p>`);
```

- [ ] **Step 2: Wire the upload + delete handlers**

After the existing copy-button wiring in `render()`, add:

```javascript
      const ruUpload = container.querySelector("#ruUpload");
      if (ruUpload) ruUpload.addEventListener("click", async () => {
        const fileInput = container.querySelector("#ruFile");
        const file = fileInput && fileInput.files && fileInput.files[0];
        const setMsg = (t) => { const m = container.querySelector("#ruMsg"); if (m) m.textContent = t; };
        if (!file) { setMsg("Choose a PDF file first."); return; }
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        if (!isPdf) { setMsg("Only PDF files are allowed."); return; }
        if (file.size > MAX_PDF) { setMsg("PDF too large (max 700 KB). Please shrink it and try again."); return; }
        const cust = A.state.customers.find((c) => c.id === custId);
        if (!cust || !cust.uid) { setMsg("This customer has no app login yet."); return; }
        ruUpload.disabled = true; setMsg("Uploading…");
        try {
          const base64 = await fileToBase64(file);
          await A.uploadRecibo(custId, cust.uid, mk, file.name, file.size, base64, A.user ? A.user.email : "");
          const m = container.querySelector("#ruMsg"); if (m) m.textContent = "Uploaded ✓";
        } catch (ex) {
          const m = container.querySelector("#ruMsg"); if (m) m.textContent = "Upload failed: " + (ex.code || ex.message);
          const b = container.querySelector("#ruUpload"); if (b) b.disabled = false;
        }
      });

      container.querySelectorAll("[data-delrec]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (confirm("Delete this recibo PDF?")) await A.deleteRecibo(b.dataset.delrec);
        }));
```

(Note: `custId` and `mk` are already in `render()` scope. On success the recibos snapshot re-renders the view, refreshing the list; the message is re-queried after the await per the global constraint.)

- [ ] **Step 3: Syntax-check**

Run the same syntax-check command as Task 3 Step 6. Expected: `classic blocks 7 errors 0`.

- [ ] **Step 4: Manual verification (deferred to controller/human — needs live Firebase + rules deployed)**

As admin, Recibo tab, pick a customer that has a login + a month → an **Upload RV PDF** card appears. Choose a small PDF, **Upload** → "Uploaded ✓", and it appears under "Uploaded recibos". Re-upload for the same month → replaces (still one row). A **non-PDF** or a **>700 KB** file is rejected with the right message. A customer **without** a login shows the "create a login first" note instead of the uploader. **Delete** removes the row. Pick a customer with no login to confirm the disabled state.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: admin RV PDF upload + management in the Recibo view"
```

---

### Task 5: Restaurant "My Recibos" section + download

**Files:**
- Modify: `index.html` — the restaurant view IIFE (render ~915–1013).

**Interfaces:**
- Consumes: `A.state.recibos`, `A.user`, `A.fetchReciboFile`, `KO.windowLabel`, `A.esc`.
- Produces: a "My Recibos" card under "Your orders" with Download/Print per row.

- [ ] **Step 1: Add a base64→Blob helper in the restaurant IIFE**

Near the top of the restaurant view IIFE (after `const body = …`), add:

```javascript
    function base64ToBlob(b64, type) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: type || "application/pdf" });
    }

    function myRecibos() {
      const uid = A.user ? A.user.uid : null;
      return A.state.recibos.filter((r) => r.customerUid === uid)
        .slice().sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1));
    }
```

- [ ] **Step 2: Render the My Recibos card**

In the restaurant `render()`, after the "Your orders" card string (the one that ends `…toggleCleared…</p>` : "") + `</div>``), append a My Recibos card. Add to the `body.innerHTML` concatenation, right before the final `;`:

```javascript
        + `<div class="card"><h3>My Recibos</h3>` +
          (myRecibos().length
            ? myRecibos().map((r) =>
                `<div class="row" style="justify-content:space-between">` +
                `<div>${A.esc(KO.windowLabel(r.monthKey, r.monthKey))}<div class="muted">${A.esc(r.fileName)}</div></div>` +
                `<button class="link" data-getrec="${r.id}">Download / Print</button></div>`).join("")
            : "<p class='muted'>No recibos yet.</p>") +
          `<p id="recMsg" class="muted"></p></div>`
```

- [ ] **Step 3: Wire the download handler**

In the restaurant `render()`, after the existing order/cancel/clear handlers, add:

```javascript
      body.querySelectorAll("[data-getrec]").forEach((b) =>
        b.addEventListener("click", async () => {
          const win = window.open("", "_blank"); // opened within the user gesture (avoids popup block)
          const setMsg = (t) => { const m = body.querySelector("#recMsg"); if (m) m.textContent = t; };
          try {
            const snap = await A.fetchReciboFile(b.dataset.getrec);
            if (!snap.exists()) { if (win) win.close(); setMsg("That recibo is no longer available."); return; }
            const d = snap.data();
            const url = URL.createObjectURL(base64ToBlob(d.data, d.contentType));
            if (win) win.location.href = url; else window.location.href = url;
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          } catch (ex) {
            if (win) win.close();
            setMsg("Could not open the recibo: " + (ex.code || ex.message));
          }
        }));
```

- [ ] **Step 4: Syntax-check**

Run the same syntax-check command as Task 3 Step 6. Expected: `classic blocks 7 errors 0`.

- [ ] **Step 5: Manual verification (deferred to controller/human — needs live Firebase + an uploaded recibo)**

Log in as a restaurant (incognito) that has an uploaded recibo. A **My Recibos** card lists their month(s) with a **Download / Print** button; tapping it opens the PDF in a new tab (viewable/printable). A restaurant with none shows "No recibos yet." Confirm (per rules) a restaurant cannot see another restaurant's recibos.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: restaurant My Recibos section with download/print"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** B1 admin upload (Task 4) + data layer/helpers (Task 3) + id helper (Task 1); B2 restaurant download (Task 5); storage split `recibos`/`reciboFiles` keyed `<customerId>_<monthKey>` (Tasks 1/3); rules (Task 2); size + type validation, login precondition, replace-on-reupload, delete-admin-only all in Task 4; download opens new tab (Task 5). ✓
- **Types consistent:** `uploadRecibo(customerId, customerUid, monthKey, fileName, size, base64, uploadedBy)` matches the Task 4 call; `deleteRecibo(id)` / `fetchReciboFile(id)` use the `<customerId>_<monthKey>` id from `recibos` doc ids; both docs carry `customerUid`; restaurant queries filter by `customerUid`. ✓
- **No placeholders.** All steps carry real code and exact commands.

## Notes for the implementer

- Only `lib.js` has an automated harness (Task 1 is true TDD). Tasks 3–5 are Firebase/DOM glue verified manually; Task 2 is a rules change verified via the Playground. Tasks 2, 4, 5 manual verification touch live Firebase and are performed by the controller/human.
- `writeBatch` makes the two-doc upload/delete atomic. `readAsDataURL` yields base64 directly (no manual chunking). The restaurant download pre-opens the tab within the click gesture to dodge popup blockers.
- Escape every data value interpolated into `innerHTML` with `A.esc(...)`.
- Re-query message nodes after any `await` that triggers a Firestore write (the snapshot re-render detaches the pre-await node).
```
