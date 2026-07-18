# Restaurant Login by Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin create a restaurant login from just a name (no email), and let that restaurant log in by typing only their name — by synthesizing a fixed behind-the-scenes email for Firebase auth. Real emails work unchanged.

**Architecture:** A pure tested `loginEmail(input, domain)` in `lib.js` (adds `@<domain>` when there's no `@`); a `LOGIN_NAME_DOMAIN` constant; both the login screen and `createRestaurantLogin` run `loginEmail` so a name round-trips; the two email inputs become `type="text"` relabelled "…or name".

**Tech Stack:** Vanilla HTML/CSS/JS, Firebase (Email/Password auth, unchanged), `node --test`, GitHub Pages. No rules/schema change.

## Global Constraints

- No build step; single `index.html` + `lib.js`. No deps.
- Pure logic in `lib.js` (UMD return object) with tests in `test/lib.test.js`; run `npm test`.
- `window.KO` (lib.js) is loaded before the deferred module script, so `window.KO.loginEmail` is available in the module script's login/create handlers.
- Real emails (containing `@`) must pass through unchanged so existing restaurant logins and the admin accounts (email allowlist) are unaffected.
- `LOGIN_NAME_DOMAIN = "kombucha.app"`.

---

### Task 1: `loginEmail` helper in `lib.js`

**Files:**
- Modify: `lib.js`
- Test: `test/lib.test.js`

**Interfaces (produced):** `KO.loginEmail(input, domain)` → trimmed+lowercased input as-is if it contains `@`, else whitespace-stripped input + `"@" + domain`.

- [ ] **Step 1: Write the failing tests**

Append to `test/lib.test.js`:

```javascript
test("loginEmail passes through addresses and synthesizes from a bare name", () => {
  assert.strictEqual(KO.loginEmail("roel.heremans@gmail.com", "kombucha.app"), "roel.heremans@gmail.com");
  assert.strictEqual(KO.loginEmail("MixedCase@Example.COM", "kombucha.app"), "mixedcase@example.com");
  assert.strictEqual(KO.loginEmail("Koa", "kombucha.app"), "koa@kombucha.app");
  assert.strictEqual(KO.loginEmail("Koa Spot", "kombucha.app"), "koaspot@kombucha.app");
  assert.strictEqual(KO.loginEmail("  Sun Spot  ", "kombucha.app"), "sunspot@kombucha.app");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — Expected: FAIL (`KO.loginEmail is not a function`).

- [ ] **Step 3: Add the implementation**

In `lib.js`, add near the other small helpers:

```javascript
  function loginEmail(input, domain) {
    const s = String(input == null ? "" : input).trim().toLowerCase();
    return s.indexOf("@") !== -1 ? s : s.replace(/\s+/g, "") + "@" + domain;
  }
```

- [ ] **Step 4: Export it**

Add `loginEmail` to the `return { ... }` object in `lib.js`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add loginEmail helper to lib.js"
```

---

### Task 2: Wire login-by-name into the login screen + create-login

**Files:**
- Modify: `index.html` — `LOGIN_NAME_DOMAIN` const; login `#loginBtn` handler; `createRestaurantLogin`; the two email inputs (login screen + Settings restaurant-logins).

**Interfaces:** consumes `KO.loginEmail`; existing `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `updateDoc`, `FIREBASE_CONFIG`.

- [ ] **Step 1: Add the LOGIN_NAME_DOMAIN constant**

In the module script, immediately after the `FIREBASE_CONFIG` object literal, add:

```javascript
    const LOGIN_NAME_DOMAIN = "kombucha.app"; // bare names become <name>@this for Firebase auth
```

- [ ] **Step 2: Normalize in the login handler**

In the `#loginBtn` click handler, replace:

```javascript
      const email = document.getElementById("loginEmail").value.trim();
```

with:

```javascript
      const email = window.KO.loginEmail(document.getElementById("loginEmail").value, LOGIN_NAME_DOMAIN);
```

- [ ] **Step 3: Relabel + retype the login-screen input**

In the login view markup, change:

```html
      <label>Email</label>
      <input id="loginEmail" type="email" autocomplete="username" />
```

to:

```html
      <label>Email or name</label>
      <input id="loginEmail" type="text" autocomplete="username" />
```

- [ ] **Step 4: Normalize in `createRestaurantLogin` and store the synthesized email**

In `window.APP.createRestaurantLogin`, add a normalized `loginId` at the top and use it for both the auth-user creation and the stored customer `email`:

```javascript
    window.APP.createRestaurantLogin = async function (customerId, email, password) {
      const loginId = window.KO.loginEmail(email, LOGIN_NAME_DOMAIN);
      const name = "rlogin-" + customerId;
      let secondary;
      try { secondary = initializeApp(FIREBASE_CONFIG, name); }
      catch (e) { secondary = initializeApp(FIREBASE_CONFIG, name + "-2"); }
      try {
        const secAuth = getAuth(secondary);
        const cred = await createUserWithEmailAndPassword(secAuth, loginId, password);
        await updateDoc(doc(db, "customers", customerId), { uid: cred.user.uid, email: loginId });
```

(Only the first three statements of the `try` change: `email`→`loginId` in `createUserWithEmailAndPassword`, and `email`→`email: loginId` in the `updateDoc`. Leave the rest of the function — `signOut`, `finally`/`deleteApp` — untouched.)

- [ ] **Step 5: Relabel + retype the Settings restaurant-logins input**

In the Settings restaurant-logins card, change:

```javascript
          `<label>Login email</label><input id="rlEmail" type="email"/>` +
```

to:

```javascript
          `<label>Login email or name</label><input id="rlEmail" type="text"/>` +
```

- [ ] **Step 6: Syntax-check + tests**

Run the inline-script syntax check (expected `classic blocks 8 errors 0`) and `npm test` (green — no lib change here):
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;while((m=re.exec(h))){const s=m[1];if(!s.trim()||/^\s*import\s/m.test(s))continue;i++;try{new Function(s)}catch(e){console.log("ERR",e.message);bad++}}console.log("classic blocks",i,"errors",bad)'
```

- [ ] **Step 7: Manual verification (deferred to controller/human — needs live Firebase)**

As admin, Settings → Restaurant logins: create a login for a customer using a **name** (e.g. `Koa`) + a 6+ char password → "Login created ✓". Log out, and on the login screen type **`Koa`** + that password → lands in the restaurant view for that customer. Confirm a **real-email** login (an existing one) still works, and the **admin** logs in with their real email unchanged. Creating a second login with the same name shows an "already in use" error.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: allow restaurant login by name (synthesized email for Firebase auth)"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** `loginEmail` helper (Task 1); domain const + login-handler normalize + create-login normalize/store + both inputs relabelled/retyped (Task 2). Real emails pass through; names round-trip via the shared helper. ✓
- **Types consistent:** `loginEmail(input, domain)` used identically in the login handler and `createRestaurantLogin`; stored `email` = the synthesized login so create/login match. ✓
- **No placeholders.** Full code + commands throughout.

## Notes for the implementer

- Only `lib.js` is unit-tested (Task 1 TDD). Task 2 is glue verified in the browser against live Firebase (auth) — deferred to the controller/human.
- Do not change the admin email allowlist or the rules; admin emails contain `@` so `loginEmail` returns them unchanged.
- `window.KO.loginEmail` (not a bare `KO`) in the module script, to be explicit.
```
