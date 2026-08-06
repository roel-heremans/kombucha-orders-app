# Settings → Customers: pick one customer at a time — Design Spec

Date: 2026-08-06
Status: design complete, implementation pending

## Goal

The Customers card in admin Settings renders an edit block for **every** customer
stacked vertically, which has grown unwieldy. Replace it with a dropdown that
lists all customers; only the selected customer's edit block renders.

## Decisions

- **Selection lives in `A.current.settingsCust`**, not in the DOM. The settings
  view re-renders via wholesale `container.innerHTML = …` on every Firestore
  snapshot, so DOM-held selection would be lost. `A.current` is the established
  pattern for view state in this app — `A.current.reciboCust` (`index.html:1250`)
  plus a `<select>` that calls `render()` on change (`index.html:1274`) is the
  direct precedent this mirrors.
- **The `<details>` wrapper and summary line stay.** `Customers (N) — M with
  email` is a useful at-a-glance number and costs nothing.
- **Dropdown labels carry a login-status suffix**, so the admin can spot who
  still needs a login or an invite without selecting each customer in turn.
  Derived from the existing `KO.customerEmailStatus(c, A.loginNameDomain)`.
- **Rendering change only.** The per-customer handler loop iterates `.cust-edit`
  blocks and will simply find one instead of many, so the save handler and the
  Send App Invite wiring stay untouched. This deliberately keeps the diff small.
- **Out of scope (YAGNI):** no search/filter box, no "add customer" here (that
  stays on the New delivery screen), no multi-select, no new `lib.js` helper.

## Layout

Inside the existing `<details>`:

```
Set each customer's details. Add new customers from the New delivery screen.

Customer  [ — choose customer —                    ▾ ]

   (nothing rendered until a customer is chosen)
```

With a customer selected, that customer's **existing** edit block renders
unchanged: email badge, Name, Contact person, Type, NIF, Notes, the invite
section (button / "no inbox" / "no login yet"), Save and Delete.

Dropdown option text is the customer name plus a status suffix:

| `customerEmailStatus` | Suffix | Meaning |
|---|---|---|
| `"real"` | ` ✉` | has a login and a real inbox — invitable |
| `"synthetic"` | ` — name login` | has a login, `@kombucha.app`, no inbox |
| `"none"` | ` — no login` | no login yet |

Options are sorted by name with `localeCompare`, matching the current block
order and the other customer pickers in the app.

## Behaviour

- Selecting a customer sets `A.current.settingsCust` and re-renders.
- Save is unchanged and leaves the selection in place, so the customer stays
  open after saving.
- **Delete clears `A.current.settingsCust`** before the state refresh. Without
  this the selection points at a customer that no longer exists, leaving an
  empty card and a stale dropdown value.
- **A selected id not present in `A.state.customers` renders as no selection.**
  Defensive: the customer may be deleted from another device or tab, and the
  resulting snapshot re-render must not attempt to render a missing customer.
  The dropdown falls back to `— choose customer —`.

## Testing

No new `lib.js` logic, so no new unit tests — the status mapping reuses
`customerEmailStatus`, which `test/lib.test.js` already covers. `npm test` must
stay at 78/78 as a regression check.

`index.html` has no automated coverage and a syntax error there blanks the admin
UI, so the implementation must verify the edited `<script>` block still parses
with `node --check` on the extracted block. Beyond that, verification is manual:

- The card shows the dropdown and no customer block on first open.
- Selecting a customer renders exactly that one block, with the right badge and
  the right one of the three invite states.
- Editing and saving keeps the same customer selected and persists the values.
- Deleting the selected customer resets the card to no selection, with the
  deleted name gone from the dropdown.
- The status suffixes match the badges shown inside the blocks.
