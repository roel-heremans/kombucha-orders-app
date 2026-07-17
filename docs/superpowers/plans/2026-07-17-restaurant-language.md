# Restaurant Language (EN / PT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a restaurant read their side of the app in English or Portuguese via an EN | PT toggle, remembered per-device, defaulting to Portuguese. Admin app, emails, and PDFs stay English.

**Architecture:** A translation dictionary + `t(lang, key)` in `lib.js` (pure, tested), plus optional `lang` args on `orderStatusLabel`/`monthName`/`windowLabel` (default English → admin unchanged). The restaurant view reads `ko_lang` from localStorage and renders every string through `t()`, with a toggle that persists and re-renders.

**Tech Stack:** Vanilla HTML/CSS/JS (no build step), `node --test` for lib, GitHub Pages. No Firebase/rules/schema change.

## Global Constraints

- No build step; single `index.html` + `lib.js` + CDN Firebase. No deps.
- Pure logic in `lib.js` (UMD return object) with tests in `test/lib.test.js`; run `npm test`.
- Restaurant view is a `DOMContentLoaded` IIFE reading `window.APP` (A) and `window.KO` (KO).
- Data values interpolated into innerHTML stay escaped with `A.esc(...)`; translated strings are static literals from the dictionary.
- New `lang` args are **optional, default English** — the admin dashboard/orders/production/recibo views must be byte-unchanged in behavior.
- Language is per-device via `localStorage["ko_lang"]`, default `"pt"`, read inside a try/catch.
- Only restaurant-facing strings are translated; admin, emails, PDFs, and data (flavour/size/customer names) are not.

---

### Task 1: i18n layer in `lib.js`

**Files:**
- Modify: `lib.js` (add `STRINGS`, `t`, `PT_MONTH_NAMES`; add optional `lang` to `monthName`, `windowLabel`, `orderStatusLabel`)
- Test: `test/lib.test.js`

**Interfaces (produced):**
- `KO.t(lang, key)` → translated string; unknown/undefined lang → English; unknown key → the key.
- `KO.monthName(mk, lang)` / `KO.windowLabel(startMk, endMk, lang)` / `KO.orderStatusLabel(status, lang)` — optional `lang` (default English).

- [ ] **Step 1: Write the failing tests**

Append to `test/lib.test.js`:

```javascript
test("t returns the language string, falling back to English then the key", () => {
  assert.strictEqual(KO.t("en", "send_order"), "Send order");
  assert.strictEqual(KO.t("pt", "send_order"), "Enviar pedido");
  assert.strictEqual(KO.t("de", "send_order"), "Send order");   // unknown lang -> en
  assert.strictEqual(KO.t(undefined, "your_orders"), "Your orders");
  assert.strictEqual(KO.t("pt", "no_such_key"), "no_such_key"); // unknown key -> key
});

test("orderStatusLabel keeps English by default and translates with lang", () => {
  assert.strictEqual(KO.orderStatusLabel("requested"), "⏳ Requested");
  assert.strictEqual(KO.orderStatusLabel("delivered"), "✅ Delivered");
  assert.strictEqual(KO.orderStatusLabel("cancelled"), "✖ Cancelled");
  assert.strictEqual(KO.orderStatusLabel("requested", "pt"), "⏳ Solicitado");
  assert.strictEqual(KO.orderStatusLabel("delivered", "pt"), "✅ Entregue");
  assert.strictEqual(KO.orderStatusLabel("cancelled", "pt"), "✖ Cancelado");
});

test("monthName and windowLabel support Portuguese, English by default", () => {
  assert.strictEqual(KO.monthName("2026-07"), "July");
  assert.strictEqual(KO.monthName("2026-07", "pt"), "Julho");
  assert.strictEqual(KO.monthName("2026-03", "pt"), "Março");
  assert.strictEqual(KO.windowLabel("2026-07", "2026-07"), "Jul 2026");
  assert.strictEqual(KO.windowLabel("2026-03", "2026-03", "pt"), "Mar 2026");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` — Expected: FAIL (`KO.t is not a function`; the pt/`lang` assertions fail).

- [ ] **Step 3: Add PT month names + STRINGS + t; extend the label functions**

In `lib.js`, after the `MONTH_NAMES` declaration add:

