# Toast Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the post-upload confirmation readable by showing it in a global toast that survives the Recibo view's re-render.

**Architecture:** One CSS block + one `APP.toast()` function + two call sites in the existing `#ruUpload` handler. No lib change, no test change (UI-only, manual verification).

**Tech Stack:** Vanilla JS single-file app (`index.html`), no build step.

## Global Constraints

- No new dependencies, no build step, no new script tags.
- Match existing palette: success `var(--green)` (#4a7c59), error `#c0392b`.
- The toast element is created lazily in JS and appended to `document.body` (outside the view containers) so `APP.render()` never wipes it.
- `npm test` must stay green at 73 (no lib/test change).

---

### Task 1: Global toast — CSS, `APP.toast`, and upload-handler wiring

**Files:**
- Modify: `index.html` — `<style>` block (before `</style>` at line 34); after the `emailRecibo` function (line 342); the `#ruUpload` handler (success line 1171 and catch line 1173).

**Interfaces:**
- Produces: `window.APP.toast(msg, isError)` — shows a bottom-center toast for ~5s; `isError` truthy → red styling.

- [ ] **Step 1: Add the CSS**

In `index.html`, immediately before `</style>` (currently line 34), add:

```css
    .toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%) translateY(20px); background:var(--green); color:#fff; padding:12px 20px; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,.2); opacity:0; pointer-events:none; transition:opacity .3s, transform .3s; z-index:1000; max-width:90vw; text-align:center; font-size:14px; }
    .toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
    .toast.error { background:#c0392b; }
```

- [ ] **Step 2: Add the `APP.toast` function**

In `index.html`, immediately after the `emailRecibo` function's closing `};` (line 342), add:

```javascript
    window.APP.toast = function (msg, isError) {
      let el = document.getElementById("appToast");
      if (!el) {
        el = document.createElement("div");
        el.id = "appToast";
        el.setAttribute("role", "status");
        el.setAttribute("aria-live", "polite");
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.className = "toast show" + (isError ? " error" : "");
      clearTimeout(el._hideTimer);
      el._hideTimer = setTimeout(function () { el.className = "toast" + (isError ? " error" : ""); }, 5000);
    };
```

- [ ] **Step 3: Wire the success branch**

In the `#ruUpload` handler, the success message line is currently (index.html:1171):

```javascript
          const m = container.querySelector("#ruMsg"); if (m) m.textContent = msg;
```

Change it to also fire the toast:

```javascript
          const m = container.querySelector("#ruMsg"); if (m) m.textContent = msg;
          A.toast(msg);
```

- [ ] **Step 4: Wire the catch branch**

In the same handler's `catch (ex)` block, the error line is currently (index.html:1173):

```javascript
          const m = container.querySelector("#ruMsg"); if (m) m.textContent = "Upload failed: " + (ex.code || ex.message);
```

Change it to also fire an error toast:

```javascript
          const m = container.querySelector("#ruMsg"); if (m) m.textContent = "Upload failed: " + (ex.code || ex.message);
          A.toast("Upload failed: " + (ex.code || ex.message), true);
```

- [ ] **Step 5: Verify tests still pass**

Run: `npm test`
Expected: 73 pass (no lib/test change; confirms nothing broke).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Show upload confirmation in a global toast that survives re-render"
```

---

## Manual verification (browser, after implementation)

Serve locally, log in as admin, Recibo tab:
1. Upload an RV for a real-email customer → green toast "Uploaded ✓ — emailed …" bottom-center, readable ~5s through the list re-render, then fades.
2. Upload for a name-login customer → green toast "…no email on file; send it manually."
3. Trigger a failure (e.g. a non-PDF is already blocked earlier; to see the red toast, an actual upload error) → red toast.
