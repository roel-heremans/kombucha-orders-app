# Restaurant Language (EN / PT) — Design Spec

Date: 2026-07-17
Status: design complete, implementation pending

## Goal

Let a restaurant read their side of the app in **English or Portuguese**,
choosing via a toggle, remembered on their device, defaulting to Portuguese.
Only the restaurant-facing screens are translated; the admin app, order-alert
emails, and Recibo PDFs are unchanged.

## Decisions

- **Restaurant chooses** — an EN | PT toggle in the restaurant view.
- **Per device** — the choice is stored in `localStorage` (`ko_lang`), no schema
  or rules change (same approach as the "clear finished" preference).
- **Default Portuguese** on first visit (no stored value).
- **Scope:** order form, your-orders list + statuses, My Recibos, all
  buttons/labels/messages/confirms on the restaurant side. **Not** translated:
  the admin app, emails (to Roel + Nina), Recibo PDF contents, and **data**
  (flavour names, size labels like "1 L"/"270 ml", customer names).

## Mechanism

### `lib.js`

- `STRINGS = { en: { key: "…", … }, pt: { key: "…", … } }` — the dictionary
  (internal to the module).
- `t(lang, key)` → `(STRINGS[lang] || STRINGS.en)[key] || STRINGS.en[key] || key`.
  Pure; unknown/undefined `lang` falls back to English, unknown key returns the
  key itself. **Exported.**
- `PT_MONTH_NAMES` (internal) + `monthName(mk, lang)` — add an optional `lang`
  arg; `lang === "pt"` → Portuguese month, else English. **Default English**, so
  existing callers are unchanged.
- `windowLabel(startMk, endMk, lang)` — add optional `lang`, passed through to
  `monthName`. Default English.
- `orderStatusLabel(status, lang)` — refactor to build from `t(lang, …)` +
  emoji: `⏳ ` + Requested / `✅ ` + Delivered / `✖ ` + Cancelled. With no `lang`
  it still returns the current English strings (`"⏳ Requested"` etc.), so the
  admin Orders tab and existing tests are unaffected.

These are all backward-compatible additions (optional `lang`, default English);
the admin dashboard/production/recibo/orders views keep working with no change.

### Restaurant view (`index.html`)

- On render, read `const lang = localStorage.getItem("ko_lang") || "pt";` and
  define `const tr = (k) => KO.t(lang, k);`. Guard `localStorage` in a try/catch
  (private mode) — fall back to `"pt"`.
- Render **every** UI string through `tr(...)`; statuses via
  `KO.orderStatusLabel(o.status, lang)`; recibo months via
  `KO.windowLabel(mk, mk, lang)`.
- **Language toggle** at the top of `#restaurantBody`: `EN | PT`, the active one
  visually highlighted. Tapping sets `localStorage.setItem("ko_lang", …)` and
  re-renders (`A.renderRestaurant()`).
- Also set the header **Log out** button text via `tr("log_out")` on render (the
  toggle lives in the body; the header logout stays where it is, just relabeled).
- Data values still escaped with `A.esc(...)`; translated strings are static
  (safe) but interpolated consistently.

## Translation table (review / tweak the PT)

| key                | English                                             | Portuguese |
|--------------------|-----------------------------------------------------|------------|
| `log_out`          | Log out                                             | Sair |
| `new_order`        | New order                                           | Novo pedido |
| `size`             | Size                                                | Tamanho |
| `flavour`          | Flavour                                             | Sabor |
| `qty`              | Qty                                                 | Qtd |
| `choose_flavour`   | — choose flavour —                                  | — escolher sabor — |
| `add_line`         | ➕ Add line                                          | ➕ Adicionar linha |
| `preferred_date`   | Preferred date (optional)                           | Data preferida (opcional) |
| `note`             | Note (optional)                                     | Nota (opcional) |
| `send_order`       | Send order                                          | Enviar pedido |
| `need_line`        | Add at least one bottle line with a flavour.        | Adicione pelo menos uma linha com um sabor. |
| `order_sent`       | Order sent ✓                                        | Pedido enviado ✓ |
| `send_failed`      | Send failed:                                        | Falha no envio: |
| `your_orders`      | Your orders                                         | Os seus pedidos |
| `clear_finished`   | Clear finished                                      | Limpar concluídos |
| `no_orders`        | No orders yet.                                      | Ainda não há pedidos. |
| `all_cleared`      | All finished orders cleared.                        | Todos os pedidos concluídos foram limpos. |
| `cancel`           | Cancel                                              | Cancelar |
| `confirm_cancel`   | Cancel this order?                                  | Cancelar este pedido? |
| `show_cleared`     | Show cleared orders                                 | Mostrar pedidos limpos |
| `hide_cleared`     | Hide cleared orders                                 | Ocultar pedidos limpos |
| `my_recibos`       | My Recibos                                          | Os meus Recibos |
| `download_print`   | Download / Print                                    | Descarregar / Imprimir |
| `no_recibos`       | No recibos yet.                                     | Ainda não há recibos. |
| `recibo_unavailable`| That recibo is no longer available.                | Esse recibo já não está disponível. |
| `recibo_open_failed`| Could not open the recibo:                         | Não foi possível abrir o recibo: |
| `not_linked`       | Your account isn't linked to a customer yet. Please contact us. | A sua conta ainda não está associada a um cliente. Contacte-nos, por favor. |
| `loading`          | Loading…                                            | A carregar… |
| `status_requested` | Requested                                           | Solicitado |
| `status_delivered` | Delivered                                           | Entregue |
| `status_cancelled` | Cancelled                                           | Cancelado |

`show_cleared` renders with the count appended in code: `tr("show_cleared") + " (" + n + ")"`.

Portuguese month names (for `windowLabel` in My Recibos):
`Janeiro, Fevereiro, Março, Abril, Maio, Junho, Julho, Agosto, Setembro,
Outubro, Novembro, Dezembro` (abbreviated to 3 letters like the English path:
Jan, Fev, Mar, Abr, Mai, Jun, Jul, Ago, Set, Out, Nov, Dez).

## Testing

- `lib.js`: unit tests for `t` (en, pt, English fallback for unknown lang, key
  passthrough for unknown key), `orderStatusLabel` with and without `lang`
  (English default unchanged; `pt` → "⏳ Solicitado" etc.), `monthName(mk, "pt")`,
  and `windowLabel(..., "pt")`.
- Manual (restaurant login, browser): the view defaults to Portuguese; the EN | PT
  toggle switches all restaurant strings (order form, statuses, your-orders, My
  Recibos, buttons, confirms) and persists across reload; the admin app,
  status labels on the admin Orders tab, and dashboards remain English.

## Out of scope

- Translating the admin app, emails, or Recibo PDF contents.
- Translating data (flavour/size/customer names).
- More languages than EN/PT (the dictionary structure allows adding more later).
- Syncing the language across devices / an admin-set default (device-local only,
  per the chosen approach).
