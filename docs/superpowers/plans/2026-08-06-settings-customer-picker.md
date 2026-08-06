# Settings Customer Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stacked per-customer edit blocks in admin Settings → Customers with a dropdown that renders only the selected customer's block.

**Architecture:** Task 1 extracts the existing per-customer markup into a `customerBlockHtml(c)` function with no behaviour change. Task 2 replaces the `.map()` over all customers with a `<select>` plus a single call to that function, storing the selection in `A.current.settingsCust` so it survives the wholesale `container.innerHTML` re-render that fires on every Firestore snapshot.

**Tech Stack:** Vanilla JS single-file app (`index.html` + UMD `lib.js`), `node --test` unit tests, no build step.

## Global Constraints

- Single-file app: no new dependencies, no build step, no new script tags.
- No new `lib.js` logic and no new unit tests — the status mapping reuses the existing `KO.customerEmailStatus(customer, syntheticDomain)`, which returns `"real"` / `"synthetic"` / `"none"`.
- `npm test` must stay at **78/78** as a regression check.
- `index.html` has NO automated coverage and a syntax error there blanks the entire admin UI. After editing, verify the edited `<script>` block parses — extract it to a temp file and run `node --check`. A hand-counted brace tally is NOT acceptable evidence.
- Selection state must live in `A.current.settingsCust`, never in the DOM. The settings renderer does `container.innerHTML = …` on every snapshot; DOM-held selection would be lost. Precedent: `A.current.reciboCust` at `index.html:1250` with a `<select>` calling `render()` on change at `index.html:1274`.
- Do NOT modify the per-customer block's inner markup, its CSS class names, the `.c-save` handler, or the Send App Invite wiring. This is a rendering change; those were shipped and reviewed separately.
- Manual browser verification is deferred to the human — implementers must NOT claim to have performed it.
- **All line numbers in this plan are as of the commit before Task 1.** Task 1 inserts roughly 28 lines, so every reference in Task 2 will have shifted down by about that much. Locate each edit site by matching the quoted code, not by jumping to the line number.

---

### Task 1: Extract `customerBlockHtml(c)` (pure refactor, no behaviour change)

**Files:**
- Modify: `index.html:1360-1391` (replace the inline `.map()` callback body with a call to a new function)
- Modify: `index.html:1338` area (add the new function beside `customerInUse` / `flavourInUse`)

**Interfaces:**
- Consumes: `KO.customerEmailStatus(c, A.loginNameDomain)`, `A.esc(str)`.
- Produces: `customerBlockHtml(c) -> string` — the full `<div class="cust-edit" data-cid="…">…</div>` markup for one customer, identical to what the current `.map()` callback returns. Task 2 calls it.

- [ ] **Step 1: Add the function**

In `index.html`, immediately after the `flavourInUse` line (currently `index.html:1339`), add:

```javascript
    function customerBlockHtml(c) {
      const status = KO.customerEmailStatus(c, A.loginNameDomain);
      const emailBadge = status === "real"
        ? `<span class="pill pill-ok">✉ ${A.esc(c.email)}</span>`
        : status === "synthetic"
          ? `<span class="pill pill-muted">name login — no email</span>`
          : `<span class="pill pill-muted">no login</span>`;
      return `<div class="cust-edit" data-cid="${c.id}" style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px">` +
      `<div style="margin-bottom:4px">${emailBadge}</div>` +
      `<label>Name</label><input class="c-name" value="${A.esc(c.name)}"/>` +
      `<label>Contact person</label><input class="c-contact" value="${A.esc(c.contact||"")}"/>` +
      `<div class="row"><div><label>Type</label><select class="c-type">` +
        `<option value="restaurant" ${(c.type||"restaurant")==="restaurant"?"selected":""}>Restaurant</option>` +
        `<option value="private" ${c.type==="private"?"selected":""}>Private</option>` +
      `</select></div>` +
      `<div><label>NIF</label><input class="c-nif" value="${A.esc(c.nif||"")}"/></div></div>` +
      `<label>Notes</label><input class="c-notes" value="${A.esc(c.notes||"")}"/>` +
      (status === "real"
        ? `<div class="row"><button class="link c-invite">Send App Invite</button></div>` +
          `<div class="c-invite-box hidden">` +
            `<label>Password to include</label><input class="c-invite-pw" type="text"/>` +
            `<p class="muted">Will be sent to ${A.esc(c.email)}</p>` +
            `<div class="row"><button class="link c-invite-send">Send</button>` +
            `<button class="link c-invite-cancel">Cancel</button></div>` +
            `<p class="muted c-invite-msg"></p></div>`
        : status === "synthetic"
          ? `<p class="muted">Name login — no inbox to invite.</p>`
          : `<p class="muted">No login yet — create one in Customers Login below first.</p>`) +
      `<div class="row"><button class="link c-save">Save</button>` +
      `<button class="link" data-delcust="${c.id}" style="flex:0 0 60px">Delete</button></div>` +
      `</div>`;
    }
```

This is the current `.map()` callback body verbatim, with `return` kept and the `const status` / `const emailBadge` lines moved inside the function.

- [ ] **Step 2: Call it from the render**

Replace the whole `.map()` call (currently `index.html:1360-1391`, from `A.state.customers.slice().sort(...).map((c) => {` through `}).join("") +`) with:

```javascript
          A.state.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(customerBlockHtml).join("") +
