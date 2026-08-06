# App Invite Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Send App Invite" button to each customer in admin Settings → Customers that emails them the app URL, their login address and their password (Portuguese first, English underneath) via a new EmailJS template.

**Architecture:** One pure helper in `lib.js` (`inviteEmailParams`) builds the EmailJS `template_params` and decides whether a customer is invitable. `index.html` gets a new `EMAILJS_INVITE_TEMPLATE` constant, an `emailInvite` sender that mirrors `emailRecibo` but **returns a success boolean instead of swallowing failures**, and a per-customer button that reveals an inline password field. The password is typed by the admin at send time because the app cannot retrieve it.

**Tech Stack:** Vanilla JS single-file app (`index.html` + UMD `lib.js`), EmailJS REST API, `node --test` unit tests, no build step.

## Global Constraints

- Single-file app: no new dependencies, no build step, no new script tags.
- EmailJS reuses the existing `EMAILJS_CONFIG.serviceId` and `EMAILJS_CONFIG.publicKey`; only the template id is new (`EMAILJS_INVITE_TEMPLATE`).
- The feature is **dormant** until `EMAILJS_INVITE_TEMPLATE` is a non-empty string — no email is sent, and the UI reports the failure rather than pretending it sent.
- The synthetic login domain constant is `LOGIN_NAME_DOMAIN = "kombucha.app"` (index.html:112), exposed to non-module scripts as `A.loginNameDomain` (index.html:134).
- Unlike `notifyNewOrder` and `emailRecibo`, the invite send is **not** best-effort: `emailInvite` returns `true`/`false` and the UI must show the real outcome.
- All reads of the new `contact` field must tolerate it being absent — every existing customer document lacks it.
- `lib.js` is a UMD module: add functions inside the factory and register them in the single exports object at `lib.js:663`.
- Tests are `node --test`; run with `npm test` from the repo root.
- Existing customer eligibility helper: `KO.customerEmailStatus(customer, syntheticDomain)` returns `"real"` / `"synthetic"` / `"none"` (lib.js:537-539).

---

### Task 1: `inviteEmailParams` helper in `lib.js`

**Files:**
- Modify: `lib.js` (add function after `orderEmailParams`, which ends at line 491; add name to the exports object at line 663)
- Test: `test/lib.test.js` (append after the `customerEmailStatus` test which ends at line 630)

**Interfaces:**
- Consumes: `isRealEmail(email, syntheticDomain)` (already defined at `lib.js:532`).
- Produces: `KO.inviteEmailParams(customer, password, syntheticDomain) -> object | null`. Returns `null` when the customer is falsy, has no `uid`, has a non-real email, or the password is empty/whitespace. Otherwise returns `{ contact_name, to_email, login_email, password }` where `contact_name` is `customer.contact` trimmed, falling back to `customer.name`.

- [ ] **Step 1: Write the failing test**

Append to `test/lib.test.js`:

```javascript
test("inviteEmailParams builds template params for an invitable customer", () => {
  const c = { uid: "u1", name: "Palheiro Estate", contact: "Sr. Luis",
              email: "luis.emanuel@palheiroestate.com" };
  assert.deepStrictEqual(KO.inviteEmailParams(c, "KombuchaCasaVelha108", "kombucha.app"), {
    contact_name: "Sr. Luis",
    to_email: "luis.emanuel@palheiroestate.com",
    login_email: "luis.emanuel@palheiroestate.com",
    password: "KombuchaCasaVelha108",
  });
});

test("inviteEmailParams falls back to the customer name when contact is blank", () => {
  const base = { uid: "u1", name: "See - Kelly", email: "seemadeira@mail.com" };
  const expect = (c) => KO.inviteEmailParams(c, "pw123456", "kombucha.app").contact_name;
  assert.strictEqual(expect(base), "See - Kelly");
  assert.strictEqual(expect(Object.assign({}, base, { contact: "" })), "See - Kelly");
  assert.strictEqual(expect(Object.assign({}, base, { contact: "   " })), "See - Kelly");
});

test("inviteEmailParams returns null when the customer cannot be invited", () => {
  const ok = { uid: "u1", name: "See - Kelly", email: "seemadeira@mail.com" };
  // no login yet
  assert.strictEqual(KO.inviteEmailParams({ name: "X", email: "x@y.pt" }, "pw123456", "kombucha.app"), null);
  // synthetic address has no inbox
  assert.strictEqual(KO.inviteEmailParams({ uid: "u2", name: "Koa", email: "koa@kombucha.app" }, "pw123456", "kombucha.app"), null);
  // nothing to send
  assert.strictEqual(KO.inviteEmailParams(ok, "", "kombucha.app"), null);
  assert.strictEqual(KO.inviteEmailParams(ok, "   ", "kombucha.app"), null);
  assert.strictEqual(KO.inviteEmailParams(ok, null, "kombucha.app"), null);
  // no customer
  assert.strictEqual(KO.inviteEmailParams(null, "pw123456", "kombucha.app"), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `TypeError: KO.inviteEmailParams is not a function`

- [ ] **Step 3: Write the implementation**

Insert into `lib.js` immediately after the `orderEmailParams` function (after line 491, before `whatsappOrderText`):

```javascript
  function inviteEmailParams(customer, password, syntheticDomain) {
    if (!customer || !customer.uid) return null;
    if (!isRealEmail(customer.email, syntheticDomain)) return null;
    const pw = String(password == null ? "" : password).trim();
    if (!pw) return null;
    const contact = String(customer.contact == null ? "" : customer.contact).trim();
    return {
      contact_name: contact || customer.name,
      to_email: customer.email,
      login_email: customer.email,
      password: String(password),
    };
  }