```javascript
  const PT_MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
    "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  const STRINGS = {
    en: {
      log_out: "Log out", new_order: "New order", size: "Size", flavour: "Flavour",
      qty: "Qty", choose_flavour: "— choose flavour —", add_line: "➕ Add line",
      preferred_date: "Preferred date (optional)", note: "Note (optional)",
      send_order: "Send order", need_line: "Add at least one bottle line with a flavour.",
      order_sent: "Order sent ✓", send_failed: "Send failed:", your_orders: "Your orders",
      clear_finished: "Clear finished", no_orders: "No orders yet.",
      all_cleared: "All finished orders cleared.", cancel: "Cancel",
      confirm_cancel: "Cancel this order?", show_cleared: "Show cleared orders",
      hide_cleared: "Hide cleared orders", my_recibos: "My Recibos",
      download_print: "Download / Print", no_recibos: "No recibos yet.",
      recibo_unavailable: "That recibo is no longer available.",
      recibo_open_failed: "Could not open the recibo:",
      not_linked: "Your account isn't linked to a customer yet. Please contact us.",
      loading: "Loading…", status_requested: "Requested", status_delivered: "Delivered",
      status_cancelled: "Cancelled",
    },
    pt: {
      log_out: "Sair", new_order: "Novo pedido", size: "Tamanho", flavour: "Sabor",
      qty: "Qtd", choose_flavour: "— escolher sabor —", add_line: "➕ Adicionar linha",
      preferred_date: "Data preferida (opcional)", note: "Nota (opcional)",
      send_order: "Enviar pedido", need_line: "Adicione pelo menos uma linha com um sabor.",
      order_sent: "Pedido enviado ✓", send_failed: "Falha no envio:", your_orders: "Os seus pedidos",
      clear_finished: "Limpar concluídos", no_orders: "Ainda não há pedidos.",
      all_cleared: "Todos os pedidos concluídos foram limpos.", cancel: "Cancelar",
      confirm_cancel: "Cancelar este pedido?", show_cleared: "Mostrar pedidos limpos",
      hide_cleared: "Ocultar pedidos limpos", my_recibos: "Os meus Recibos",
      download_print: "Descarregar / Imprimir", no_recibos: "Ainda não há recibos.",
      recibo_unavailable: "Esse recibo já não está disponível.",
      recibo_open_failed: "Não foi possível abrir o recibo:",
      not_linked: "A sua conta ainda não está associada a um cliente. Contacte-nos, por favor.",
      loading: "A carregar…", status_requested: "Solicitado", status_delivered: "Entregue",
      status_cancelled: "Cancelado",
    },
  };

  function t(lang, key) {
    return (STRINGS[lang] || STRINGS.en)[key] || STRINGS.en[key] || key;
  }
```

Change `monthName` to take `lang`:

```javascript
  function monthName(mk, lang) { return (lang === "pt" ? PT_MONTH_NAMES : MONTH_NAMES)[parseInt(mk.slice(5, 7), 10) - 1]; }
```

Change `windowLabel` to take + pass `lang`:

```javascript
  function windowLabel(startMk, endMk, lang) {
    const abbr = function (mk) { return monthName(mk, lang).slice(0, 3); };
    const year = function (mk) { return mk.slice(0, 4); };
    if (startMk === endMk) return abbr(startMk) + " " + year(startMk);
    if (year(startMk) === year(endMk)) return abbr(startMk) + "–" + abbr(endMk) + " " + year(endMk);
    return abbr(startMk) + " " + year(startMk) + "–" + abbr(endMk) + " " + year(endMk);
  }
```

Replace `orderStatusLabel` with the lang-aware version:

```javascript
  function orderStatusLabel(status, lang) {
    if (status === "delivered") return "✅ " + t(lang, "status_delivered");
    if (status === "cancelled") return "✖ " + t(lang, "status_cancelled");
    return "⏳ " + t(lang, "status_requested");
  }
```

- [ ] **Step 4: Export `t`**

