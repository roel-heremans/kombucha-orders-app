# QR Self-Signup + Installable App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One general QR code opens a signup screen where private customers and restaurants create their own login. The admin approves each request (as a new customer or linked to an existing one). The app is installable with a branded icon. Afterwards the admin-typed-password invite email is removed.

**Architecture:** No build step. `index.html` holds a Firebase **module** script (auth + Firestore, exposing everything on `window.APP`) plus several plain `<script>` blocks for the views. Pure logic lives in `lib.js` (`window.KO` in the browser, `module.exports` under Node) and is unit-tested with `node --test`. Signup requests are a new Firestore collection `signups/{uid}`. Approval links a `customers` doc to the uid, which is what all existing rules and views already key on.

**Tech Stack:** Vanilla JS, Firebase JS SDK 10.12.0 (CDN ESM), Firestore, Node's built-in test runner, Python 3 + Pillow + segno + OpenCV (only for generating and verifying the committed icon/QR images).

**Spec:** `docs/superpowers/specs/2026-09-21-qr-self-signup-design.md`

## Global Constraints

- Signup URL (encoded in the QR): `https://roel-heremans.github.io/kombucha-orders-app/?signup`
- Brand colours: dark green `#1c392d` (rgb 28,57,45), cream `#f5f0e8` (rgb 245,240,232), gold rays `#d4af55` (rgb 212,175,85).
- Manifest: `name` "Real Health Kombucha", `short_name` "Kombucha", `start_url` "./", `scope` "./", `display` "standalone", `theme_color` and `background_color` `#1c392d`.
- Customer types are exactly `"private"` and `"restaurant"`.
- Passwords are ≥ 6 characters (Firebase minimum).
- Every customer-facing string is available in PT and EN through `KO.t(lang, key)`. Language comes from `localStorage["ko_lang"]`, default `"pt"`.
- Every `localStorage` read/write is wrapped in `try/catch`.
- **Module-scope gotcha:** consts declared in the `<script type="module">` block are NOT visible to the plain `<script>` blocks. Anything the plain blocks need must be put on `window.APP`.
- Every user-supplied value inserted into HTML goes through `A.esc(...)`.
- Service worker does no caching.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Phase 2 (Task 8) is **not** executed until the user has tested phase 1 and explicitly says go.

## File map

| File | Responsibility |
|---|---|
| `lib.js` | + `validateSignup`, `customerFromSignup`, `linkPatch`, `installMode`, `whatsappSignupText`, new PT/EN strings |
| `test/lib.test.js` | tests for the above |
| `icons/make_icons.py` (new) | generates all icon PNGs + `logo.png` from the brand logo |
| `icons/*.png` (new) | `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon-32.png`, `logo.png` |
| `manifest.webmanifest` (new) | PWA manifest |
| `sw.js` (new) | pass-through service worker |
| `qr/make_qr.py` (new), `qr/signup-qr.png`, `qr/signup-qr.svg` (new) | the signup QR code |
| `firestore.rules` | + `signups/{uid}` rules |
| `docs/FIREBASE_SETUP.md` | + "Self-signup rules" note |
| `index.html` | head tags + SW registration; signup view; login links + forgot password; pending/re-submit customer state; install card; admin pending-signups card + badge; Invite QR card; customer Phone field; manual-login rename |

---

### Task 1: Pure signup logic + strings in `lib.js`

**Files:**
- Modify: `lib.js` (STRINGS at ~line 63-98; new functions after `customerEmailStatus` ~line 554; export object at ~line 791)
- Test: `test/lib.test.js` (append at end)

**Interfaces:**
- Produces:
  - `KO.validateSignup(input, opts?) -> { ok: boolean, errors: string[], data: {email, password, name, type, contact, phone} }`. `input = {email, password, password2, name, type, contact, phone}`, `opts = {skipCredentials?: boolean}`. Error codes: `"err_email"`, `"err_pw_short"`, `"err_pw_match"`, `"err_name"`, `"err_type"`.
  - `KO.customerFromSignup(signup) -> {name, type, contact, phone, email, uid, nif: "", notes: ""}`
  - `KO.linkPatch(customer, signup) -> {uid, email, contact?, phone?}`
  - `KO.installMode(userAgent, isStandalone) -> "installed" | "ios" | "prompt"`
  - `KO.whatsappSignupText(name, type) -> string`
  - New string keys (en + pt) listed in Step 3.

- [ ] **Step 1: Write the failing tests** — append to `test/lib.test.js`:

