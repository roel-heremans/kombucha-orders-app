# Recibo-Upload Email (text) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin uploads a restaurant's Recibo Verde PDF, automatically send that restaurant a text-only EmailJS email (PT then EN) containing the app-generated recibo details and a pointer to the app's download section.

**Architecture:** One pure helper in `lib.js` (`isRealEmail`) decides whether a login is a real inbox. `index.html` gets a new `EMAILJS_RECIBO_TEMPLATE` constant and an `emailRecibo` sender that mirrors the existing `notifyNewOrder` REST call, wired into the Recibo upload handler as a best-effort side effect after a successful upload.

**Tech Stack:** Vanilla JS single-file app (`index.html` + UMD `lib.js`), EmailJS REST API, `node --test` unit tests, no build step.

## Global Constraints

- Single-file app: no new dependencies, no build step, no new script tags.
- EmailJS reuses the existing `EMAILJS_CONFIG.serviceId` and `EMAILJS_CONFIG.publicKey`; only the template id is new (`EMAILJS_RECIBO_TEMPLATE`).
- The feature is **dormant** until `EMAILJS_RECIBO_TEMPLATE` is a non-empty string — no email is sent and no console error occurs when it is empty.
- The email send is **best-effort**: it never throws, is not awaited by upload logic, and never blocks or fails the RV upload.
- Only send to a **real** email; name-based synthetic logins (`…@kombucha.app`, the `LOGIN_NAME_DOMAIN`) are skipped with a "send manually" note.
- The synthetic domain constant is `LOGIN_NAME_DOMAIN = "kombucha.app"` (index.html:104).
- `KO.generateRecibo(deliveries, customerId, mk, sizes, header, nif)` produces the recibo text (lib.js:382).
- After any `await`, re-query DOM nodes before touching them (existing stale-DOM pattern in the upload handler).

---

### Task 1: `isRealEmail` helper in `lib.js`

**Files:**
- Modify: `lib.js` (add function near `loginEmail` at line 500; add to the exports object at line 626)
- Test: `test/lib.test.js` (add after the `loginEmail` test at line 608)

**Interfaces:**
- Consumes: nothing.
- Produces: `KO.isRealEmail(email, syntheticDomain) -> boolean`. True when `email` is a non-empty string containing `@` whose domain is not `syntheticDomain` (case-insensitive). False for empty/null, no-`@`, or the synthetic domain.

- [ ] **Step 1: Write the failing test**

Add to `test/lib.test.js` (after line 613, the end of the `loginEmail` test):

```javascript
test("isRealEmail accepts real addresses and rejects synthetic name logins", () => {
  assert.strictEqual(KO.isRealEmail("paula@palmspot.pt", "kombucha.app"), true);
  assert.strictEqual(KO.isRealEmail("koa@kombucha.app", "kombucha.app"), false);
  assert.strictEqual(KO.isRealEmail("Koa@Kombucha.App", "kombucha.app"), false); // case-insensitive
  assert.strictEqual(KO.isRealEmail("", "kombucha.app"), false);
  assert.strictEqual(KO.isRealEmail(null, "kombucha.app"), false);
  assert.strictEqual(KO.isRealEmail("noatsign", "kombucha.app"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `KO.isRealEmail is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `lib.js` immediately after the `loginEmail` function (after line 503):

```javascript
  function isRealEmail(email, syntheticDomain) {
    const s = String(email == null ? "" : email).trim().toLowerCase();
    return s.indexOf("@") !== -1 && !s.endsWith("@" + String(syntheticDomain).toLowerCase());
  }
```

- [ ] **Step 4: Add to exports**

In the `return { ... }` object at line 626, add `isRealEmail` next to `loginEmail`:

```javascript
loginEmail, isRealEmail,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests green (73 total).

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "Add isRealEmail helper to distinguish real inboxes from name logins"
```

---

### Task 2: `EMAILJS_RECIBO_TEMPLATE` config + `emailRecibo` sender in `index.html`

**Files:**
- Modify: `index.html` (add constant after line 107; add sender after the `notifyNewOrder` block, which ends at line 321)