```

Then add `inviteEmailParams` to the exports object at `lib.js:663`, immediately after `orderEmailParams,`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "Add inviteEmailParams helper for the app invite email"
```

---

### Task 2: `contact` person field in Settings → Customers

**Files:**
- Modify: `index.html:1338` (customer edit block markup — add the input after the Name field)
- Modify: `index.html:1385-1390` (the `.c-save` handler's `updateCustomer` payload)

**Interfaces:**
- Consumes: `window.APP.updateCustomer(id, obj)` (index.html:287), `A.esc(str)` for HTML escaping.
- Produces: customer documents may now carry an optional `contact` string. Task 4 reads it indirectly through `KO.inviteEmailParams`.

- [ ] **Step 1: Add the input to the customer edit block**

In `index.html`, find this line (1338):

```javascript
            `<label>Name</label><input class="c-name" value="${A.esc(c.name)}"/>` +
```

Replace it with:

```javascript
            `<label>Name</label><input class="c-name" value="${A.esc(c.name)}"/>` +
            `<label>Contact person</label><input class="c-contact" value="${A.esc(c.contact||"")}"/>` +
```

The `||""` matters: every existing customer document lacks `contact`, and `A.esc(undefined)` would render the string "undefined" into the input.

- [ ] **Step 2: Persist it in the save handler**

In the `.c-save` click handler (index.html:1385-1390), find:

```javascript
            await A.updateCustomer(card.dataset.cid, {
              name: card.querySelector(".c-name").value.trim(),
              type: card.querySelector(".c-type").value,
              nif: card.querySelector(".c-nif").value.trim(),
              notes: card.querySelector(".c-notes").value.trim(),
            });
```

Replace with:

```javascript
            await A.updateCustomer(card.dataset.cid, {
              name: card.querySelector(".c-name").value.trim(),
              contact: card.querySelector(".c-contact").value.trim(),
              type: card.querySelector(".c-type").value,
              nif: card.querySelector(".c-nif").value.trim(),
              notes: card.querySelector(".c-notes").value.trim(),
            });
```

- [ ] **Step 3: Verify the existing tests still pass**

Run: `npm test`
Expected: PASS — no test touches `index.html`, this confirms nothing else broke.

- [ ] **Step 4: Manual verification**

Open the app as an admin, go to Settings → Customers, expand a customer. Confirm:
- A "Contact person" input appears under Name and is **empty** (not "undefined").
- Type a value, press Save, see "Saved ✓".
- Reload the page and reopen the customer — the value is still there.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add optional contact person field to customers"
```

---

### Task 3: `EMAILJS_INVITE_TEMPLATE` config and the `emailInvite` sender

**Files:**
- Modify: `index.html:116` (add the template constant after `EMAILJS_RECIBO_TEMPLATE`)
- Modify: `index.html:359` (add `emailInvite` after the `emailRecibo` function)

**Interfaces:**
- Consumes: `EMAILJS_CONFIG` (index.html:115).
- Produces: `window.APP.emailInvite(params) -> Promise<boolean>`. Resolves `true` only on a successful EmailJS response; `false` when the feature is unconfigured, the request throws, or the response is not OK. Never throws. Task 4 calls it.

- [ ] **Step 1: Add the config constant**

In `index.html`, after line 116:

```javascript
    const EMAILJS_RECIBO_TEMPLATE = "template_37xzu1n"; // new template for recibo-upload emails; empty = disabled
```

add:

```javascript
    const EMAILJS_INVITE_TEMPLATE = ""; // app-invite emails (see docs/EMAILJS_SETUP.md); empty = disabled
```

It stays empty until the EmailJS template exists — Task 5 documents how to create it.

- [ ] **Step 2: Add the sender**

In `index.html`, immediately after the `emailRecibo` function closes (line 359, the `};` before `window.APP.toast`), add:

```javascript
    // Unlike notifyNewOrder/emailRecibo this reports success: a silently failed
    // invite would leave the admin thinking a customer had been told about the app.
    window.APP.emailInvite = async function (params) {
      const c = EMAILJS_CONFIG;
      if (!c.serviceId || !c.publicKey || !EMAILJS_INVITE_TEMPLATE) return false;
      try {
        const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_id: c.serviceId,
            template_id: EMAILJS_INVITE_TEMPLATE,
            user_id: c.publicKey,
            template_params: params || {},
          }),
        });
        if (!res.ok) console.warn("emailInvite: EmailJS HTTP", res.status);
        return res.ok;
      } catch (e) {
        console.warn("emailInvite failed:", e);
        return false;
      }
    };
