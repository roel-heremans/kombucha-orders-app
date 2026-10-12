# Expenses & Profit — Design

**Goal:** let the admins record what they spend (ingredients, bottles, transport…)
so the Dashboard can show profit = revenue − expenses for the selected window.

Admin-only. Customers never see expenses. Stays on the free Firebase Spark plan
(no Cloud Storage): receipt files are stored base64 in Firestore, like recibos.

## Data model (Firestore)

### `expenseCategories/{id}`
| field | type | notes |
|-------|------|-------|
| `name` | string | e.g. "Ingredients" |

### `expenseItems/{id}`
| field | type | notes |
|-------|------|-------|
| `name` | string | e.g. "Green tea" |
| `categoryId` | string | → `expenseCategories` |
| `unit` | string | free text, e.g. "kg", "L", "pcs"; may be "" |

### `expenses/{id}`
| field | type | notes |
|-------|------|-------|
| `date` | string | `YYYY-MM-DD` (same format as deliveries) |
| `time` | string | `HH:MM` |
| `itemId` | string | → `expenseItems` |
| `categoryId` | string | **copied** from the item at save time; recategorizing an item later does not rewrite history |
| `quantity` | number \| null | optional, > 0 when set |
| `unit` | string | copied from the item at save time |
| `amount` | number | euros, > 0 |
| `note` | string | may be "" |
| `hasReceipt` | boolean | |
| `receiptName` | string | original file name, "" if none |
| `receiptType` | string | `image/jpeg` or `application/pdf`, "" if none |
| `enteredBy` | string | admin email |
| `createdAt` | server timestamp | |

### `expenseFiles/{id}` (same id as the expense)
| field | type | notes |
|-------|------|-------|
| `data` | string | base64, no `data:` prefix |
| `contentType` | string | `image/jpeg` or `application/pdf` |

Split from `expenses` so the list loads without file bytes; fetched on demand
when 📎 is tapped.

### Rules
All four collections: `allow read, write: if isAdmin();`

## Expenses tab (new admin nav button "Expenses", after Payments)

**Form** (top card):
- Date (default today) + Time (default now).
- Item ▾ — sorted by name, last option "➕ Add new item…". Choosing it reveals an
  inline box: Name, Category ▾ (last option "➕ Add new category…" → name input),
  Unit. Saving the box creates the item (and category if new) and selects it.
- Category — read-only text, shown from the selected item.
- Quantity — number, label shows the item's unit, e.g. "Quantity (kg)".
- Amount (€) — number.
- Note — text.
- Receipt — file input `accept="image/*,application/pdf"` with `capture` not
  forced (phone offers camera or gallery). Shows the chosen file name; a ✕ clears it.
- Save. On Edit the same form is filled in, the button reads "Update", plus Cancel;
  the receipt can be kept, replaced or removed.

**List** (below): month filter (default current month), expenses newest first
(date, then time). Row: date time · item · category · quantity+unit · €amount ·
📎 (if receipt, tap to open/download) · note (muted) · Edit / Delete.
Month total at the top of the list.

**Validation** (pure function in `lib.js`): item required, amount > 0,
quantity empty or > 0, date `YYYY-MM-DD` required, time `HH:MM` required.

## Receipts

- Images: drawn to a canvas scaled so the long side ≤ 1600 px, exported as JPEG
  quality 0.8. If the browser can't decode the file (e.g. HEIC on desktop), show
  "Can't read this image — please choose a JPEG or PDF."
- PDFs: must start with `%PDF`, raw size ≤ 700 KB.
- After processing, anything over 700 KB raw is refused with a clear message
  (stays under Firestore's 1 MB doc limit after base64).
- Expense + file are written in one batch; deleting an expense deletes its file
  in the same batch; removing a receipt on edit deletes the file doc and clears
  the `receipt*` fields.

## Settings

Two new collapsible cards, "Expense categories" and "Expense items", like
Flavours: rename inline; items can also change category and unit. Delete is
blocked (alert) when an expense uses it; deleting a category is also blocked
while an item belongs to it.

## Dashboard

Uses the existing window selector (this month / last month / this year / custom).

1. **Profit card** directly under the Revenue card:
   `Profit (<window label>): €X` (red when negative), with Revenue and Expenses
   lines underneath. Revenue = existing `revenueInWindow` (deliveries, deposits
   excluded, counted on delivery date — unchanged).
2. **Expenses by category** card: bar chart (`barChartSVG`) + table, sorted by
   amount descending, for the window.
3. **Monthly profit** card: bar chart of expenses per month in the window
   (`barChartSVG`; the existing chart helpers are additive/non-negative, so
   profit itself is not charted) plus a table month · revenue · expenses ·
   profit, profit red when negative.

## `lib.js` additions (unit-tested)
- `validateExpense(input)` → `{ ok, errors, data }`
- `expensesInWindow(expenses, startMk, endMk)` → total €
- `expensesByCategoryInWindow(expenses, startMk, endMk)` → `[{ categoryId, amount }]` sorted desc
- `profitSeries(deliveries, expenses, sizes, startMk, endMk)` → `[{ monthKey, revenue, expenses, profit }]`
- `scaleToFit(w, h, maxSide)` → `{ w, h }` for receipt image shrinking

## Backup
"Export all data (JSON)" adds `expenses`, `expenseItems`, `expenseCategories`
(not `expenseFiles`, consistent with recibo files not being exported).

## Testing
- Unit tests for every `lib.js` function above (`npm test`).
- Syntax-check every `<script>` block in `index.html` with `node --check`.
- Manual after deploy: add an expense with a phone photo receipt, open the
  receipt, edit it, delete it; check the Dashboard profit for the month.

## Out of scope
Who paid / settling up between admins, VAT handling, recurring expenses,
expense export to CSV.