Add `t` to the `return { ... }` object in `lib.js` (`monthName`, `windowLabel`, `orderStatusLabel` are already exported).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test` — Expected: PASS (new tests green; all existing tests, including the old English-only `orderStatusLabel`/`windowLabel`/`monthName` assertions, still pass because `lang` defaults to English).

- [ ] **Step 6: Commit**

```bash
git add lib.js test/lib.test.js
git commit -m "feat: add EN/PT i18n dictionary + t() and lang-aware labels to lib.js"
```

---

### Task 2: Restaurant view — language toggle + translated strings

**Files:**
- Modify: `index.html` — replace the restaurant view IIFE (the `document.addEventListener("DOMContentLoaded", …)` block that defines `A.renderRestaurant`, currently ~lines 1186–1387).

**Interfaces:** consumes `KO.t`, `KO.orderStatusLabel(status, lang)`, `KO.windowLabel(mk, mk, lang)`, existing restaurant helpers/handlers.

- [ ] **Step 1: Replace the restaurant IIFE with the translated version**

Replace the whole restaurant view IIFE with the following (same logic; every UI string now goes through the IIFE-local translator `T`, a language toggle is added at the top of the body, and the header **Log out** is relabeled on each render):

```html
  <script>
  document.addEventListener("DOMContentLoaded", function () {
    const A = window.APP, KO = window.KO;
    const body = document.getElementById("restaurantBody");
    const title = document.getElementById("restaurantTitle");
    let showCleared = false;

    function currentLang() { try { return localStorage.getItem("ko_lang") || "pt"; } catch (e) { return "pt"; } }
    const T = (k) => KO.t(currentLang(), k);

    function base64ToBlob(b64, type) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: type || "application/pdf" });
    }

    function myRecibos() {
      const uid = A.user ? A.user.uid : null;
      return A.state.recibos.filter((r) => r.customerUid === uid)
        .slice().sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1));
    }

    function hiddenKey() { return "ko_hidden_orders_" + (A.user ? A.user.uid : ""); }
    function getHidden() {
      try { return new Set(JSON.parse(localStorage.getItem(hiddenKey()) || "[]")); }
      catch (e) { return new Set(); }
    }
    function saveHidden(set) {
      try { localStorage.setItem(hiddenKey(), JSON.stringify(Array.from(set))); } catch (e) {}
    }

    function sizeOptions() {
      return (A.state.settings ? A.state.settings.sizes : [])
        .map((s) => `<option value="${s.id}">${A.esc(s.label)}</option>`).join("");
    }
    function flavourOptions() {
      return `<option value="">${T("choose_flavour")}</option>` +
        A.state.flavours.slice().sort((a, b) => a.name.localeCompare(b.name))
          .map((f) => `<option value="${f.id}">${A.esc(f.name)}</option>`).join("");
    }
    function itemRowHtml() {
      return `<div class="row order-item">` +
        `<div><label>${T("size")}</label><select class="oi-size">${sizeOptions()}</select></div>` +
        `<div><label>${T("flavour")}</label><select class="oi-flav">${flavourOptions()}</select></div>` +
        `<div style="flex:0 0 64px"><label>${T("qty")}</label><input class="oi-qty" type="number" min="1" value="1"/></div>` +
        `<button class="link oi-del" style="flex:0 0 32px">✕</button></div>`;
    }

    function langToggleHtml(lang) {
      const b = (code, lbl) => `<button class="link lang-btn" data-lang="${code}" style="${lang === code ? "font-weight:700;text-decoration:underline" : ""}">${lbl}</button>`;
      return `<div class="row" style="justify-content:flex-end;gap:6px;align-items:center">${b("en", "EN")}<span class="muted">|</span>${b("pt", "PT")}</div>`;
    }

    function myOrders() {
      const uid = A.user ? A.user.uid : null;
      return A.state.orders.filter((o) => o.customerUid === uid).slice().sort((a, b) => {
        const ta = (a.createdAt && a.createdAt.seconds) || 0;
        const tb = (b.createdAt && b.createdAt.seconds) || 0;
        return tb - ta;
      });
    }

    function render() {
      if (A.role !== "restaurant") return;
      const lang = currentLang();
      const logoutBtn = document.getElementById("restaurantLogout");
      if (logoutBtn) logoutBtn.textContent = T("log_out");
      if (!A.state.settings) { body.innerHTML = `<p class='muted'>${T("loading")}</p>`; return; }
      if (!A.myCustomer) {
        body.innerHTML = langToggleHtml(lang) + `<div class='card'><p>${T("not_linked")}</p></div>`;
        body.querySelectorAll(".lang-btn").forEach((b) => b.addEventListener("click", () => {
          try { localStorage.setItem("ko_lang", b.dataset.lang); } catch (e) {} render();
        }));
        return;
      }
      title.textContent = A.myCustomer.name;
      const sizes = A.state.settings.sizes;
      const all = myOrders();
      const hidden = getHidden();
      const isFinished = (o) => o.status === "delivered" || o.status === "cancelled";
      const visible = showCleared ? all : all.filter((o) => !hidden.has(o.id));
      const clearable = all.filter((o) => isFinished(o) && !hidden.has(o.id));
      const hiddenCount = all.filter((o) => hidden.has(o.id)).length;

      const ordersBody =
        all.length === 0 ? `<p class='muted'>${T("no_orders")}</p>` :
        visible.length === 0 ? `<p class='muted'>${T("all_cleared")}</p>` :
        visible.map((o) => {
          const cancel = o.status === "requested"
            ? ` <button class="link" data-cancelmine="${o.id}">${T("cancel")}</button>` : "";
          return `<div class="row" style="justify-content:space-between">` +
            `<div><div>${A.esc(KO.orderItemsSummary(o, sizes, A.flavourName))}</div>` +
            `<div class="muted">${KO.orderStatusLabel(o.status, lang)}${o.preferredDate ? " · " + A.esc(o.preferredDate) : ""}</div></div>` +
            `<div>${cancel}</div></div>`;
        }).join("");

      body.innerHTML =
        langToggleHtml(lang) +
        `<div class="card"><h3>${T("new_order")}</h3>` +
          `<div id="orderItems">${itemRowHtml()}</div>` +
          `<button class="link" id="addOrderLine">${T("add_line")}</button>` +
          `<label>${T("preferred_date")}</label><input id="orderDate" type="date"/>` +
          `<label>${T("note")}</label><textarea id="orderNote" rows="2"></textarea>` +
          `<p id="orderErr" class="muted"></p>` +
          `<button class="primary" id="sendOrder">${T("send_order")}</button></div>` +
        `<div class="card">` +
          `<div class="row" style="justify-content:space-between;align-items:center">` +
            `<h3 style="margin:0">${T("your_orders")}</h3>` +
            (clearable.length ? `<button class="link" id="clearFinished">${T("clear_finished")}</button>` : "") +
          `</div>` +
          ordersBody +
          (hiddenCount ? `<p class="muted" style="margin-top:8px"><button class="link" id="toggleCleared">${showCleared ? T("hide_cleared") : T("show_cleared") + " (" + hiddenCount + ")"}</button></p>` : "") +
        `</div>` +
        `<div class="card"><h3>${T("my_recibos")}</h3>` +
          (myRecibos().length
            ? myRecibos().map((r) =>
                `<div class="row" style="justify-content:space-between">` +
                `<div>${A.esc(KO.windowLabel(r.monthKey, r.monthKey, lang))}<div class="muted">${A.esc(r.fileName)}</div></div>` +
                `<button class="link" data-getrec="${r.id}">${T("download_print")}</button></div>`).join("")
            : `<p class='muted'>${T("no_recibos")}</p>`) +
          `<p id="recMsg" class="muted"></p></div>`;

      body.querySelectorAll(".lang-btn").forEach((b) => b.addEventListener("click", () => {
        try { localStorage.setItem("ko_lang", b.dataset.lang); } catch (e) {} render();
      }));

      const itemsDiv = body.querySelector("#orderItems");
      body.querySelector("#addOrderLine").addEventListener("click", (e) => {
        e.preventDefault();
        const tmp = document.createElement("div");
        tmp.innerHTML = itemRowHtml();
        itemsDiv.appendChild(tmp.firstElementChild);
      });
      itemsDiv.addEventListener("click", (e) => {
        if (e.target.classList.contains("oi-del")) { e.preventDefault(); e.target.closest(".order-item").remove(); }
      });
      body.querySelector("#sendOrder").addEventListener("click", onSend);
      body.querySelectorAll("[data-cancelmine]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (confirm(T("confirm_cancel"))) await A.cancelOrder(b.dataset.cancelmine);
        }));
      const clearBtn = body.querySelector("#clearFinished");
      if (clearBtn) clearBtn.addEventListener("click", () => {
        const hidden = getHidden();
        myOrders().forEach((o) => { if (o.status === "delivered" || o.status === "cancelled") hidden.add(o.id); });
        saveHidden(hidden);
        showCleared = false;
        render();
      });
      const toggleBtn = body.querySelector("#toggleCleared");
      if (toggleBtn) toggleBtn.addEventListener("click", () => { showCleared = !showCleared; render(); });

      body.querySelectorAll("[data-getrec]").forEach((b) =>
        b.addEventListener("click", async () => {
          const win = window.open("", "_blank");
          const setMsg = (t) => { const m = body.querySelector("#recMsg"); if (m) m.textContent = t; };
          try {
            const snap = await A.fetchReciboFile(b.dataset.getrec);
            if (!snap.exists()) { if (win) win.close(); setMsg(T("recibo_unavailable")); return; }
            const d = snap.data();
            const url = URL.createObjectURL(base64ToBlob(d.data, d.contentType));
            if (win) win.location.href = url; else window.location.href = url;
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          } catch (ex) {
            if (win) win.close();
            setMsg(T("recibo_open_failed") + " " + (ex.code || ex.message));
          }
        }));
    }

    async function onSend() {
      const err = body.querySelector("#orderErr");
      const btn = body.querySelector("#sendOrder");
      const items = [];
      body.querySelectorAll(".order-item").forEach((r) => {
        const sizeId = r.querySelector(".oi-size").value;
        const flavourId = r.querySelector(".oi-flav").value;
        const quantity = parseInt(r.querySelector(".oi-qty").value, 10) || 0;
        if (sizeId && flavourId && quantity > 0) items.push({ sizeId, flavourId, quantity });
      });
      if (items.length === 0) { err.textContent = T("need_line"); return; }
      if (btn) btn.disabled = true;
      const preferredDate = body.querySelector("#orderDate").value || "";
      const note = body.querySelector("#orderNote").value.trim();
      let saved = false;
      try {
        await A.addOrder({
          customerId: A.myCustomer.id, customerUid: A.user.uid,
          items, preferredDate, note, status: "requested", createdAt: A.serverTimestamp(),
        });
        saved = true;
        const msg = document.getElementById("orderErr");
        if (msg) msg.textContent = T("order_sent");
      } catch (ex) {
        const msg = document.getElementById("orderErr");
        if (msg) msg.textContent = T("send_failed") + " " + ex.message;
        const b2 = document.getElementById("sendOrder");
        if (b2) b2.disabled = false;
      }
      if (saved) {
        try {
          A.notifyNewOrder(KO.orderEmailParams(
            { items, preferredDate, note }, A.myCustomer.name,
            A.state.settings.sizes, A.flavourName, new Date().toLocaleString()
          ));
        } catch (e) { console.warn("order email skipped:", e); }
      }
    }

    A.renderRestaurant = render;
  });
  </script>