```

Everything else in the card — the `<div class="card"><details><summary>…` line above and the `</details></div>` line below — stays exactly as it is.

- [ ] **Step 3: Verify the script block still parses**

Extract the inline `<script>` blocks from `index.html` to temp files and run `node --check` on each (the `type="module"` block as `.mjs`, the classic blocks as `.js`).
Expected: all blocks pass, 0 failures.

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: PASS, 78/78. (No test touches `index.html`; this is a regression check.)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Extract customerBlockHtml from the Settings customers render"
```

---

### Task 2: Dropdown picker with selection in `A.current.settingsCust`

**Files:**
- Modify: `index.html` — the Customers card render (the `<details>` block that currently maps all customers)
- Modify: `index.html` — the settings render's handler section (add the `#setCust` change listener)
- Modify: `index.html:1470-1474` area — the `[data-delcust]` handler

**Interfaces:**
- Consumes: `customerBlockHtml(c)` from Task 1, `KO.customerEmailStatus`, `A.esc`, `A.current`, `render()`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Compute the selection before building the HTML**

In `render()`, immediately after the `if (!st) { … return; }` guard and before `container.innerHTML = …`, add:

```javascript
      const sortedCustomers = A.state.customers.slice().sort((a,b)=>a.name.localeCompare(b.name));
      // Resolve against live state: the selected customer may have been deleted on
      // another device, and the resulting snapshot re-render must not try to draw it.
      const selCust = A.state.customers.find((c) => c.id === A.current.settingsCust) || null;
```

- [ ] **Step 2: Replace the customer list with a dropdown plus one block**

Replace the single line added in Task 1 Step 2:

```javascript
          A.state.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(customerBlockHtml).join("") +
```

with:

```javascript
          `<label>Customer</label><select id="setCust">` +
            `<option value="">— choose customer —</option>` +
            sortedCustomers.map((c) => {
              const cs = KO.customerEmailStatus(c, A.loginNameDomain);
              const suffix = cs === "real" ? " ✉" : cs === "synthetic" ? " — name login" : " — no login";
              return `<option value="${c.id}" ${selCust && c.id === selCust.id ? "selected" : ""}>${A.esc(c.name)}${suffix}</option>`;
            }).join("") +
          `</select>` +
          (selCust ? customerBlockHtml(selCust) : "") +
```

Note `selCust && c.id === selCust.id` — without the guard this throws on every render with no selection, which is the default state.

- [ ] **Step 3: Update the helper text above the dropdown**

The line above currently reads:

```javascript
          `<p class="muted">Set each customer's type, NIF and notes. Add new customers from the New delivery screen.</p>` +
```

Replace with:

```javascript
          `<p class="muted">Choose a customer to edit their details. Add new customers from the New delivery screen.</p>` +
```

- [ ] **Step 4: Wire the dropdown**

In the handler section of `render()`, next to the other `container.querySelector(...)` listeners (e.g. just after the `#saveSettings` listener), add:

```javascript
      const setCustSel = container.querySelector("#setCust");
      if (setCustSel) setCustSel.addEventListener("change", (e) => {
        A.current.settingsCust = e.target.value;
        render();
      });
```

- [ ] **Step 5: Clear the selection when the selected customer is deleted**

The delete handler currently reads:

```javascript
      container.querySelectorAll("[data-delcust]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (customerInUse(b.dataset.delcust)) { alert("Cannot delete: this customer has deliveries."); return; }
          if (confirm("Delete this customer?")) await A.deleteCustomer(b.dataset.delcust);
        }));
```

Replace with:

```javascript
      container.querySelectorAll("[data-delcust]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (customerInUse(b.dataset.delcust)) { alert("Cannot delete: this customer has deliveries."); return; }
          if (confirm("Delete this customer?")) {
            // Drop the selection first: leaving it set would point at a customer
            // that no longer exists, giving an empty card and a stale dropdown.
            if (A.current.settingsCust === b.dataset.delcust) A.current.settingsCust = "";
            await A.deleteCustomer(b.dataset.delcust);
          }
        }));
```

- [ ] **Step 6: Verify the script block still parses**

Extract the inline `<script>` blocks from `index.html` to temp files and run `node --check` on each.
Expected: all blocks pass, 0 failures.

- [ ] **Step 7: Run the test suite**

Run: `npm test`
Expected: PASS, 78/78.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Show one customer at a time in Settings via a picker"
```

---

## Manual verification (by Roel, after merge)

`index.html` has no automated coverage, so these must be checked in a browser:

1. Settings → Customers opens showing the dropdown and **no** customer block.
2. The dropdown lists every customer alphabetically with a status suffix (` ✉`, ` — name login`, ` — no login`) matching the badge shown inside each block.
3. Selecting a customer renders exactly one block, with the correct badge and the correct one of the three invite states.
4. Editing a field and pressing Save shows "Saved ✓", keeps the same customer selected, and the value persists after a reload.
5. Deleting the selected customer (one with no deliveries) resets the card to "— choose customer —" and removes the name from the dropdown.
6. The Send App Invite flow still works exactly as before for a customer with a real email login.