**Interfaces:**
- Consumes: `EMAILJS_CONFIG` (`serviceId`, `publicKey`), `EMAILJS_RECIBO_TEMPLATE`.
- Produces: `window.APP.emailRecibo(params)` — best-effort; sends an EmailJS email using `EMAILJS_RECIBO_TEMPLATE` with `template_params = params`. `params` is `{ name, to_email, recibo_text }`. No-op (returns without sending) if `serviceId`, `publicKey`, or `EMAILJS_RECIBO_TEMPLATE` is empty. Never throws.

- [ ] **Step 1: Add the template-id constant**

In `index.html`, immediately after line 107 (the `EMAILJS_CONFIG` line), add:

```javascript
    const EMAILJS_RECIBO_TEMPLATE = ""; // new template for recibo-upload emails; empty = disabled
```

- [ ] **Step 2: Add the `emailRecibo` sender**

In `index.html`, immediately after the `notifyNewOrder` function's closing `};` (line 321), add:

```javascript
    window.APP.emailRecibo = async function (params) {
      const c = EMAILJS_CONFIG;
      if (!c.serviceId || !c.publicKey || !EMAILJS_RECIBO_TEMPLATE) return; // disabled until configured
      try {
        const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_id: c.serviceId,
            template_id: EMAILJS_RECIBO_TEMPLATE,
            user_id: c.publicKey,
            template_params: params || {},
          }),
        });
        if (!res.ok) console.warn("emailRecibo: EmailJS HTTP", res.status);
      } catch (e) {
        console.warn("emailRecibo failed:", e);
      }
    };
```

- [ ] **Step 3: Verify the app still loads and tests pass**

Run: `npm test`
Expected: PASS (no lib change, but confirms nothing broke).
Manual sanity: open `index.html`; in the browser console confirm `typeof APP.emailRecibo === "function"` and no load-time errors. With `EMAILJS_RECIBO_TEMPLATE` empty, `APP.emailRecibo({})` resolves without a network call or console error.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add EMAILJS_RECIBO_TEMPLATE config and emailRecibo sender"
```

---

### Task 3: Fire the recibo email after a successful upload

**Files:**
- Modify: `index.html` (the `#ruUpload` click handler success branch, line 1138-1139)

**Interfaces:**
- Consumes: `KO.isRealEmail` (Task 1), `window.APP.emailRecibo` (Task 2), `KO.generateRecibo`, `LOGIN_NAME_DOMAIN`, and the handler's in-scope `custId`, `mk`, `cust`, `A.state`.
- Produces: user-visible upload confirmation that reports whether an email was sent.

- [ ] **Step 1: Replace the success line with the email trigger**

In `index.html`, replace this line (currently line 1139):

```javascript
          await A.uploadRecibo(custId, cust.uid, mk, file.name, file.size, base64, A.user ? A.user.email : "");
          const m = container.querySelector("#ruMsg"); if (m) m.textContent = "Uploaded ✓";
```

with:

```javascript
          await A.uploadRecibo(custId, cust.uid, mk, file.name, file.size, base64, A.user ? A.user.email : "");
          let msg = "Uploaded ✓";
          if (KO.isRealEmail(cust.email, LOGIN_NAME_DOMAIN)) {
            A.emailRecibo({
              name: cust.name,
              to_email: cust.email,
              recibo_text: KO.generateRecibo(A.state.deliveries, custId, mk, A.state.settings.sizes, A.state.settings.reciboHeader, cust.nif),
            });
            msg = "Uploaded ✓ — emailed " + cust.email;
          } else {
            msg = "Uploaded ✓ — no email on file; send it manually.";
          }
          const m = container.querySelector("#ruMsg"); if (m) m.textContent = msg;
```

Notes: `emailRecibo` is intentionally **not awaited** (best-effort); it swallows its own errors. `cust` is already resolved earlier in the handler (line 1127) and guaranteed to have a `.uid` (checked at line 1128). The `#ruMsg` node is re-queried after the `await`, matching the existing stale-DOM pattern.

