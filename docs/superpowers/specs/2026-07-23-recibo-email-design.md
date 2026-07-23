# Recibo-Upload Email (text) — Design Spec

Date: 2026-07-23
Status: design complete, implementation pending

## Goal

When an admin uploads a restaurant's Recibo Verde PDF, automatically email that
restaurant to let them know. The email is **text-only** (no attachment): the
standard notice plus the **app-generated recibo text** for that customer+month,
and it points them to the app's **download section** to get the PDF for their
records. Client-side via EmailJS; best-effort; only to restaurants with a real
email.

## Decisions

- **Trigger:** fires after a successful RV upload in the Recibo view, best-effort
  (never blocks/fails the upload).
- **Recipient:** the customer's login `email` — **only if it's a real address**.
  Name-based logins are synthetic (`…@<LOGIN_NAME_DOMAIN>`, e.g. `koa@kombucha.app`)
  with no inbox → **skipped**, with a "no email on file — send manually" note.
- **Greeting:** the customer name (`{{name}}` → e.g. "Palm Spot").
- **No attachment.** The email body includes the **generated recibo text**
  (`{{recibo_text}}` from `KO.generateRecibo` for that customer+month — the same
  text used to feed Finanças / shown in the Recibo tab) and tells the restaurant
  to go to the app's download section to download the PDF for archiving.
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
- Sender `window.APP.emailRecibo(params)`:
  - No-op if `EMAILJS_CONFIG` (service/public key) or `EMAILJS_RECIBO_TEMPLATE` is
    unset. Never throws (try/catch + `.catch`).
  - POSTs to the EmailJS REST endpoint (same call shape as `notifyNewOrder`) with
    `service_id`, `template_id = EMAILJS_RECIBO_TEMPLATE`, `user_id = publicKey`,
    and `template_params: { name, to_email, recibo_text }`.
- Trigger (Recibo view upload handler): after `await A.uploadRecibo(...)`
  succeeds, best-effort:
  ```
  const cust = A.state.customers.find(c => c.id === custId);
  if (KO.isRealEmail(cust.email, LOGIN_NAME_DOMAIN)) {
    A.emailRecibo({
      name: cust.name, to_email: cust.email,
      recibo_text: KO.generateRecibo(A.state.deliveries, custId, mk,
                     A.state.settings.sizes, A.state.settings.reciboHeader, cust.nif) });
    setMsg("Uploaded ✓ — emailed " + cust.email);
  } else {
    setMsg("Uploaded ✓ — no email on file for this customer; send it manually.");
  }
  ```
  `emailRecibo` swallows its own errors so the upload UI is unaffected.

## Email template (setup doc)

New EmailJS template (in the same EmailJS account/service). Copy its **Template
ID** into `EMAILJS_RECIBO_TEMPLATE`.

- **To Email:** `{{to_email}}`
- **Subject:** `Novo recibo verde / New recibo — Real Health Kombucha`
- **Content** (PT first, then EN):

  ```
  Caro(a) {{name}},

  Está disponível um novo recibo verde, acessível a qualquer momento na aplicação
  em https://roel-heremans.github.io/kombucha-orders-app/

  Para o seu arquivo, aceda à secção de download na aplicação e transfira o PDF do
  recibo.

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

## Testing

- `lib.js`: unit-test `isRealEmail` (real address true; empty/no-`@`/synthetic
  domain false; case-insensitive).
- Manual (admin, browser, after the template exists + `EMAILJS_RECIBO_TEMPLATE`
  filled): upload an RV for a customer with a **real** login email → the restaurant
  receives the PT+EN email with the recibo details filled in. Upload for a
  **name-login** customer → no email, "send manually" note shown, upload still
  succeeds. With `EMAILJS_RECIBO_TEMPLATE` empty → upload works and nothing is
  sent (no console error).

## Rollout

- No Firebase/rules change. Dormant until `EMAILJS_RECIBO_TEMPLATE` is set.
- README/EMAILJS_SETUP note: the recibo-upload email + its template.

## Out of scope

- Attaching the PDF to the email (restaurant downloads it from the app instead).
- A separate contact-email field per customer (uses the login email).
- Emailing name-based-login customers (no inbox).
- Sending from anything other than the existing EmailJS service.
