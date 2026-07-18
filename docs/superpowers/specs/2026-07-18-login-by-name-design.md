# Restaurant Login by Name (not email) — Design Spec

Date: 2026-07-18
Status: design complete, implementation pending

## Goal

Let an admin create a restaurant login using **just a name** (for customers with
no email), and let that restaurant log in by typing only their name. Firebase
Email/Password auth requires an email-shaped string, so a bare name is turned
into a fixed behind-the-scenes email; real emails are used unchanged.

## Model

- **A fixed domain** `LOGIN_NAME_DOMAIN = "kombucha.app"` (a constant in
  `index.html`). Invisible to users; only needs to be consistent between account
  creation and login.
- **Normalization** (`KO.loginEmail(input, domain)`): trim + lowercase; if the
  input already contains `@`, use it as-is; otherwise strip internal whitespace
  and append `@<domain>`. E.g. `Koa` → `koa@kombucha.app`; `Koa Spot` →
  `koaspot@kombucha.app`; `roel.heremans@gmail.com` → unchanged.
- Because both **account creation** and the **login screen** run the same
  `loginEmail`, a name round-trips: the admin creates `Koa`, the restaurant types
  `Koa` (or `koa`, `KOA`, `Koa Spot`→`koaspot`) and it resolves to the same
  synthetic email.

Real emails (anything with `@`) pass through untouched, so existing restaurant
logins and the admin accounts are unaffected. Firebase lowercases emails on
creation anyway, so lowercasing at login is consistent.

## `lib.js` — `loginEmail(input, domain)`

Pure, unit-tested:
```
loginEmail(input, domain) -> string
  s = String(input ?? "").trim().toLowerCase()
  return s.includes("@") ? s : s.replace(/\s+/g, "") + "@" + domain
```

## `index.html` changes

- Add `const LOGIN_NAME_DOMAIN = "kombucha.app";` in the module script (near
  `FIREBASE_CONFIG`).
- **Login screen** (`#loginBtn` handler): normalize the entered value via
  `window.KO.loginEmail(value, LOGIN_NAME_DOMAIN)` before
  `signInWithEmailAndPassword`. Change the `#loginEmail` input from `type="email"`
  to `type="text"` and relabel it **"Email or name"** so a bare name isn't
  awkward.
- **Create login** (`window.APP.createRestaurantLogin`): normalize the passed
  email/name via `window.KO.loginEmail(...)` before
  `createUserWithEmailAndPassword`, and store that normalized value as the
  customer's `email`. (The linking to the customer is by `uid`, unchanged.)
- **Restaurant-logins form** (Settings): relabel **"Login email"** →
  **"Login email or name"** and change its input from `type="email"` to
  `type="text"`. Existing presence validation still passes for a name.

Collisions: two customers with the same name synthesize the same email;
`createUserWithEmailAndPassword` then fails with `auth/email-already-in-use`,
which the existing create-login error line surfaces — the admin picks a different
name.

## Testing

- `lib.js`: unit-test `loginEmail` — passthrough for addresses (incl. mixed case
  → lowercased), synthesis for a bare name, whitespace stripping, and a
  multi-word name.
- Manual (browser): in Settings → Restaurant logins, create a login for a
  customer using a **name** (e.g. `Koa`) + password → succeeds; that restaurant
  logs in on the login screen by typing **`Koa`** + the password → lands in their
  restaurant view. A real-email login (existing) still works. An admin logs in
  with their real email unchanged. Creating a second login with the same name
  shows the "already in use" error.

## Out of scope

- Changing existing logins (they keep their real emails).
- A username/display field separate from the login identifier.
- Password reset / email verification (names have no deliverable inbox — password
  is admin-set, as today).