```js
const GOOD_SIGNUP = {
  email: "  Casa@Velha.PT ", password: "secret1", password2: "secret1",
  name: "  Casa Velha ", type: "restaurant", contact: " Sr. Luis ", phone: " 912 ",
};

test("validateSignup accepts a good signup and normalises data", () => {
  const r = KO.validateSignup(GOOD_SIGNUP);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.data, {
    email: "casa@velha.pt", password: "secret1", name: "Casa Velha",
    type: "restaurant", contact: "Sr. Luis", phone: "912",
  });
});

test("validateSignup clears contact for private customers", () => {
  const r = KO.validateSignup(Object.assign({}, GOOD_SIGNUP, { type: "private" }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.contact, "");
});

test("validateSignup reports each error code", () => {
  const bad = (patch) => KO.validateSignup(Object.assign({}, GOOD_SIGNUP, patch)).errors;
  assert.deepStrictEqual(bad({ email: "nope" }), ["err_email"]);
  assert.deepStrictEqual(bad({ email: "a@b" }), ["err_email"]);
  assert.deepStrictEqual(bad({ password: "12345", password2: "12345" }), ["err_pw_short"]);
  assert.deepStrictEqual(bad({ password2: "other12" }), ["err_pw_match"]);
  assert.deepStrictEqual(bad({ name: "   " }), ["err_name"]);
  assert.deepStrictEqual(bad({ type: "vip" }), ["err_type"]);
  assert.strictEqual(KO.validateSignup(Object.assign({}, GOOD_SIGNUP, { name: "" })).ok, false);
});

test("validateSignup skipCredentials ignores email and passwords", () => {
  const r = KO.validateSignup({ name: "Ana", type: "private" }, { skipCredentials: true });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data, { email: "", password: "", name: "Ana", type: "private", contact: "", phone: "" });
});

test("validateSignup tolerates missing fields", () => {
  const r = KO.validateSignup({});
  assert.deepStrictEqual(r.errors, ["err_email", "err_pw_short", "err_name", "err_type"]);
});

test("customerFromSignup builds a customer doc", () => {
  assert.deepStrictEqual(KO.customerFromSignup({
    uid: "u1", email: "a@b.pt", name: "Ana", type: "private", contact: "", phone: "91", lang: "pt", createdAt: "x",
  }), { name: "Ana", type: "private", contact: "", phone: "91", email: "a@b.pt", uid: "u1", nif: "", notes: "" });
  assert.deepStrictEqual(KO.customerFromSignup({ uid: "u2", email: "c@d.pt", name: "C", type: "restaurant" }),
    { name: "C", type: "restaurant", contact: "", phone: "", email: "c@d.pt", uid: "u2", nif: "", notes: "" });
});

test("linkPatch fills only blank contact/phone and never name/type", () => {
  const signup = { uid: "u1", email: "a@b.pt", name: "New Name", type: "private", contact: "Luis", phone: "91" };
  assert.deepStrictEqual(KO.linkPatch({ name: "Old", type: "restaurant" }, signup),
    { uid: "u1", email: "a@b.pt", contact: "Luis", phone: "91" });
  assert.deepStrictEqual(KO.linkPatch({ name: "Old", contact: "Maria", phone: " 22 " }, signup),
    { uid: "u1", email: "a@b.pt" });
  assert.deepStrictEqual(KO.linkPatch({ name: "Old", contact: "  " }, Object.assign({}, signup, { contact: "", phone: "" })),
    { uid: "u1", email: "a@b.pt" });
});

test("installMode detects installed / iOS / prompt", () => {
  const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";
  assert.strictEqual(KO.installMode(IOS, true), "installed");
  assert.strictEqual(KO.installMode(ANDROID, true), "installed");
  assert.strictEqual(KO.installMode(IOS, false), "ios");
  assert.strictEqual(KO.installMode(IPAD, false), "ios");
  assert.strictEqual(KO.installMode(ANDROID, false), "prompt");
  assert.strictEqual(KO.installMode("", false), "prompt");
});

test("whatsappSignupText names the signup and its type", () => {
  assert.strictEqual(KO.whatsappSignupText("Casa Velha", "restaurant"),
    "🆕 New signup — Casa Velha (restaurant). Approve in Settings.");
});

test("signup strings exist in both languages", () => {
  ["signup_title", "err_email", "pending_msg", "install_ios", "complete_details"].forEach((k) => {
    assert.notStrictEqual(KO.t("en", k), k);
    assert.notStrictEqual(KO.t("pt", k), k);
    assert.notStrictEqual(KO.t("pt", k), KO.t("en", k));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: the new tests FAIL with `KO.validateSignup is not a function` (etc.); all pre-existing tests still pass.

- [ ] **Step 3: Add the strings.** In `lib.js` `STRINGS.en`, after `status_cancelled: "Cancelled",` add:

```js
      signup_title: "Create your account", email: "Email", password: "Password",
      password2: "Repeat password", name_label: "Your name or business name",
      type_label: "I am a", type_private: "Private customer", type_restaurant: "Restaurant / business",
      contact_label: "Contact person", phone_label: "Phone (optional)",
      create_account: "Create account", have_account: "Already have an account? Log in",
      err_email: "Enter a valid email address.", err_pw_short: "The password needs at least 6 characters.",
      err_pw_match: "The passwords don't match.", err_name: "Enter your name.",
      err_type: "Choose a customer type.", err_email_in_use: "This email already has an account — log in instead.",
      signup_failed: "Could not create the account:",
      pending_msg: "Thanks, {name}! We'll activate your account shortly. You'll be able to order here as soon as it's approved.",
      complete_details: "Complete your details so we can activate your account.",
      submit_details: "Send", install_title: "Add Kombucha to your home screen?",
      install_btn: "Install", not_now: "Not now",
      install_ios: "Tap the Share button ⬆︎ at the bottom of Safari, then choose \"Add to Home Screen\".",
```

and in `STRINGS.pt`, after `status_cancelled: "Cancelado",` add:

```js
      signup_title: "Criar a sua conta", email: "Email", password: "Palavra-passe",
      password2: "Repetir palavra-passe", name_label: "O seu nome ou nome da empresa",
      type_label: "Sou", type_private: "Cliente particular", type_restaurant: "Restaurante / empresa",
      contact_label: "Pessoa de contacto", phone_label: "Telefone (opcional)",
      create_account: "Criar conta", have_account: "Já tem conta? Entrar",
      err_email: "Introduza um email válido.", err_pw_short: "A palavra-passe precisa de pelo menos 6 caracteres.",
      err_pw_match: "As palavras-passe não coincidem.", err_name: "Introduza o seu nome.",
      err_type: "Escolha o tipo de cliente.", err_email_in_use: "Este email já tem conta — entre com ele.",
      signup_failed: "Não foi possível criar a conta:",
      pending_msg: "Obrigado, {name}! Vamos ativar a sua conta em breve. Poderá encomendar aqui assim que for aprovada.",
      complete_details: "Complete os seus dados para podermos ativar a sua conta.",
      submit_details: "Enviar", install_title: "Adicionar a Kombucha ao ecrã principal?",
      install_btn: "Instalar", not_now: "Agora não",
      install_ios: "Toque no botão Partilhar ⬆︎ no fundo do Safari e escolha \"Adicionar ao ecrã principal\".",
```

(`email` is identical in both languages, which is fine; the test only checks the listed keys.)

- [ ] **Step 4: Add the functions** after `customerEmailStatus` in `lib.js`:

```js
  function trimStr(v) { return String(v == null ? "" : v).trim(); }

  function validateSignup(input, opts) {
    const i = input || {};
    const skip = !!(opts && opts.skipCredentials);
    const type = trimStr(i.type);
    const data = {
      email: skip ? "" : trimStr(i.email).toLowerCase(),
      password: skip ? "" : String(i.password == null ? "" : i.password),
      name: trimStr(i.name),
      type: type,
      contact: type === "restaurant" ? trimStr(i.contact) : "",
      phone: trimStr(i.phone),
    };
    const errors = [];
    if (!skip) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push("err_email");
      if (data.password.length < 6) errors.push("err_pw_short");
      else if (data.password !== String(i.password2 == null ? "" : i.password2)) errors.push("err_pw_match");
    }
    if (!data.name) errors.push("err_name");
    if (type !== "private" && type !== "restaurant") errors.push("err_type");
    return { ok: errors.length === 0, errors: errors, data: data };
  }

  function customerFromSignup(s) {
    return {
      name: s.name, type: s.type, contact: s.contact || "", phone: s.phone || "",
      email: s.email, uid: s.uid, nif: "", notes: "",
    };
  }

  // Attach a signup's login to an existing customer. Only fills contact/phone
  // the customer doesn't already have; name and type are the admin's.
  function linkPatch(customer, s) {
    const p = { uid: s.uid, email: s.email };
    if (!trimStr(customer && customer.contact) && trimStr(s.contact)) p.contact = trimStr(s.contact);
    if (!trimStr(customer && customer.phone) && trimStr(s.phone)) p.phone = trimStr(s.phone);
    return p;
  }

  function installMode(userAgent, isStandalone) {
    if (isStandalone) return "installed";
    return /iPhone|iPad|iPod/.test(String(userAgent || "")) ? "ios" : "prompt";
  }

  function whatsappSignupText(name, type) {
    return "🆕 New signup — " + name + " (" + type + "). Approve in Settings.";
  }