- [ ] **Step 2: Verify tests pass**

Run: `npm test`
Expected: PASS (no lib change; confirms nothing broke).

- [ ] **Step 3: Manual verification**

Manual (admin, browser): with `EMAILJS_RECIBO_TEMPLATE` still empty, upload a valid PDF for a customer whose login is a **real** email → status shows `Uploaded ✓ — emailed <email>`, upload succeeds, no console error (send is a no-op while disabled). Upload for a customer with a name-login (`…@kombucha.app`) → status shows `Uploaded ✓ — no email on file; send it manually.`. (Full send is verified in Task 4 once the template exists.)

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Email restaurant with recibo details after RV upload"
```

---

### Task 4: EmailJS template setup doc + README note

**Files:**
- Modify: `docs/EMAILJS_SETUP.md` (append a "Recibo-upload email" section)
- Modify: `README.md` (add a one-line mention where notifications/emails are described)

**Interfaces:**
- Consumes: nothing (documentation).
- Produces: instructions to create the new template and fill `EMAILJS_RECIBO_TEMPLATE`.

- [ ] **Step 1: Append the recibo-template section to `docs/EMAILJS_SETUP.md`**

Add a new section at the end of `docs/EMAILJS_SETUP.md`:

```markdown
## Recibo-upload email (optional)

When an admin uploads a Recibo Verde PDF, the app can email the restaurant with
the recibo details and a pointer to the app's download section. This uses a
**separate template** (reusing the same EmailJS service and public key).

1. In EmailJS, create a new Email Template.
2. Set **To Email** to `{{to_email}}`.
3. Set the **Subject** to: `Novo recibo verde / New recibo — Real Health Kombucha`
4. Set the **Content** to (Portuguese first, then English):

   ```
   Caro(a) {{name}},

   Está disponível um novo recibo verde, acessível a qualquer momento na
   aplicação em https://roel-heremans.github.io/kombucha-orders-app/

   Para o seu arquivo, aceda à secção de download na aplicação e transfira o PDF
   do recibo.

   Detalhes do recibo:
   {{recibo_text}}

   Obrigado pelas suas encomendas anteriores e esperamos que aprecie a nossa Real
   Health Kombucha no futuro.

   Com os melhores cumprimentos,
   Real Health Kombucha

   ─────────────

   Dear {{name}},

   A new recibo verde can be found in the app at any time at
   https://roel-heremans.github.io/kombucha-orders-app/

   To keep it for your records, please go to the download section in the app and
   download the recibo PDF.

   Recibo details:
   {{recibo_text}}

   Thank you for your past orders, and we hope you'll enjoy our Real Health
   Kombucha in the future.

   Best regards,
   Real Health Kombucha
   ```

5. Note the template's **Template ID** and put it in `index.html` as
   `EMAILJS_RECIBO_TEMPLATE`. Leave it empty to keep the feature off.

Only customers who log in with a **real email** receive this. Name-based logins
(`…@kombucha.app`) have no inbox and are skipped — the upload screen tells you to
send those manually.
```

- [ ] **Step 2: Add a one-line note to `README.md`**

Find the section describing email/WhatsApp notifications in `README.md` and add one line noting that uploading a Recibo Verde emails the restaurant with the recibo details (setup in `docs/EMAILJS_SETUP.md`). Match the surrounding prose style.

- [ ] **Step 3: Commit**

```bash
git add docs/EMAILJS_SETUP.md README.md
git commit -m "Document recibo-upload email template and setup"
```

---

## Manual end-to-end verification (after Task 4, requires a live template)

Once the EmailJS template exists and `EMAILJS_RECIBO_TEMPLATE` is filled in:

1. As admin, upload an RV PDF for a customer with a real login email → the restaurant receives the PT+EN email with `{{recibo_text}}` populated by the month's deliveries.
2. Upload for a name-login customer → no email; status shows the "send manually" note; upload still succeeds.
3. Confirm the `{{recibo_text}}` content matches what the Recibo tab shows for that customer+month (both come from `KO.generateRecibo`).
