# Customer Email Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show a per-customer email-deliverability badge (and a header count) in the admin Settings → Customers card.

**Architecture:** One tested pure helper `KO.customerEmailStatus` in `lib.js`; the Customers-card render in `index.html` maps it to colored pills plus a header count. No behavior change to email/upload.

**Tech Stack:** Vanilla JS single-file app (`index.html` + UMD `lib.js`), `node --test`, no build step.

## Global Constraints

- No new dependencies, no build step, no new script tags.
- Reuse `isRealEmail`; the synthetic domain comes from `A.loginNameDomain` (exposed on `window.APP`) in the render, and is passed explicitly to the pure helper in tests.
- The Settings render block (index.html:1211) already aliases `const A = window.APP, KO = window.KO;`.
- Escape any interpolated customer data with `A.esc(...)`.
- `npm test` must stay green (73 existing + new test).

---

### Task 1: `customerEmailStatus` helper in `lib.js`

**Files:**
- Modify: `lib.js` (add after `isRealEmail`, which ends at line 508; add to the exports object at line 631)
- Test: `test/lib.test.js` (add after the `isRealEmail` test)

**Interfaces:**
- Consumes: `isRealEmail` (already in `lib.js`).
- Produces: `KO.customerEmailStatus(customer, syntheticDomain) -> "none" | "synthetic" | "real"`. `"none"` when `customer` is falsy or has no `uid`; otherwise `"real"`/`"synthetic"` by `isRealEmail(customer.email, syntheticDomain)`.

- [ ] **Step 1: Write the failing test**

Add to `test/lib.test.js`, immediately after the `isRealEmail` test block (which ends around line 623):

```javascript
test("customerEmailStatus classifies login/email state", () => {
  assert.strictEqual(KO.customerEmailStatus({ uid: "u1", email: "paula@palmspot.pt" }, "kombucha.app"), "real");
  assert.strictEqual(KO.customerEmailStatus({ uid: "u2", email: "koa@kombucha.app" }, "kombucha.app"), "synthetic");
  assert.strictEqual(KO.customerEmailStatus({ email: "x@y.pt" }, "kombucha.app"), "none"); // no uid = no login
  assert.strictEqual(KO.customerEmailStatus(null, "kombucha.app"), "none");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `KO.customerEmailStatus is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `lib.js` immediately after the `isRealEmail` function (after line 508):

```javascript
  function customerEmailStatus(customer, syntheticDomain) {
    if (!customer || !customer.uid) return "none";
    return isRealEmail(customer.email, syntheticDomain) ? "real" : "synthetic";
  }
```

- [ ] **Step 4: Add to exports**

In the `return { ... }` object (line 631), add `customerEmailStatus` next to `isRealEmail`:

```javascript
loginEmail, isRealEmail, customerEmailStatus,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 74 tests green.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "Add customerEmailStatus helper (none/synthetic/real)"
```

---

### Task 2: Email badges + header count in the Customers card

**Files:**
- Modify: `index.html` — `<style>` block (before `</style>`); the Customers card render (~line 1234-1247)

**Interfaces:**
- Consumes: `KO.customerEmailStatus` (Task 1), `A.loginNameDomain`, `A.esc`.
- Produces: visual badges + header count (no new JS interface).

- [ ] **Step 1: Add the pill CSS**

In `index.html`, immediately before `</style>`, add:

```css
    .pill { display:inline-block; font-size:11px; padding:2px 8px; border-radius:10px; vertical-align:middle; }
    .pill-ok { background:#e6f4ea; color:#1e6b3a; }
    .pill-muted { background:#f0efe9; color:#777; }
```

- [ ] **Step 2: Add the header count and per-row badge**

In `index.html`, the Customers card currently renders (lines 1234-1248):

```javascript
        `<div class="card"><details><summary>Customers (${A.state.customers.length})</summary>` +
          `<p class="muted">Set each customer's type, NIF and notes. Add new customers from the New delivery screen.</p>` +
          A.state.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map((c) =>
            `<div class="cust-edit" data-cid="${c.id}" style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px">` +
            `<label>Name</label><input class="c-name" value="${A.esc(c.name)}"/>` +
            `<div class="row"><div><label>Type</label><select class="c-type">` +
              `<option value="restaurant" ${(c.type||"restaurant")==="restaurant"?"selected":""}>Restaurant</option>` +
              `<option value="private" ${c.type==="private"?"selected":""}>Private</option>` +
            `</select></div>` +
            `<div><label>NIF</label><input class="c-nif" value="${A.esc(c.nif||"")}"/></div></div>` +
            `<label>Notes</label><input class="c-notes" value="${A.esc(c.notes||"")}"/>` +
            `<div class="row"><button class="link c-save">Save</button>` +
            `<button class="link" data-delcust="${c.id}" style="flex:0 0 60px">Delete</button></div>` +
            `</div>`).join("") +
          `</details></div>` +
```

Replace that whole block with (adds a `realEmailCount` in the summary and an
`emailBadge` at the top of each row; the `.map` becomes a block body):

```javascript
        `<div class="card"><details><summary>Customers (${A.state.customers.length}) — ${A.state.customers.filter((c) => KO.customerEmailStatus(c, A.loginNameDomain) === "real").length} with email</summary>` +
          `<p class="muted">Set each customer's type, NIF and notes. Add new customers from the New delivery screen.</p>` +
          A.state.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map((c) => {
            const status = KO.customerEmailStatus(c, A.loginNameDomain);
            const emailBadge = status === "real"
              ? `<span class="pill pill-ok">✉ ${A.esc(c.email)}</span>`
              : status === "synthetic"
                ? `<span class="pill pill-muted">name login — no email</span>`
                : `<span class="pill pill-muted">no login</span>`;
            return `<div class="cust-edit" data-cid="${c.id}" style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px">` +
            `<div style="margin-bottom:4px">${emailBadge}</div>` +
            `<label>Name</label><input class="c-name" value="${A.esc(c.name)}"/>` +
            `<div class="row"><div><label>Type</label><select class="c-type">` +
              `<option value="restaurant" ${(c.type||"restaurant")==="restaurant"?"selected":""}>Restaurant</option>` +
              `<option value="private" ${c.type==="private"?"selected":""}>Private</option>` +
            `</select></div>` +
            `<div><label>NIF</label><input class="c-nif" value="${A.esc(c.nif||"")}"/></div></div>` +
            `<label>Notes</label><input class="c-notes" value="${A.esc(c.notes||"")}"/>` +
            `<div class="row"><button class="link c-save">Save</button>` +
            `<button class="link" data-delcust="${c.id}" style="flex:0 0 60px">Delete</button></div>` +
            `</div>`;
          }).join("") +
          `</details></div>` +
```

Note: only the `<summary>` text and the added `emailBadge` line are new; the rest
of each row (Name/Type/NIF/Notes/Save/Delete and all event-handler hooks like
`.c-name`, `data-cid`, `data-delcust`) is unchanged, so existing save/delete
handlers keep working.

- [ ] **Step 3: Verify tests still pass**

Run: `npm test`
Expected: 74 pass (no lib change in this task; confirms nothing broke).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Show email-deliverability badge and count in Customers card"
```

---

## Manual verification (browser, after implementation)

Admin → Settings → expand **Customers**:
1. Each customer shows a badge: green `✉ <email>` for real logins, grey `name login — no email` for `@kombucha.app` logins, grey `no login` for customers without a login.
2. The header reads `Customers (N) — M with email`, M matching the number of green badges (should be the same real-email set as the console list: Koa Spot, Balancal, Palm Spot, Sun Spot, roel_test).
3. Editing/saving/deleting a customer still works unchanged.