```

Add `validateSignup, customerFromSignup, linkPatch, installMode, whatsappSignupText, ` to the returned export object (after `customerEmailStatus, `).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -8`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "Add signup validation, linking and install-mode helpers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: App icons, manifest, service worker, head tags

**Files:**
- Create: `icons/make_icons.py`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/icon-maskable-512.png`, `icons/apple-touch-icon.png`, `icons/favicon-32.png`, `icons/logo.png`, `manifest.webmanifest`, `sw.js`
- Modify: `index.html` `<head>` (lines 4-6), `<header>` (line ~43), module script (after `window.APP = {...}` ~line 136)

**Interfaces:**
- Produces: `icons/logo.png` (the wordmark, used by Task 5 and Task 6) and `icons/icon-192.png` (used by the header).

- [ ] **Step 1: Write `icons/make_icons.py`**

```python
"""Generate the PWA icons + wordmark from the Real Health brand logo.

Run from the repo root:  python3 icons/make_icons.py
Source logos live outside this repo (see SRC_DIR).
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

SRC_DIR = Path("/home/roel/Documents/PersonalRepos/Kombucha/assets/design-logos")
OUT = Path(__file__).resolve().parent
GREEN, CREAM, GOLD = (28, 57, 45), (245, 240, 232), (212, 175, 85)


def mark_on_green():
    """Sun rays + Madeira island (no wordmark), recoloured onto dark green."""
    src = Image.open(SRC_DIR / "logo_highres.png").convert("RGB")
    a = np.asarray(src.crop((395, 300, 1535, 1000))).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    island = (r < 90) & (g < 110) & (b < 100)
    gold = (r > 150) & (b < 150) & (r - b > 60) & ~island
    dot = np.zeros_like(gold)
    dot[300:, 300:800] = gold[300:, 300:800]  # the Funchal dot, drawn over the island

    def mask(m, grow=0):
        im = Image.fromarray((m * 255).astype("uint8"))
        return im.filter(ImageFilter.MaxFilter(grow)) if grow else im

    h, w = island.shape
    c = Image.new("RGB", (w, h), GREEN)
    c.paste(Image.new("RGB", (w, h), GOLD), (0, 0), mask(gold, 7))  # thicken rays for small sizes
    c.paste(Image.new("RGB", (w, h), CREAM), (0, 0), mask(island))
    c.paste(Image.new("RGB", (w, h), GOLD), (0, 0), mask(dot, 5))
    return c


def square(mark, side):
    sq = Image.new("RGB", (side, side), GREEN)
    sq.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2 + side // 25))
    return sq


def main():
    mark = mark_on_green()
    regular = square(mark, 1400)   # mark fills ~81% width
    maskable = square(mark, 1840)  # mark within the 80% safe-zone circle
    for name, img, size in [
        ("icon-512.png", regular, 512), ("icon-192.png", regular, 192),
        ("apple-touch-icon.png", regular, 180), ("favicon-32.png", regular, 32),
        ("icon-maskable-512.png", maskable, 512),
    ]:
        img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)

    logo = Image.open(SRC_DIR / "logo_variant_A.png").convert("RGB")
    bg = Image.new("RGB", logo.size, logo.getpixel((5, 5)))
    diff = np.asarray(logo).astype(int) - np.asarray(bg).astype(int)
    ys, xs = np.nonzero(np.abs(diff).sum(axis=2) > 30)
    pad = 20
    logo = logo.crop((xs.min() - pad, ys.min() - pad, xs.max() + pad, ys.max() + pad))
    logo.thumbnail((600, 600), Image.LANCZOS)
    logo.save(OUT / "logo.png", optimize=True)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it and check the output**

Run: `python3 icons/make_icons.py && file icons/*.png`
Expected: six PNGs, with sizes 192, 512, 512, 180, 32 and the logo ≤ 600 wide. Open `icons/icon-512.png`, `icons/icon-maskable-512.png` and `icons/logo.png` with the Read tool and confirm visually: gold rays + cream island on dark green; maskable has more margin; logo shows "REAL HEALTH / KOMBUCHA" cropped tight on cream.

- [ ] **Step 3: Write `manifest.webmanifest`**

```json
{
  "name": "Real Health Kombucha",
  "short_name": "Kombucha",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "theme_color": "#1c392d",
  "background_color": "#1c392d",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 4: Write `sw.js`**

```js
// Pass-through service worker: present only so browsers treat the site as an
// installable app. It caches nothing, so a new GitHub Pages deploy is always
// picked up; Firestore's own persistent cache handles offline data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
```

- [ ] **Step 5: Head tags.** In `index.html` replace `<title>Kombucha Orders</title>` with:

```html
  <title>Real Health Kombucha</title>
  <link rel="manifest" href="manifest.webmanifest" />
  <meta name="theme-color" content="#1c392d" />
  <link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png" />
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Kombucha" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

- [ ] **Step 6: Header icon.** Replace `<header>🍶 Kombucha Orders</header>` with:

```html
  <header><img src="icons/icon-192.png" alt="" style="width:22px;height:22px;border-radius:5px;vertical-align:-5px;margin-right:6px">Kombucha Orders</header>
```

- [ ] **Step 7: Register the service worker.** In the module script, right after the line `window.APP.esc = ...`, add:

```js
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("sw register failed:", e));
    }
    // Chrome/Android fire this when the app is installable; keep it for the install card.
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      window.APP.installEvent = e;
      if (window.APP.renderRestaurant) window.APP.renderRestaurant();
    });
```

- [ ] **Step 8: Verify in a browser.** Run `python3 -m http.server 8765` in the background from the repo root. Open `http://localhost:8765/` (use the claude-in-chrome skill). Check: the favicon + header icon show; there are no console errors about the manifest or `sw.js`; in the page, `await navigator.serviceWorker.getRegistration()` resolves to a registration (run via javascript_tool). Stop the server afterwards.

- [ ] **Step 9: Run tests + commit**

```bash
npm test 2>&1 | tail -3
git add icons manifest.webmanifest sw.js index.html
git commit -m "Make the app installable with the Real Health icon

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The signup QR code

**Files:**
- Create: `qr/make_qr.py`, `qr/signup-qr.png`, `qr/signup-qr.svg`

**Interfaces:**
- Consumes: `icons/icon-512.png` (Task 2).
- Produces: `qr/signup-qr.png` (shown in Settings by Task 7).

- [ ] **Step 1: Write `qr/make_qr.py`**

```python
"""Generate the self-signup QR code.  Run from repo root: python3 qr/make_qr.py"""
from pathlib import Path
import segno
from PIL import Image

URL = "https://roel-heremans.github.io/kombucha-orders-app/?signup"
HERE = Path(__file__).resolve().parent
ICON = HERE.parent / "icons" / "icon-512.png"
GREEN = "#1c392d"


def main():
    qr = segno.make(URL, error="h")  # 30% error correction leaves room for the centre logo
    qr.save(HERE / "signup-qr.svg", scale=10, border=4, dark=GREEN)  # vector, no logo
    png = HERE / "signup-qr.png"
    qr.save(png, scale=24, border=4, dark=GREEN)
    img = Image.open(png).convert("RGB")
    side = img.width // 5  # logo covers ~4% of the area, well within H-level correction
    logo = Image.open(ICON).convert("RGB").resize((side, side), Image.LANCZOS)
    pad = side // 10
    box = Image.new("RGB", (side + 2 * pad, side + 2 * pad), "white")
    box.paste(logo, (pad, pad))
    img.paste(box, ((img.width - box.width) // 2, (img.height - box.height) // 2))
    img.save(png, optimize=True)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Generate it**

Run: `python3 qr/make_qr.py && file qr/signup-qr.png qr/signup-qr.svg`
Expected: a PNG around 1000px square and an SVG.

- [ ] **Step 3: Verify that it decodes to the exact URL**

Run:
```bash
python3 -c "
import cv2
for f in ['qr/signup-qr.png']:
    img = cv2.imread(f)
    for s in (1.0, 0.25):  # full size and phone-camera-ish small size
        im = cv2.resize(img, None, fx=s, fy=s)
        print(f, s, repr(cv2.QRCodeDetector().detectAndDecode(im)[0]))
"
```
Expected: both lines print `'https://roel-heremans.github.io/kombucha-orders-app/?signup'`. If decoding fails, reduce the logo (`side = img.width // 6`) and retry. Also open the PNG with the Read tool to eyeball it.

- [ ] **Step 4: Commit**

```bash
git add qr
git commit -m "Add the self-signup QR code

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Firestore rules for signups

**Files:**
- Modify: `firestore.rules` (add a block after the `customers` match)
- Modify: `docs/FIREBASE_SETUP.md` (append a section)

- [ ] **Step 1: Add the rules** after the `match /customers/{id} { ... }` block:

```
    // Self-signup requests (from the QR code). A user may file only their own
    // request; admins review and delete them. No update: re-submitting happens
    // only after the admin deleted (rejected) the previous request.
    match /signups/{uid} {
      allow create: if signedIn() && request.auth.uid == uid
                    && request.resource.data.uid == uid
                    && request.resource.data.email == request.auth.token.email
                    && request.resource.data.type in ["private", "restaurant"]
                    && request.resource.data.name is string
                    && request.resource.data.name.size() > 0;
      allow read: if isAdmin() || (signedIn() && request.auth.uid == uid);
      allow delete: if isAdmin();
    }
```

- [ ] **Step 2: Document the manual publish step.** Append to `docs/FIREBASE_SETUP.md`:

```markdown
## Self-signup (QR code) rules — added 2026-09-21

The QR-code signup writes requests to a new `signups` collection. After pulling
this change, publish the updated rules: Firebase console → Firestore Database →
**Rules** → paste the full contents of `firestore.rules` → **Publish**. Until
then, new signups fail with `permission-denied`.

Optional: Authentication → Templates → **Password reset** → set the template
language to Portuguese, since the login screen's "Forgot password?" link uses it.
```

- [ ] **Step 3: Commit**

```bash
git add firestore.rules docs/FIREBASE_SETUP.md
git commit -m "Allow users to file their own signup request

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Signup view, login links, forgot password

**Files:**
- Modify: `index.html` — add `#signupView` markup after `#loginView`; add links in `#loginView`; module script: imports, `onAuthStateChanged` routing, new `window.APP` functions; a new plain `<script>` block for the signup UI placed just before the restaurant-view script block (the one that starts `const body = document.getElementById("restaurantBody");`).

**Interfaces:**
- Consumes: `KO.validateSignup`, `KO.whatsappSignupText`, `KO.t`, new strings (Task 1); `icons/logo.png` (Task 2); `window.APP.notifyWhatsApp(text)` (existing).
- Produces (on `window.APP`, used by Task 6):
  - `A.signUp(data, lang) -> Promise<void>`: creates the auth user and writes `signups/{uid}`. Sets `A.signupInFlight = true` for the duration.
  - `A.fileSignup(data, lang) -> Promise<void>`: writes `signups/{uid}` for the current user (re-submit). `data` = `validateSignup(...).data`.
  - `A.resetPassword(email) -> Promise<void>`
  - `A.showLogin()` / `A.showSignup()`: switch between the two logged-out views.

- [ ] **Step 1: Login view links.** In `#loginView`, after `<button class="primary" id="loginBtn">Log in</button>` add:

```html
      <p style="margin-top:14px"><button class="link" id="forgotBtn">Forgot password? / Esqueceu-se da palavra-passe?</button></p>
      <p><button class="link" id="toSignupBtn">New customer? Create an account / Novo cliente? Criar conta</button></p>
```

and at the top of that `.card`, before `<h3>Log in</h3>`, add:

```html
      <img src="icons/logo.png" alt="Real Health Kombucha" style="display:block;max-width:220px;width:60%;margin:0 auto 8px">
```

- [ ] **Step 2: Signup view markup.** After the closing `</main>` of `#loginView` add:

```html
  <!-- Self-signup view (reached from the QR code: ?signup) -->
  <main id="signupView" class="hidden"></main>
```

- [ ] **Step 3: Module imports.** Change the firebase-auth import line to:

```js
    import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail }
```

- [ ] **Step 4: Routing.** In the module script, replace the `if (!user) { ... return; }` block at the top of `onAuthStateChanged` with:

```js
      if (!user) {
        appView.classList.add("hidden");
        restaurantView.classList.add("hidden");
        if (window.APP.wantSignup) window.APP.showSignup(); else window.APP.showLogin();
        return;
      }
      signupView.classList.add("hidden");
```

and just above `onAuthStateChanged(` add:

```js
    const signupView = document.getElementById("signupView");
    window.APP.wantSignup = new URLSearchParams(location.search).has("signup");
    window.APP.showLogin = function () {
      window.APP.wantSignup = false;
      signupView.classList.add("hidden");
      loginView.classList.remove("hidden");
    };
    window.APP.showSignup = function () {
      window.APP.wantSignup = true;
      loginView.classList.add("hidden");
      signupView.classList.remove("hidden");
      if (window.APP.renderSignup) window.APP.renderSignup();
    };
    document.getElementById("toSignupBtn").addEventListener("click", () => window.APP.showSignup());
    document.getElementById("forgotBtn").addEventListener("click", async () => {
      const typed = document.getElementById("loginEmail").value;
      const err = document.getElementById("loginError");
      if (!typed.includes("@")) { err.textContent = "Type your email above first. / Escreva primeiro o seu email acima."; return; }
      try {
        await window.APP.resetPassword(typed);
        err.textContent = "Reset email sent — check your inbox. / Email enviado — veja a sua caixa de correio.";
      } catch (e) { err.textContent = "Could not send reset email: " + e.code; }
    });
```

- [ ] **Step 5: APP functions.** After `window.APP.logout = () => signOut(auth);` add:

```js
    window.APP.resetPassword = (email) => sendPasswordResetEmail(auth, window.KO.loginEmail(email, LOGIN_NAME_DOMAIN));

    window.APP.fileSignup = async function (data, lang) {
      const u = auth.currentUser;
      await setDoc(doc(db, "signups", u.uid), {
        uid: u.uid, email: u.email, name: data.name, type: data.type,
        contact: data.contact || "", phone: data.phone || "",
        lang: lang || "pt", createdAt: new Date().toISOString(),
      });
      window.APP.notifyWhatsApp(window.KO.whatsappSignupText(data.name, data.type));
    };

    // Creates the login (which also signs the user in) then files the request.
    // signupInFlight stops the customer view flashing the "complete your
    // details" form in the moment between those two steps.
    window.APP.signUp = async function (data, lang) {
      window.APP.signupInFlight = true;
      try {
        await createUserWithEmailAndPassword(auth, data.email, data.password);
        await window.APP.fileSignup(data, lang);
        history.replaceState(null, "", location.pathname); // drop ?signup so logout lands on login
        window.APP.wantSignup = false;
      } finally {
        window.APP.signupInFlight = false;
        if (window.APP.renderRestaurant) window.APP.renderRestaurant();
      }
    };
```

- [ ] **Step 6: Signup UI block.** Add a new plain script block before the restaurant-view block:

```html
  <script>
  document.addEventListener("DOMContentLoaded", function () {
    const A = window.APP, KO = window.KO;
    const view = document.getElementById("signupView");
    function lang() { try { return localStorage.getItem("ko_lang") || "pt"; } catch (e) { return "pt"; } }
    const T = (k) => KO.t(lang(), k);
    const keep = {}; // typed values survive a language switch

    function field(id, label, type, extra) {
      return `<label for="${id}">${label}</label><input id="${id}" type="${type}" value="${A.esc(keep[id] || "")}" ${extra || ""}/>`;
    }

    function render() {
      const l = lang();
      const b = (code, lbl) => `<button class="link su-lang" data-lang="${code}" style="${l === code ? "font-weight:700;text-decoration:underline" : ""}">${lbl}</button>`;
      const type = keep.suType || "private";
      view.innerHTML =
        `<div class="row" style="justify-content:flex-end;gap:6px;align-items:center">${b("en", "EN")}<span class="muted">|</span>${b("pt", "PT")}</div>` +
        `<div class="card">` +
          `<img src="icons/logo.png" alt="Real Health Kombucha" style="display:block;max-width:220px;width:60%;margin:0 auto 8px">` +
          `<h3>${T("signup_title")}</h3>` +
          field("suEmail", T("email"), "email", `autocomplete="email"`) +
          field("suPw", T("password"), "password", `autocomplete="new-password"`) +
          field("suPw2", T("password2"), "password", `autocomplete="new-password"`) +
          `<label for="suType">${T("type_label")}</label><select id="suType">` +
            `<option value="private" ${type === "private" ? "selected" : ""}>${T("type_private")}</option>` +
            `<option value="restaurant" ${type === "restaurant" ? "selected" : ""}>${T("type_restaurant")}</option></select>` +
          field("suName", T("name_label"), "text", `autocomplete="name"`) +
          `<div id="suContactWrap" class="${type === "restaurant" ? "" : "hidden"}">${field("suContact", T("contact_label"), "text")}</div>` +
          field("suPhone", T("phone_label"), "tel", `autocomplete="tel"`) +
          `<p id="suErr" class="muted" style="color:#c0392b"></p>` +
          `<button class="primary" id="suSubmit">${T("create_account")}</button>` +
          `<p style="margin-top:14px"><button class="link" id="suToLogin">${T("have_account")}</button></p>` +
        `</div>`;

      view.querySelectorAll("input,select").forEach((el) => el.addEventListener("input", () => {
        keep[el.id] = el.value;
        if (el.id === "suType") view.querySelector("#suContactWrap").classList.toggle("hidden", el.value !== "restaurant");
      }));
      view.querySelectorAll(".su-lang").forEach((btn) => btn.addEventListener("click", () => {
        try { localStorage.setItem("ko_lang", btn.dataset.lang); } catch (e) {}
        render();
      }));
      view.querySelector("#suToLogin").addEventListener("click", () => A.showLogin());
      view.querySelector("#suSubmit").addEventListener("click", onSubmit);
    }

    async function onSubmit() {
      const v = (id) => view.querySelector("#" + id).value;
      const err = view.querySelector("#suErr");
      const res = KO.validateSignup({
        email: v("suEmail"), password: v("suPw"), password2: v("suPw2"),
        name: v("suName"), type: v("suType"), contact: v("suContact"), phone: v("suPhone"),
      });
      if (!res.ok) { err.textContent = res.errors.map(T).join(" "); return; }
      const btn = view.querySelector("#suSubmit");
      btn.disabled = true; err.textContent = "";
      try {
        await A.signUp(res.data, lang());
      } catch (e) {
        err.textContent = e.code === "auth/email-already-in-use" ? T("err_email_in_use") : T("signup_failed") + " " + (e.code || e.message);
        btn.disabled = false;
      }
    }

    A.renderSignup = render;
    if (A.wantSignup) render();
  });
  </script>
```

- [ ] **Step 7: Verify in a browser.** Serve with `python3 -m http.server 8765` (background). Open `http://localhost:8765/?signup`. Check: signup view shows with the logo; EN/PT toggle switches labels and keeps typed values; picking Restaurant reveals Contact person; submitting empty shows the translated errors; "Already have an account?" goes to login; login shows both new links; "Forgot password?" with an empty field shows the "type your email" hint. **Do not** submit a real signup here (Task 6 and the rules are needed first; the end-to-end test is in Task 7). Check the console has no errors. Stop the server.

- [ ] **Step 8: Run tests + commit**

```bash
npm test 2>&1 | tail -3
git add index.html
git commit -m "Add the self-signup screen and forgot-password link

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Customer view — pending / re-submit state + install card

**Files:**
- Modify: `index.html` module script `onRestaurantLogin` (~line 243); restaurant-view plain script block (`render()` ~line 1684, the `if (!A.myCustomer) {...}` branch; and the linked-state `body.innerHTML = langToggleHtml(lang) + ...` assignment).

**Interfaces:**
- Consumes: `A.signupInFlight`, `A.fileSignup(data, lang)` (Task 5); `A.installEvent` (Task 2); `KO.installMode`, `KO.validateSignup`, strings (Task 1).
- Produces: `window.APP.mySignup` (object or `null`; `undefined` = not loaded yet).

- [ ] **Step 1: Watch the user's own signup doc.** In `onRestaurantLogin`, after the `// Own customer doc` onSnapshot, add:

```js
      // Own signup request (drives the "pending approval" screen while unlinked).
      window.APP.mySignup = undefined;
      onSnapshot(doc(db, "signups", uid), (d) => {
        window.APP.mySignup = d.exists() ? d.data() : null;
        window.APP.renderRestaurant();
      }, () => { window.APP.mySignup = null; window.APP.renderRestaurant(); });
```

(The error callback matters: after an admin links the account, a later rule failure must not throw unhandled.)

- [ ] **Step 2: Install card helper.** In the restaurant-view script block, after `langToggleHtml`, add:

```js
    function installDismissed() { try { return localStorage.getItem("ko_install_dismissed") === "1"; } catch (e) { return false; } }
    function installCardHtml() {
      const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
      const mode = KO.installMode(navigator.userAgent, standalone);
      if (mode === "installed" || installDismissed()) return "";
      if (mode === "prompt" && !A.installEvent) return ""; // browser hasn't offered install (yet)
      return `<div class="card" id="installCard" style="display:flex;gap:12px;align-items:center">` +
        `<img src="icons/icon-192.png" alt="" style="width:48px;height:48px;border-radius:10px;flex:0 0 48px">` +
        `<div style="flex:1"><strong>${T("install_title")}</strong>` +
          (mode === "ios" ? `<p class="muted" style="margin:4px 0">${T("install_ios")}</p>` : "") +
          `<div class="row" style="gap:12px;margin-top:4px">` +
            (mode === "prompt" ? `<button class="link" id="installBtn" style="font-weight:700">${T("install_btn")}</button>` : "") +
            `<button class="link" id="installLater">${T("not_now")}</button></div></div></div>`;
    }
    function wireInstallCard() {
      const later = body.querySelector("#installLater");
      if (later) later.addEventListener("click", () => {
        try { localStorage.setItem("ko_install_dismissed", "1"); } catch (e) {}
        const c = body.querySelector("#installCard"); if (c) c.remove();
      });
      const btn = body.querySelector("#installBtn");
      if (btn) btn.addEventListener("click", async () => {
        const ev = A.installEvent; if (!ev) return;
        A.installEvent = null;
        ev.prompt();
        try { await ev.userChoice; } catch (e) {}
        render();
      });
    }
```

- [ ] **Step 3: Replace the not-linked branch.** Replace the whole `if (!A.myCustomer) { ... return; }` block in `render()` with:

```js
      if (!A.myCustomer) {
        title.textContent = "Real Health Kombucha";
        const wire = () => {
          body.querySelectorAll(".lang-btn").forEach((b) => b.addEventListener("click", () => {
            try { localStorage.setItem("ko_lang", b.dataset.lang); } catch (e) {} render();
          }));
          wireInstallCard();
        };
        if (A.signupInFlight || A.mySignup === undefined) {
          body.innerHTML = `<p class='muted'>${T("loading")}</p>`; return;
        }
        if (A.mySignup) {
          body.innerHTML = langToggleHtml(lang) +
            `<div class='card'><img src="icons/logo.png" alt="" style="display:block;max-width:200px;width:55%;margin:0 auto 8px">` +
            `<p>${A.esc(T("pending_msg").replace("{name}", A.mySignup.name))}</p></div>` +
            installCardHtml();
          wire(); return;
        }
        // No request on file (rejected, or the write failed): let them re-submit.
        body.innerHTML = langToggleHtml(lang) +
          `<div class='card'><p>${T("complete_details")}</p>` +
          `<label>${T("type_label")}</label><select id="rsType">` +
            `<option value="private">${T("type_private")}</option><option value="restaurant">${T("type_restaurant")}</option></select>` +
          `<label>${T("name_label")}</label><input id="rsName" type="text"/>` +
          `<div id="rsContactWrap" class="hidden"><label>${T("contact_label")}</label><input id="rsContact" type="text"/></div>` +
          `<label>${T("phone_label")}</label><input id="rsPhone" type="tel"/>` +
          `<p id="rsErr" class="muted" style="color:#c0392b"></p>` +
          `<button class="primary" id="rsSend">${T("submit_details")}</button></div>`;
        wire();
        body.querySelector("#rsType").addEventListener("change", (e) =>
          body.querySelector("#rsContactWrap").classList.toggle("hidden", e.target.value !== "restaurant"));
        body.querySelector("#rsSend").addEventListener("click", async (e) => {
          const v = (id) => body.querySelector("#" + id).value;
          const res = KO.validateSignup({ name: v("rsName"), type: v("rsType"), contact: v("rsContact"), phone: v("rsPhone") },
            { skipCredentials: true });
          const err = body.querySelector("#rsErr");
          if (!res.ok) { err.textContent = res.errors.map(T).join(" "); return; }
          e.target.disabled = true;
          try { await A.fileSignup(res.data, lang); }
          catch (ex) { err.textContent = T("send_failed") + " " + (ex.code || ex.message); e.target.disabled = false; }
        });
        return;
      }
```

- [ ] **Step 4: Install card in the linked view.** In the linked-state assignment, change `body.innerHTML =\n        langToggleHtml(lang) +` to `body.innerHTML =\n        langToggleHtml(lang) + installCardHtml() +`, and after the existing `.lang-btn` wiring that follows it add `wireInstallCard();`.

- [ ] **Step 5: Remove the now-unused `not_linked` string** from both `STRINGS.en` and `STRINGS.pt` in `lib.js` (first run `grep -n not_linked index.html lib.js test/lib.test.js` and confirm it is referenced nowhere else).

- [ ] **Step 6: Verify.** `npm test` passes. Serve locally and log in with an existing restaurant test account if the user has one: the linked view still renders, with no console errors. The pending and re-submit states are verified end-to-end in Task 7, Step 8.

- [ ] **Step 7: Commit**

```bash
git add index.html lib.js
git commit -m "Show pending-approval and re-submit screens to unlinked customers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Admin — pending signups, Invite QR card, Phone field

**Files:**
- Modify: `index.html` — nav (Settings button, line ~70); module script (`window.APP.state`, `onLogin`, `window.APP.render`, CRUD section); settings plain script block (`customerBlockHtml`, `render()`, the `.c-save` handler, the "Customers Login" card).

**Interfaces:**
- Consumes: `KO.customerFromSignup`, `KO.linkPatch` (Task 1); `qr/signup-qr.png` (Task 3).
- Produces (on `window.APP`): `A.state.signups` array; `A.approveSignupNew(signup)`, `A.approveSignupLink(signup, customerId)`, `A.rejectSignup(uid)` → Promises; `A.updateSettingsBadge()`.

- [ ] **Step 1: Nav badge.** Change `<button data-view="settings">Settings</button>` to:

```html
      <button data-view="settings">Settings <span id="settingsBadge" class="badge hidden"></span></button>
```

- [ ] **Step 2: State + watch.** In the `window.APP = {...}` literal, add `signups: []` to `state`. In `window.APP.onLogin`, after `watch("stocktakes", S.stocktakes);` add `watch("signups", S.signups);`. In `window.APP.render`, after the `updateOrdersBadge` line add:

```js
      if (window.APP.updateSettingsBadge) window.APP.updateSettingsBadge();
```

- [ ] **Step 3: Approval writes.** After `window.APP.deleteCustomer = ...` add:

```js
    window.APP.approveSignupNew = function (s) {
      const b = writeBatch(db);
      b.set(doc(collection(db, "customers")), window.KO.customerFromSignup(s));
      b.delete(doc(db, "signups", s.uid));
      return b.commit();
    };
    window.APP.approveSignupLink = function (s, customerId) {
      const c = S.customers.find((x) => x.id === customerId);
      const b = writeBatch(db);
      b.update(doc(db, "customers", customerId), window.KO.linkPatch(c, s));
      b.delete(doc(db, "signups", s.uid));
      return b.commit();
    };
    window.APP.rejectSignup = (uid) => deleteDoc(doc(db, "signups", uid));
```

(`S` is `window.APP.state`, already declared as `const S` in the module before this point. Confirm with `grep -n "const S = window.APP.state" index.html` that the declaration comes before the CRUD section.)

- [ ] **Step 4: Settings — badge updater + pending card.** In the settings script block, before `function render()`, add:

```js
    function updateSettingsBadge() {
      const el = document.getElementById("settingsBadge");
      const n = A.state.signups.length;
      el.textContent = n; el.classList.toggle("hidden", n === 0);
    }
    A.updateSettingsBadge = updateSettingsBadge;

    function pendingSignupsHtml() {
      const list = A.state.signups.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      if (!list.length) return "";
      const linkable = A.state.customers.filter((c) => !c.uid).sort((a, b) => a.name.localeCompare(b.name));
      return `<div class="card" style="border-color:#c0392b"><h4>Pending signups (${list.length})</h4>` +
        list.map((s) =>
          `<div class="su-req" data-uid="${A.esc(s.uid)}" style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px">` +
          `<div><strong>${A.esc(s.name)}</strong> <span class="pill pill-muted">${s.type === "private" ? "Private" : "Restaurant"}</span></div>` +
          `<div class="muted">${A.esc(s.email)}${s.phone ? " · " + A.esc(s.phone) : ""}${s.contact ? " · contact: " + A.esc(s.contact) : ""}` +
            ` · ${A.esc((s.createdAt || "").slice(0, 10))}</div>` +
          `<div class="row" style="margin-top:6px"><button class="link su-new">Approve as new customer</button>` +
          `<button class="link su-reject" style="flex:0 0 70px;color:#c0392b">Reject</button></div>` +
          (linkable.length
            ? `<div class="row"><select class="su-cust"><option value="">— or link to existing customer —</option>` +
                linkable.map((c) => `<option value="${c.id}">${A.esc(c.name)}</option>`).join("") +
              `</select><button class="link su-link" style="flex:0 0 50px">Link</button></div>`
            : "") +
          `<p class="muted su-msg"></p></div>`).join("") +
        `</div>`;
    }

    function wirePendingSignups() {
      container.querySelectorAll(".su-req").forEach((row) => {
        const s = A.state.signups.find((x) => x.uid === row.dataset.uid);
        const msg = row.querySelector(".su-msg");
        const run = async (fn, okText) => {
          row.querySelectorAll("button").forEach((b) => (b.disabled = true));
          try { await fn(); A.toast(okText); }
          catch (e) { msg.textContent = "Failed: " + (e.code || e.message); row.querySelectorAll("button").forEach((b) => (b.disabled = false)); }
        };
        row.querySelector(".su-new").addEventListener("click", () => run(() => A.approveSignupNew(s), "Approved " + s.name));
        row.querySelector(".su-reject").addEventListener("click", () => {
          if (confirm("Reject the signup from " + s.name + "?")) run(() => A.rejectSignup(s.uid), "Rejected " + s.name);
        });
        const link = row.querySelector(".su-link");
        if (link) link.addEventListener("click", () => {
          const cid = row.querySelector(".su-cust").value;
          if (!cid) { msg.textContent = "Choose a customer to link to."; return; }
          run(() => A.approveSignupLink(s, cid), s.name + " linked to " + A.customerName(cid));
        });
      });
    }
```

- [ ] **Step 5: Insert the pending card, the Invite QR card, and rename the manual card.** In `render()`, change the start of `container.innerHTML =` to:

```js
      container.innerHTML =
        pendingSignupsHtml() +
        `<div class="card"><h4>Account</h4>` + ...
```

(keep the rest of the existing Account card string unchanged). Directly before the `Customers Login` card string, insert:

```js
        `<div class="card"><details><summary>Invite QR (self-signup)</summary>` +
          `<p class="muted">Anyone who scans this can request an account; you approve them above.</p>` +
          `<img src="qr/signup-qr.png" alt="Signup QR code" style="display:block;width:100%;max-width:280px;margin:8px auto">` +
          `<p style="text-align:center"><a href="qr/signup-qr.png" download="real-health-kombucha-signup-qr.png">Download PNG</a> · ` +
          `<a href="qr/signup-qr.svg" download="real-health-kombucha-signup-qr.svg">SVG</a></p>` +
          `<p class="muted" style="word-break:break-all">https://roel-heremans.github.io/kombucha-orders-app/?signup</p>` +
        `</details></div>` +
```

Then in the Customers Login card replace `<summary>Customers Login</summary>` with `<summary>Manual login (customers without email)</summary>` and its `<p class="muted">Create an app login so a restaurant can place their own orders.</p>` with `<p class="muted">For customers without an email address (they can't use the QR signup). You choose the name and password and tell them yourself.</p>`. After the existing `rlCreate` wiring at the end of `render()`, add `wirePendingSignups();`.

Also update the customer-block hint text `No login yet — create one in Customers Login below first.` to `No login yet — send them the Invite QR, or use Manual login below.` (Task 8 later deletes the invite branch, but this line is kept).

- [ ] **Step 6: Phone field.** In `customerBlockHtml`, after the Contact person input, add:

```js
      `<label>Phone</label><input class="c-phone" type="tel" value="${A.esc(c.phone||"")}"/>` +
```

and in the `.c-save` handler object add `phone: card.querySelector(".c-phone").value.trim(),` after the `contact:` line.

- [ ] **Step 7: Run tests.** `npm test 2>&1 | tail -3` → `# fail 0`.

- [ ] **Step 8: End-to-end verification (needs the user).** Ask the user to publish `firestore.rules` in the Firebase console first (Task 4 doc). Then, on `python3 -m http.server 8765` with the browser:
  1. Open `http://localhost:8765/?signup` in a fresh profile/incognito tab. Sign up with a test address the user provides (e.g. a `+test` alias of their Gmail). Expected: the "Thanks, {name}!" pending screen; the admins get a WhatsApp message.
  2. In the admin session: the Settings badge shows 1; the Pending signups card lists the request. Click **Approve as new customer**. Expected: a toast; the request disappears; the customer exists with type/phone/email; the test user's screen switches to the order form **without a reload**.
  3. Repeat with a second test signup and **Link to existing customer** (pick a throwaway customer without a login). Expected: that customer now has the uid/email; contact/phone only filled if they were blank.
  4. A third test signup → **Reject**. Expected: the test user's screen shows the "Complete your details" form; re-submitting brings the request back to the admin list.
  5. On the login screen, "Forgot password?" with the test email → the reset email arrives.
  6. Chrome DevTools → Application → Manifest: no errors, icons shown, "installable".
  Afterwards, remind the user to delete the test customers and, in the Firebase console, the test Auth users.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "Let admins approve, link or reject self-signups

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**⏸ STOP after Task 7.** Report to the user and ask them to test on their phones (scan the QR, install the app). Do not start Task 8 until they explicitly say go.

---

### Task 8 (Phase 2 — only after the user says go): Remove the invite email

**Files:**
- Modify: `index.html` (the `EMAILJS_INVITE_TEMPLATE` const + comment in `EMAILJS_CONFIG`'s preceding comment block; `window.APP.emailInvite` + its comment; the `status === "real"` invite branch in `customerBlockHtml`; the `const invite = card.querySelector(".c-invite"); if (invite) {...}` block in the `.cust-edit` loop)
- Modify: `lib.js` (`inviteEmailParams` + its export), `test/lib.test.js` (its tests), `docs/EMAILJS_SETUP.md` (the "App invite email" section)

- [ ] **Step 1: Find every reference**

Run: `grep -n "inviteEmailParams\|emailInvite\|EMAILJS_INVITE_TEMPLATE\|c-invite\|App invite\|Send App Invite" index.html lib.js test/lib.test.js docs/*.md`
Expected: only the locations listed above.

- [ ] **Step 2: Delete them.**
  - `lib.js`: delete the `inviteEmailParams` function and `inviteEmailParams, ` from the exports.
  - `test/lib.test.js`: delete every `test("inviteEmailParams ...` block.
  - `index.html`: delete `const EMAILJS_INVITE_TEMPLATE = ...;`, delete the `// Unlike notifyNewOrder/emailRecibo ...` comment and the whole `window.APP.emailInvite = async function ... };`, and delete the `const invite = ...; if (invite) { ... }` block. In `customerBlockHtml` replace the whole three-way `(status === "real" ? ... : ...)` expression with:

    ```js
      (status === "none"
        ? `<p class="muted">No login yet — send them the Invite QR, or use Manual login below.</p>`
        : "") +
    ```
  - In the `EMAILJS_CONFIG` comment, remove the words `so its slot was reused for invites` (end the sentence at `every order.`).
  - `docs/EMAILJS_SETUP.md`: delete the "App invite email" section.

- [ ] **Step 3: Verify nothing is left**

Run: `grep -n "inviteEmailParams\|emailInvite\|EMAILJS_INVITE_TEMPLATE\|c-invite" index.html lib.js test/lib.test.js docs/*.md; npm test 2>&1 | tail -3`
Expected: no grep output; `# fail 0`. Serve locally and open Settings → Customers → pick a customer: the card renders with no console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html lib.js test/lib.test.js docs/EMAILJS_SETUP.md
git commit -m "Remove the admin-typed-password invite email

Self-signup via the QR code replaces it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Tell the user** they can delete the invite template (`template_flxfpn9`) in the EmailJS dashboard, which frees a free-tier template slot.
