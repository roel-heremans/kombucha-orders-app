# App Invite Email — Design Spec

Date: 2026-08-06
Status: design complete, implementation pending

## Goal

Add a **"Send App Invite"** button to each customer in admin **Settings →
Customers**. Pressing it emails that customer a standard invitation to use the
ordering app, containing the app URL, their login address, and their password.
Replaces the invite email Roel currently writes by hand. Portuguese first,
English underneath. Client-side via EmailJS, reusing the existing service and
public key with one new template.

## Decisions

- **Password is supplied by the admin at send time.** The app *cannot* retrieve
  it: `createRestaurantLogin` passes the password straight to Firebase Auth and
  persists only `uid` and `email` (`index.html:394-395`). Firebase stores a hash.
  Client-side code also cannot set a new password for another user —
  `updatePassword` requires being signed in as that user — so the only
  alternative would be a reset-email flow. Rejected in favour of matching the
  existing hand-written email. Clicking the button reveals an inline password
  field; the admin types the password they chose when creating the login.
- **Plaintext password in email — accepted trade-off.** Explicitly chosen by the
  user. The invite carries working credentials, so a wrong address mails them to
  a stranger. Mitigation is limited to showing the destination address on the
  confirm step (see UI below); no further mitigation in scope.
- **New optional `contact` field per customer** for the greeting, because
  `customer.name` is usually a venue ("See - Kelly", "Casa Velha") and
  `Caro(a) See - Kelly` reads badly. Falls back to `name` when blank.
- **Eligibility:** the button appears only when
  `customerEmailStatus(c, LOGIN_NAME_DOMAIN) === "real"`. That single check is
  exactly the right condition — it returns `"none"` without a `uid` (no login
  exists, so an invite is meaningless) and `"synthetic"` for `@kombucha.app`
  addresses (no inbox to receive it) (`lib.js:537-539`). The other two cases show
  a muted explanatory hint instead of a disabled button.
- **Send result is reported, not swallowed.** Deliberate divergence from
  `notifyNewOrder` / `emailRecibo`, which log failures to `console.warn` and
  return `undefined` (`index.html:321-359`). Best-effort is fine for an alert to
  your own inbox; it is wrong here, because a silent failure leaves the admin
  believing a customer was invited when they were not.
- **Out of scope (YAGNI):** no "invited at" timestamp, no bulk send, no resend
  tracking, no change-password screen.

## Email copy

Lives in the EmailJS template, not in the repo (same as the recibo template).
Variables: `{{contact_name}}`, `{{login_email}}`, `{{password}}`.

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

The app URL is hard-coded in the template body (as it already is in the recibo
template) rather than passed as a variable — one less thing to get wrong, and it
is not going to change.

The PT/EN language note is accurate: the restaurant view has a working language
toggle (`langToggleHtml`, persisted under `ko_lang`). The copy deliberately does
**not** tell customers to change their password — the app has no such screen.

## Data model

`customers/{id}` gains one optional field:

- `contact` — string, the contact person for the greeting (e.g. `"Sr. Luis"`).
  Absent/blank on every existing document; all reads must tolerate that.

No `firestore.rules` change: `match /customers/{id}` already restricts writes to
`isAdmin()`.

## `lib.js` — `inviteEmailParams(customer, password, syntheticDomain)`

Pure and unit-tested, following the existing `orderEmailParams` pattern
(`lib.js:483-491`). Returns the EmailJS `template_params` object, or `null` when
the customer is not invitable.

```
inviteEmailParams(customer, password, syntheticDomain) ->
  null  if !customer
     or !customer.uid                                  (no login exists)
     or !isRealEmail(customer.email, syntheticDomain)  (synthetic / no inbox)
     or !password or !String(password).trim()          (nothing to send)
  else {
    contact_name: (customer.contact || "").trim() || customer.name,
    to_email:     customer.email,
    login_email:  customer.email,
    password:     String(password),
  }
```

`to_email` and `login_email` are the same value by construction — the app uses a
single `email` field for both routing and login (`index.html:395`). They are kept
as separate template variables so the template reads clearly and so the two can
diverge later without a template rewrite.

Export it from the module's return object at `lib.js:663`.

## `index.html`

**Config.** `const EMAILJS_INVITE_TEMPLATE = "";` beside `EMAILJS_RECIBO_TEMPLATE`
(`index.html:116`). Empty → feature disabled, matching the other two.

**Sender.** `window.APP.emailInvite(params)` — modelled on `emailRecibo`
(`index.html:341-359`) but **returns a boolean and does not swallow failures**:

- returns `false` if `EMAILJS_CONFIG.serviceId` / `publicKey` /
  `EMAILJS_INVITE_TEMPLATE` is unset, or the POST throws, or `res.ok` is false
- returns `true` only on a successful response

**UI — Settings → Customers.** In the per-customer block
(`index.html:1336-1347`):

- Add `<label>Contact person</label><input class="c-contact" .../>` under Name,
  populated from `c.contact || ""`.
- Add `contact: card.querySelector(".c-contact").value.trim()` to the object
  passed to `updateCustomer` in the `.c-save` handler (`index.html:1382-1393`).
- Render, per eligibility above, either:
  - `"real"` → `<button class="link c-invite">Send App Invite</button>`
  - `"synthetic"` → muted `name login — no inbox to invite`
  - `"none"` → muted `no login yet — create one below first`

**Send interaction.** Clicking `c-invite` reveals an inline row holding a text
input for the password, the destination address in muted text so the admin can
confirm it before sending, and Send / Cancel. On Send:

1. Build params via `KO.inviteEmailParams(customer, pw, A.loginNameDomain)`.
   `null` → show `Enter the password to include.` and stop.
2. Disable Send, show `Sending…`.
3. `await A.emailInvite(params)`.
4. `true` → collapse the row, `A.toast("Invite sent to " + email)`.
   `false` → keep the row open with the typed password intact, show
   `Send failed — check the EmailJS template is configured.` and re-enable Send.

Keeping the password on failure matters: retyping it is the one thing the admin
cannot recover from the app.

## Testing

`test/lib.test.js` (`node --test`), covering `inviteEmailParams`:

- returns `null` for a customer with no `uid`
- returns `null` for a synthetic `@kombucha.app` address
- returns `null` for empty or whitespace-only password
- uses `contact` as `contact_name` when set
- falls back to `name` when `contact` is absent, empty, or whitespace-only
- maps `to_email`, `login_email`, `password` correctly

`emailInvite` and the DOM wiring are not unit-testable in this setup. Manual
verification: create the EmailJS template, then send one invite to your own
address and confirm the PT/EN body, the From Name, and the Reply To all render.

## Docs

Append an **"App invite email"** section to `docs/EMAILJS_SETUP.md` with the
template body above and the same setup steps used for the recibo template:
`To Email` = `{{to_email}}`, `From Name` = static `Real Health Kombucha`,
`Reply To` = a monitored address, subject
`Aplicação de encomendas / Ordering app — Real Health Kombucha`, then put the
Template ID into `EMAILJS_INVITE_TEMPLATE`.