```

- [ ] **Step 3: Verify the existing tests still pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Open the app as admin, open the browser console and run:

```javascript
await window.APP.emailInvite({ to_email: "x@y.z" })
```

Expected: `false` — because `EMAILJS_INVITE_TEMPLATE` is still empty. This confirms the dormant path returns a real failure rather than a misleading success.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add emailInvite sender and invite template config"
```

---

### Task 4: "Send App Invite" button and send interaction

**Files:**
- Modify: `index.html:1336-1347` (customer edit block markup — add the invite row)
- Modify: `index.html:1381-1393` (the per-customer handler block — convert the concise arrow to a block body and add the invite wiring)

**Interfaces:**
- Consumes: `KO.inviteEmailParams(customer, password, syntheticDomain)` (Task 1), `window.APP.emailInvite(params)` (Task 3), the `contact` field (Task 2), `KO.customerEmailStatus(customer, syntheticDomain)` (lib.js:537), `A.loginNameDomain` (index.html:134), `A.toast(msg, isError)` (index.html:361).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the invite markup to the customer block**

In the customer block template, find the closing row (index.html:1345-1346):

```javascript
            `<div class="row"><button class="link c-save">Save</button>` +
            `<button class="link" data-delcust="${c.id}" style="flex:0 0 60px">Delete</button></div>` +
```

Insert **before** it a block that renders one of three things depending on eligibility. Add this immediately after the Notes input line (1344):

```javascript
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
```

`status` is already computed at line 1330 (`const status = KO.customerEmailStatus(c, A.loginNameDomain);`) — reuse it, do not recompute.

The address is shown next to the password field on purpose: the email carries working credentials, so confirming the destination before sending is the one cheap guard against mailing them to the wrong person.

- [ ] **Step 2: Wire up the three buttons**

The existing handler at index.html:1381-1393 uses a **concise arrow body**, so there is nowhere to add a second listener yet:

```javascript
      container.querySelectorAll(".cust-edit").forEach((card) =>
        card.querySelector(".c-save").addEventListener("click", async () => {
          ...
        }));
```

First convert it to a block body, then add the invite wiring alongside the save listener. Replace the whole `container.querySelectorAll(".cust-edit").forEach(...)` statement (index.html:1381-1393) with:

```javascript
      container.querySelectorAll(".cust-edit").forEach((card) => {
        card.querySelector(".c-save").addEventListener("click", async () => {
          const save = card.querySelector(".c-save");
          try {
            await A.updateCustomer(card.dataset.cid, {
              name: card.querySelector(".c-name").value.trim(),
              contact: card.querySelector(".c-contact").value.trim(),
              type: card.querySelector(".c-type").value,
              nif: card.querySelector(".c-nif").value.trim(),
              notes: card.querySelector(".c-notes").value.trim(),
            });
            save.textContent = "Saved ✓";
          } catch (e) { save.textContent = "Save failed"; }
        });

        const invite = card.querySelector(".c-invite");
        if (invite) {
          const box = card.querySelector(".c-invite-box");
          const pw = card.querySelector(".c-invite-pw");
          const msg = card.querySelector(".c-invite-msg");
          const send = card.querySelector(".c-invite-send");
          invite.addEventListener("click", () => {
            box.classList.toggle("hidden");
            if (!box.classList.contains("hidden")) pw.focus();
          });
          card.querySelector(".c-invite-cancel").addEventListener("click", () => {
            box.classList.add("hidden"); pw.value = ""; msg.textContent = "";
          });
          send.addEventListener("click", async () => {
            const cust = A.state.customers.find((x) => x.id === card.dataset.cid);
            const params = KO.inviteEmailParams(cust, pw.value, A.loginNameDomain);
            if (!params) { msg.textContent = "Enter the password to include."; return; }
            send.disabled = true; msg.textContent = "Sending…";
            const ok = await A.emailInvite(params);
            send.disabled = false;
            if (ok) {
              box.classList.add("hidden"); pw.value = ""; msg.textContent = "";
              A.toast("Invite sent to " + params.to_email);
            } else {
              // Keep the typed password: it is the one thing the admin cannot recover from the app.
              msg.textContent = "Send failed — check the EmailJS template is configured.";
            }
          });
        }
      });
```

