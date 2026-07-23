# Recibo-Upload Email (with PDF / text) — Design Spec

Date: 2026-07-23
Status: design complete, implementation pending

## Goal

When an admin uploads a restaurant's Recibo Verde PDF, automatically email that
restaurant to let them know, with the just-uploaded **PDF attached** (and, passed
alongside, the app-generated recibo text as a fallback). Client-side via EmailJS;
best-effort; only to restaurants with a real email.

## Decisions

- **Trigger:** fires after a successful RV upload in the Recibo view, best-effort
  (never blocks/fails the upload).
- **Recipient:** the customer's login `email` — **only if it's a real address**.
  Name-based logins are synthetic (`…@<LOGIN_NAME_DOMAIN>`, e.g. `koa@kombucha.app`)
  with no inbox → **skipped**, with a "no email on file — send manually" note.
- **Greeting:** the customer name (`{{name}}` → e.g. "Palm Spot").
- **Attachment (Phase 1):** the uploaded PDF, via EmailJS. **We test whether the
  plan allows attachments.** The code also passes the **generated recibo text**
  (`{{recibo_text}}` from `KO.generateRecibo` for that customer+month — the same
  text used to feed Finanças / on the PDF), so the **Phase-2 fallback** (if
  attachments need a paid plan) is a **template-only edit**: swap the "also
  attached" line for `{{recibo_text}}`, no code change.
- **Text:** the standard body in **Portuguese first, then English** (typos
  cleaned: "recibo verde", "hope you'll enjoy").
- Reuses the existing EmailJS **service + public key**; adds one new **template**.

## `lib.js` — `isRealEmail(email, syntheticDomain)`

Pure, unit-tested:
```
isRealEmail(email, syntheticDomain) ->
  !!email && email.indexOf("@") !== -1 && !email.toLowerCase().endsWith("@" + syntheticDomain)
```
True for real addresses; false for empty, non-`@`, or the synthetic login domain.

## `index.html`

- Config: `const EMAILJS_RECIBO_TEMPLATE = "";` next to `EMAILJS_CONFIG` (empty →
  the recibo email is disabled, like the other EmailJS features).
- Sender `window.APP.emailRecibo(params, contentBase64, filename)`:
  - No-op if `EMAILJS_CONFIG` (service/public key) or `EMAILJS_RECIBO_TEMPLATE` is
    unset. Never throws (try/catch + `.catch`).
  - POSTs to the EmailJS REST endpoint with `service_id`, `template_id =
    EMAILJS_RECIBO_TEMPLATE`, `user_id = publicKey`, and `template_params`:
    `{ name, to_email, recibo_text, recibo_content: contentBase64, recibo_filename: filename }`.
    (`recibo_content` is the base64 PDF; the Phase-1 template configures it as a
    **variable attachment**. If the REST path can't carry attachments in testing,
    switch this sender to the `@emailjs/browser` SDK — noted for the setup phase.)
- Trigger (Recibo view upload handler): after `await A.uploadRecibo(...)`
  succeeds, best-effort:
  ```
  const cust = A.state.customers.find(c => c.id === custId);
  if (KO.isRealEmail(cust.email, LOGIN_NAME_DOMAIN)) {
    A.emailRecibo(
      { name: cust.name, to_email: cust.email,
        recibo_text: KO.generateRecibo(A.state.deliveries, custId, mk,
                       A.state.settings.sizes, A.state.settings.reciboHeader, cust.nif) },
      base64, file.name);
    setMsg("Uploaded ✓ — emailed " + cust.email);
  } else {
    setMsg("Uploaded ✓ — no email on file for this customer; send it manually.");
  }
  ```
  (`base64` is already computed for the upload; reuse it.) `emailRecibo` swallows
  its own errors so the upload UI is unaffected.

## Email template (setup doc)

New EmailJS template (in the same EmailJS account/service). Copy its **Template
ID** into `EMAILJS_RECIBO_TEMPLATE`.

- **To Email:** `{{to_email}}`
- **Subject:** `Novo recibo verde / New recibo — Real Health Kombucha`
- **Attachment:** a **Variable Attachment**, content parameter `recibo_content`
  (base64), filename parameter `recibo_filename`.
- **Content** (PT first, then EN):

  ```
  Caro(a) {{name}},

  Está disponível um novo recibo verde, acessível a qualquer momento na aplicação
  em https://roel-heremans.github.io/kombucha-orders-app/

  O novo recibo segue também em anexo a este email.

  Obrigado pelas suas encomendas anteriores e esperamos que aprecie a nossa Real
  Health Kombucha no futuro.

  Com os melhores cumprimentos,
  Real Health Kombucha

  ─────────────

  Dear {{name}},

  A new recibo verde can be found in the app at any time at
  https://roel-heremans.github.io/kombucha-orders-app/

  The new recibo is also attached to this email.

  Thank you for your past orders, and we hope you'll enjoy our Real Health
  Kombucha in the future.

  Best regards,
  Real Health Kombucha
  ```

- **Phase-2 fallback** (only if attachments need a paid plan): remove the
  attachment, and replace each "… também em anexo …" / "… also attached …" line
  with the recibo text, e.g. add `{{recibo_text}}` where the details should go.
  The code already sends `recibo_text`, so this is a **template-only** change.

## Testing

- `lib.js`: unit-test `isRealEmail` (real address true; empty/no-`@`/synthetic
  domain false; case-insensitive).
- Manual (admin, browser, after the template exists + `EMAILJS_RECIBO_TEMPLATE`
  filled): upload an RV for a customer with a **real** login email → the restaurant
  receives the PT+EN email; verify the **attachment** arrives (this is the plan
  test). Upload for a **name-login** customer → no email, "send manually" note
  shown, upload still succeeds. With `EMAILJS_RECIBO_TEMPLATE` empty → upload works
  and nothing is sent (no console error).

## Rollout

- No Firebase/rules change. Dormant until `EMAILJS_RECIBO_TEMPLATE` is set.
- README/EMAILJS_SETUP note: the recibo-upload email + its template.

## Out of scope

- A separate contact-email field per customer (uses the login email).
- Emailing name-based-login customers (no inbox).
- Sending from anything other than the existing EmailJS service.
