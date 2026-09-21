# QR Self-Signup + Installable App — Design Spec

Date: 2026-09-21
Status: design approved, implementation pending

## Goal

Let private customers (*particulieren*) and restaurants onboard themselves by
scanning **one general QR code** (flyer, bottle label, WhatsApp). The QR opens a
signup screen where they choose their own email + password. The admin approves
each request, either as a new customer or linked to an existing one. After
signup the app offers to be added to the phone's home screen, with a branded
icon. Once this is tested, the admin-types-the-password **invite email** is
removed.

Delivered in two phases:

- **Phase 1** — QR, signup, pending screen, approval, rules, PWA + icon.
- **Phase 2** — cleanup of the invite email. Starts only after the user has
  tested phase 1 and says go.

## Decisions

- **General QR, not per-customer.** Anyone with the code can create an account,
  so accounts are gated by **admin approval**. An unapproved account has a
  Firebase login but no linked `customers` doc, so the existing `uid`-based
  rules already deny it all customer data.
- **Real email required** at signup. The admin no longer knows passwords, so a
  "Forgot password?" flow (`sendPasswordResetEmail`) is necessary, and it only
  works for real inboxes. Name-only (synthetic `@kombucha.app`) logins stay
  available through the manual admin card, and existing name logins keep
  working.
- **Approval chooses new vs. existing.** Existing customers with delivery history
  must be linkable so they are not duplicated.
- **Rejecting deletes the request only.** Client code cannot delete another
  user's Firebase Auth account. A rejected account can sign in but only sees the
  re-submit form.
- **Icon = option B.** The sun + Madeira mark from `logo_highres.png` (no
  wordmark, unreadable at icon size), rays thickened, gold rays and cream island
  on dark green `#1c392d`. The full wordmark logo (`logo_variant_A.png`) goes on
  the signup and login screens.
- **Service worker is pass-through (no caching)**, so a GitHub Pages deploy never
  gets stuck behind a stale cached copy. Firestore's persistent cache already
  provides offline data.
- **Manual "Customers Login" card is kept**, renamed to *"Manual login
  (customers without email)"*.

## QR code

- URL: `https://roel-heremans.github.io/kombucha-orders-app/?signup`
- Generated once with Python `segno` (available locally), with high error
  correction and the icon mark overlaid in the centre. Committed as
  `qr/signup-qr.png` (print resolution) and `qr/signup-qr.svg`, together with
  the generator script `qr/make_qr.py`.
- Settings gets an **"Invite QR"** card showing `qr/signup-qr.png`, a Download
  link and the plain URL (for pasting into WhatsApp).

## Data model

New collection `signups/{uid}` (doc id = the Auth uid):

| field       | type                      | notes                              |
|-------------|---------------------------|------------------------------------|
| `uid`       | string                    | equals doc id                      |
| `email`     | string                    | equals the auth token email        |
| `name`      | string                    | person or business name, required  |
| `type`      | `"private"`/`"restaurant"`| required                           |
| `contact`   | string                    | optional, restaurants              |
| `phone`     | string                    | optional                           |
| `lang`      | `"pt"`/`"en"`             | language at signup                 |
| `createdAt` | ISO string                |                                    |

`customers/{id}` gains an optional `phone` field, which is shown and editable in
the Settings customer block. `contact` already exists.

## `firestore.rules`

```
match /signups/{uid} {
  allow create: if signedIn() && request.auth.uid == uid
                && request.resource.data.uid == uid
                && request.resource.data.email == request.auth.token.email
                && request.resource.data.type in ["private", "restaurant"]
                && request.resource.data.name is string
                && request.resource.data.name.size() > 0;
  allow read:   if isAdmin() || (signedIn() && request.auth.uid == uid);
  allow delete: if isAdmin();
}
```

No update rule: a user re-submits only after the doc was deleted (rejected) or
never written. The user must publish the updated rules in the Firebase console
(documented in `docs/FIREBASE_SETUP.md`).

## `lib.js` (pure, unit-tested)

- `validateSignup(input)` → `{ ok, errors: string[], data }`. `input` has
  `{ email, password, password2, name, type, contact, phone }`. Checks: email
  contains `@` and a dot after it; password ≥ 6 characters; passwords match;
  name non-blank; type ∈ {private, restaurant}. `data` is trimmed, email
  lowercased, and `contact` cleared when type is private. Error codes are i18n
  keys (e.g. `err_email`, `err_pw_short`, `err_pw_match`, `err_name`). For
  re-submit (already signed in), call with `{ skipCredentials: true }` to skip
  the email and password checks.
- `customerFromSignup(signup)` → new customer object
  `{ name, type, contact, phone, email, uid, nif: "", notes: "" }`.
- `linkPatch(customer, signup)` → `{ uid, email }` plus `contact` / `phone`
  **only where the customer's own value is blank**. Never overwrites `name` or
  `type`.
- `installMode(userAgent, isStandalone)` → `"installed"` if standalone, else
  `"ios"` for iPhone/iPad Safari UA, else `"prompt"` (Android/desktop, which use
  `beforeinstallprompt` when the browser fires it).
- `whatsappSignupText(name, type)` → e.g. `"New signup: Casa Velha (restaurant)
  — approve in Settings"`.