Two things to get right here. The `forEach` now ends with `});` (block body) instead of the original `}));` — a mismatched paren here is a silent syntax error that blanks the whole Settings view. And the customer is looked up fresh from `A.state.customers` at click time rather than closing over the `c` from render, so an edit saved in between is picked up.

Also update the **Files** line for this task: the handler replacement covers `index.html:1381-1393`, not 1382-1393 — the `forEach` opening line is part of the replacement.

- [ ] **Step 3: Verify the existing tests still pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Manual verification**

As admin, open Settings → Customers and confirm all three states render correctly:
- A customer with a real email and a login shows the **Send App Invite** button.
- A customer with a `…@kombucha.app` login shows "Name login — no inbox to invite."
- A customer with no login shows "No login yet — create one in Customers Login below first."

Then on a real-email customer: click Send App Invite, confirm the password box opens showing the right destination address. Click Send with the field empty → "Enter the password to include." Type anything and Send → "Send failed — check the EmailJS template is configured." (expected while `EMAILJS_INVITE_TEMPLATE` is empty), and confirm **the typed password is still in the field**. Click Cancel → the box closes and clears.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add Send App Invite button to Settings -> Customers"
```

---

### Task 5: Document the EmailJS invite template

**Files:**
- Modify: `docs/EMAILJS_SETUP.md` (append a new section after the "Recibo-upload email" section, before "### Deliverability")

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Append the section**

Add to `docs/EMAILJS_SETUP.md`, immediately before the `### Deliverability (staying out of spam)` heading:

````markdown
## App invite email (optional)

Settings → Customers has a **Send App Invite** button for every customer that has
a login *and* a real email address. It emails them the app link, their login
address and their password. The password is **typed by the admin when sending** —
the app cannot look it up, because only a hash is stored in Firebase Auth.

1. In EmailJS, create a new Email Template.
2. Set **To Email** to `{{to_email}}`.
3. Set the **Subject** to:
   `Aplicação de encomendas / Ordering app — Real Health Kombucha`
4. Set **From Name** to the static text `Real Health Kombucha`.
5. Set **Reply To** to a real address you monitor (e.g. `roel.heremans@gmail.com`).
6. Set the **Content** to (Portuguese first, then English):

   ```
   Caro(a) {{contact_name}},

   Para simplificar as suas encomendas de kombucha, criámos uma aplicação onde
   pode encomendar diretamente, a qualquer momento.

   Aplicação:      https://roel-heremans.github.io/kombucha-orders-app/
   Utilizador:     {{login_email}}
   Palavra-passe:  {{password}}

   Na aplicação pode fazer as suas encomendas, acompanhar o estado de cada uma e
   transferir os seus recibos verdes. A aplicação está disponível em português e
   em inglês.

   Ficamos ao seu dispor para qualquer esclarecimento.

   Com os melhores cumprimentos,
   Real Health Kombucha

   ─────────────

   Dear {{contact_name}},

   To make ordering kombucha easier, we have set up an app where you can place
   your orders directly, at any time.

   App:       https://roel-heremans.github.io/kombucha-orders-app/
   Username:  {{login_email}}
   Password:  {{password}}

   In the app you can place orders, follow the status of each one, and download
   your recibos verdes. The app is available in Portuguese and English.

   Please do not hesitate to contact us if you have any questions.

   Best regards,
   Real Health Kombucha
   ```

7. Note the template's **Template ID** and put it in `index.html` as
   `EMAILJS_INVITE_TEMPLATE`. Leave it empty to keep the feature off.

The greeting uses the customer's **Contact person** field when set, falling back
to the customer name. Set it in Settings → Customers so the email opens
"Caro(a) Sr. Luis" rather than "Caro(a) Palheiro Estate".

**Note:** this email contains a working password in plain text. Check the
destination address shown next to the password field before sending.
````

- [ ] **Step 2: Commit**

```bash
git add docs/EMAILJS_SETUP.md
git commit -m "Document the EmailJS app invite template"
```

---

## Post-implementation (manual, by Roel)

The feature stays dormant until these are done — they need the EmailJS dashboard,
which the implementation cannot reach:

1. Create the template per `docs/EMAILJS_SETUP.md`.
2. Paste its Template ID into `EMAILJS_INVITE_TEMPLATE` in `index.html`.
3. Send one invite to your own address first and check the PT/EN body, the From
   Name and the Reply To all render correctly before sending to a customer.