```

- [ ] **Step 2: Syntax-check + tests**

Run the inline-script syntax check (expected `classic blocks 8 errors 0`) and `npm test` (green, no lib change here):
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("index.html","utf8");const re=/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;let m,i=0,bad=0;while((m=re.exec(h))){const s=m[1];if(!s.trim()||/^\s*import\s/m.test(s))continue;i++;try{new Function(s)}catch(e){console.log("ERR",e.message);bad++}}console.log("classic blocks",i,"errors",bad)'
```

- [ ] **Step 3: Manual verification (browser)**

Run `python3 -m http.server 8000`, log in as a **restaurant** (incognito). Verify: the view is **Portuguese** by default (Novo pedido, Enviar pedido, Os seus pedidos, Os meus Recibos, header "Sair"); the top-right **EN | PT** toggle switches every restaurant string incl. order statuses (⏳ Solicitado…), the recibo month label, buttons, the cancel confirm, and the "order sent"/error messages; the choice **persists across reload**. Confirm the **admin** app (log in as admin) is entirely **English**, including the Orders-tab status labels and dashboards.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: EN/PT language toggle for the restaurant view"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** dictionary + `t` + PT months + lang-aware labels (Task 1); toggle + all restaurant strings via `t`, default PT per-device, header relabel, admin untouched (Task 2). ✓
- **Types consistent:** `t(lang, key)`, `orderStatusLabel(status, lang)`, `windowLabel(mk, mk, lang)` signatures match the Task-2 call sites; optional `lang` defaults keep admin English. ✓
- **No placeholders.** Full code + commands throughout.

## Notes for the implementer

- Only `lib.js` is unit-tested (Task 1 TDD). Task 2 is browser-verified.
- Keep the admin views byte-unchanged — the only lib edits are additive/optional-arg; the only index.html edit is the restaurant IIFE.
- The IIFE-local `T`/`currentLang` read localStorage each call, so the toggle takes effect on the next `render()`; keep them inside the IIFE.
```