- New `t()` keys (PT + EN) for all signup, pending and install strings.

## `index.html`

**Routing on load.** If `location.search` contains `signup` and nobody is signed
in, show `#signupView` instead of `#loginView`. The login view gets links
*"New customer? Create an account"* (→ signup view) and *"Forgot password?"*
(→ `sendPasswordResetEmail(auth, loginEmail(typed))`, with a message that the
email was sent, or an error).

**Signup view** (`#signupView`, PT/EN toggle reusing `ko_lang`): logo, then
fields Email, Password, Repeat password, Name, Type (select), Contact person
(shown only for Restaurant), Phone. On submit:

1. `validateSignup` → show translated errors, stop on failure.
2. `createUserWithEmailAndPassword(auth, email, pw)` on the **main** auth, which
   signs the user in. `auth/email-already-in-use` → message "this email already
   has an account, log in instead".
3. `setDoc(doc(db, "signups", uid), {...data, uid, email, lang, createdAt})`.
4. Best-effort WhatsApp to the admins via the existing CallMeBot recipients
   (`whatsappSignupText(name, type)` in lib.js, unit-tested).
5. `onAuthStateChanged` routes the user to the customer view, which renders the
   pending state (below).

**Customer view, not-linked state.** `onRestaurantLogin` already sets
`myCustomer = null` when no customer matches the uid (today this shows
`not_linked`). Replace that with:

- also `onSnapshot(doc(db, "signups", uid))`;
- request exists → *"Thanks, {name}! We'll activate your account shortly."* +
  install card + logout;
- no request → *"Complete your details"* form (name/type/contact/phone,
  `validateSignup(..., {skipCredentials:true})`) that writes `signups/{uid}`.

When the admin approves, the customers `onSnapshot` fires with the linked doc
and the normal ordering view renders. No reload is needed.

**Admin: "Pending signups" card** at the top of Settings, plus a count badge on
the Settings nav button (same `.badge` pattern as Orders). The admin watches
`signups` in `onLogin`. Per request: name, type, email, phone, date, and:

- **Approve as new** → `writeBatch`: `addDoc`-style `set` of
  `customerFromSignup`, `delete` signup. Toast "Approved".
- **Link to ▾ [customers without uid] + Link** → `writeBatch`: `update`
  customer with `linkPatch`, `delete` signup.
- **Reject** → `confirm()`, then delete signup.

**Settings customer block:** add a Phone field (read, save). Rename the
"Customers Login" card to *"Manual login (customers without email)"*.

**Install card** (shown to customers in both the pending and linked states,
never to admins): hidden if `installMode === "installed"` or the
`ko_install_dismissed` localStorage flag is set (wrapped in try/catch).
`"prompt"` → capture `beforeinstallprompt` and show an **Install** button that
calls `prompt()`; if the event never fires, show nothing. `"ios"` → the
instruction *"Tap Share ⬆︎, then 'Add to Home Screen'"*. A **Not now** button
sets the flag.

**Head:** `<link rel="manifest">`, `theme-color`, `apple-touch-icon`, favicon,
`apple-mobile-web-app-title`. Register `sw.js` if supported. Replace the 🍶 in
the header with the small icon.

## New static files

- `manifest.webmanifest`: `name` "Real Health Kombucha", `short_name`
  "Kombucha", `start_url` "./", `scope` "./", `display` "standalone",
  `theme_color` / `background_color` `#1c392d`, icons 192, 512, 512 maskable.
- `sw.js`: `install` → `skipWaiting`, `activate` → `clients.claim`, `fetch`
  handler that does nothing (the browser handles the request).
- `icons/`: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (mark within
  the 80% safe zone), `apple-touch-icon.png` (180), `favicon-32.png`,
  `logo.png` (wordmark for the signup/login screens), and the generator script
  `icons/make_icons.py`.

## Phase 2 — cleanup (after the user's go)

Remove `window.APP.emailInvite`, `EMAILJS_INVITE_TEMPLATE`, `inviteEmailParams`
(lib + export + tests), the `c-invite` UI and its handlers, and the "App invite
email" section of `docs/EMAILJS_SETUP.md`. Keep `loginEmail`,
`customerEmailStatus`, `contact`, and the manual login card. Remind the user to
delete the EmailJS invite template.

## Testing

- `node --test`: `validateSignup` (each error, trimming, lowercasing, contact
  cleared for private, skipCredentials), `customerFromSignup`, `linkPatch`
  (fills blanks only, never touches name/type), `installMode` (standalone, iOS
  UA, Android UA), `whatsappSignupText`.
- Manual (browser, against the real Firebase after the rules are published):
  open `?signup` → sign up with a test email → pending screen; admin sees the
  badge and request → Approve as new → the customer screen switches to ordering
  live. Repeat with Link to existing. Reject → user sees the re-submit form →
  re-submit works. Forgot password sends an email. Lighthouse / Chrome
  DevTools "Application → Manifest" shows the app is installable with the right
  icons. Scan the printed QR with a phone.

## Out of scope

Per-customer invite codes, email verification, deleting Auth accounts on reject,
offline app-shell caching, admin notification by email.
