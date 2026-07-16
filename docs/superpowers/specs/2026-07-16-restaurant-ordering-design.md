# Restaurant Ordering — Design Spec

Date: 2026-07-16
Status: design complete, implementation pending

## Goal

Let restaurant customers (e.g. "Sun Spot Cafe") place a kombucha order request
from their own phone. Roel and Nina see the request in their admin app, prepare
and deliver it, then mark it delivered — which creates a normal delivery record
(feeding the existing revenue / recibo / dashboard logic) and captures the
empties returned.

This adds a **role-based split** to what is currently a single-role app: an
**admin** side (Roel + Nina, full access) and a **restaurant** side (order form
+ that restaurant's own order history only).

## Non-goals (v1)

- Email / WhatsApp notifications. Orders appear as an in-app "Pending" list/badge
  for admins. External alerts are a deliberate later phase.
- Restaurants seeing revenue, deposits, other customers, or their bottle balance.
  (Restaurant view is: place order + own order history only.)
- Payment / invoicing changes. Recibo generation is unchanged.
- Self-service restaurant sign-up. Admins create restaurant logins.

## Approach

**One app, two faces.** Keep the single `index.html` (vanilla JS, no build step,
GitHub Pages, no backend). On login, branch on role:

- **Admin** (email in the allowlist) → the existing app, plus a new **Orders**
  tab showing pending/all orders.
- **Restaurant** (any other authenticated user) → a stripped-down view: a
  **New order** button and a list of their own orders with status.

Orders live in a new `orders` collection and are treated as a **thin layer that
feeds a delivery**. Marking an order delivered creates a standard `deliveries`
document, so all existing delivery/revenue/recibo/dashboard code keeps working
untouched.

Rejected alternative: a separate `order.html` for restaurants. Cleaner code
separation but duplicates the Firebase wiring and gives two entry points to
maintain. Not worth it for this size of app.

## Roles & authentication

- **Admins**: Roel and Nina, identified by email allowlist (existing pattern in
  `firestore.rules` and reused in the client to pick the view).
- **Restaurants**: standard Firebase Email/Password users, created by an admin.

### Creating a restaurant login (no backend)

From a new admin **"Restaurant logins"** area in the **Settings** view, the
admin picks/creates a customer, enters an email + initial password, and the
app creates the auth user using a **secondary Firebase app instance** in the
browser:

```
const secondary = initializeApp(FIREBASE_CONFIG, "admin-create");
const cred = await createUserWithEmailAndPassword(getAuth(secondary), email, pw);
// store cred.user.uid on the customer doc, then:
await signOut(getAuth(secondary));
```

Using a secondary instance avoids logging the admin out (the default
`createUserWithEmailAndPassword` on the primary auth would switch the session to
the new user). The customer document is then updated with `uid` and `email`.

**Fallback** (documented in FIREBASE_SETUP.md): if in-app creation is ever
problematic, the admin creates the user once in the Firebase Console, then types
that email into the app to link it to a customer (the app looks up / stores the
uid on first login instead — see "Linking" below).

### Linking restaurant user → customer

A restaurant user is tied to a customer via `customer.uid`. Rules and the
restaurant view resolve "who am I" by matching `request.auth.uid` to the
customer whose `uid` field equals it.

## Data model

### `orders` (new collection)

| field          | type      | notes                                              |
| -------------- | --------- | -------------------------------------------------- |
| `customerId`   | string    | doc id in `customers`                              |
| `customerUid`  | string    | auth uid of the restaurant (for security rules)    |
| `items`        | array     | `{ sizeId, flavourId, quantity }` — same shape as delivery items |
| `preferredDate`| string    | `YYYY-MM-DD`, optional                             |
| `note`         | string    | free text, optional                                |
| `status`       | string    | `requested` \| `delivered` \| `cancelled`          |
| `createdAt`    | timestamp | server timestamp                                   |
| `deliveryId`   | string    | set when fulfilled; links to the created delivery  |

Order `items` intentionally reuse the delivery item shape (`sizeId`,
`flavourId`, `quantity`) so fulfilment can pre-fill the delivery form directly.

### `customers` (existing, extended)

Add optional `uid` (auth uid of the linked restaurant user) and `email`. Absent
for private / non-app customers. Existing fields (`name`, `type`, `nif`,
`notes`) are unchanged.

### `deliveries`, `settings`, `flavours`

Unchanged. A fulfilled order produces a normal `deliveries` document via the
existing `addDelivery` path.

## Security rules

Grow `firestore.rules` from "two emails, full access" to a role model.

```
function isAdmin() {
  return request.auth != null &&
    request.auth.token.email in ["roel.heremans@gmail.com", "reissnina@gmail.com"];
}
function signedIn() { return request.auth != null; }

// Reference data the restaurant order form needs to render:
match /flavours/{id}  { allow read: if signedIn(); allow write: if isAdmin(); }
match /settings/{id}  { allow read: if signedIn(); allow write: if isAdmin(); }

// Customers: admin full; a restaurant may read only its own linked doc.
match /customers/{id} {
  allow read:  if isAdmin() || (signedIn() && resource.data.uid == request.auth.uid);
  allow write: if isAdmin();
}

// Deliveries & everything revenue-related: admin only.
match /deliveries/{id} { allow read, write: if isAdmin(); }

// Orders: admin full; restaurant may create + read + cancel ONLY its own.
match /orders/{id} {
  allow read:   if isAdmin() || (signedIn() && resource.data.customerUid == request.auth.uid);
  allow create: if isAdmin() ||
    (signedIn() && request.resource.data.customerUid == request.auth.uid
                && request.resource.data.status == "requested");
  // Restaurant may only cancel its own still-requested order; admin may do anything.
  allow update: if isAdmin() ||
    (signedIn() && resource.data.customerUid == request.auth.uid
                && resource.data.status == "requested"
                && request.resource.data.status == "cancelled");
  allow delete: if isAdmin();
}
```

Net effect: a restaurant user can render the order form (reads `flavours` +
`settings`), see its own customer doc and its own orders, place orders, and
cancel its own requested orders — and can read nothing about other customers,
deliveries, or revenue.

## User flows

### Restaurant

1. Log in with the email/password the admin gave them.
2. App detects: authenticated but not an admin → **restaurant view**, and finds
   the customer whose `uid` matches.
3. **New order**: add line items (size + flavour + quantity), optional preferred
   date, optional note → **Send order**. Writes an `orders` doc with
   `status: "requested"`, `customerUid`, `customerId`.
4. **My orders**: list of their orders, newest first, each showing date, a
   summary (e.g. `8x 1L`), and status (⏳ Requested / ✅ Delivered / ✖ Cancelled).
   A still-**Requested** order has a **Cancel** button (sets `status:"cancelled"`).

### Admin

1. Log in (allowlisted email) → existing app plus a new **Orders** tab.
2. **Orders tab** lists orders, pending first, with a badge count of `requested`
   orders on the tab. Each shows customer, requested items, preferred date, note.
3. **Fulfil**: opens the existing **New delivery** form **pre-filled** from the
   order — customer, and item rows (size + flavour + quantity). Admin adjusts
   actual quantities/flavours, enters empties received, saves.
4. On save, the normal delivery is created **and** the order is updated:
   `status: "delivered"`, `deliveryId` = new delivery's id. It leaves the pending
   list; the tab badge decrements.
5. **Restaurant logins** section in the **Settings** view: create a login (email
   + password) for a customer and link it (stores `uid` + `email` on the
   customer). Lists which customers have logins.

## App structure / implementation notes

- **View routing** (`onAuthStateChanged`): determine role. Admin → show `appView`
  + admin nav (unchanged) plus Orders tab. Restaurant → hide admin nav/tabs, show
  a new restaurant container; subscribe only to what rules allow (`flavours`,
  `settings`, own `customer`, own `orders`).
- **Admin data layer** (`onLogin`): add `watch("orders", S.orders)` alongside the
  existing collections. New CRUD helpers: `addOrder`, `updateOrderStatus`,
  `fulfilOrder` (creates delivery, then sets order delivered + deliveryId).
- **Fulfil pre-fill**: reuse the existing delivery-form build path, passing the
  order's `items` as the initial rows and its `customerId` as the selected
  customer. Add an entry point (`A.fulfilOrder(orderId)` → switch to New tab with
  prefill + remember which order is being fulfilled so save can mark it).
- **Restaurant view** is a new self-contained section (its own render function),
  kept separate from the admin views so admin code stays unchanged. It reuses
  `lib.js` helpers (sizes, flavour names, item summaries) where useful.
- **Account creation** uses the secondary-app instance pattern above; keep it in
  its own small function so it's isolated and testable.

## Testing

- `lib.js` gains any pure helpers used by orders (e.g. an order-items summary
  string, order status label) with unit tests in `test/`, matching the existing
  test style.
- Security rules: verify (via the Firebase rules simulator or emulator, and
  documented manual checks) that a restaurant user cannot read another
  customer's orders, cannot read deliveries, and cannot mark an order delivered.
- Manual end-to-end: create a restaurant login → log in as them on a second
  device/incognito → place an order → confirm it appears in admin Orders →
  fulfil → confirm delivery + revenue update and order shows Delivered → confirm
  cancel works while Requested.

## Rollout / setup impact

- `firestore.rules` must be redeployed with the new role model.
- No Firebase plan change (stays on the free Spark plan; no backend).
- FIREBASE_SETUP.md gains: how restaurant logins are created (in-app + console
  fallback), and a note that Email/Password auth now serves both admins and
  restaurants.

## Future (explicitly deferred)

- Email / WhatsApp notifications on new orders (client-side EmailJS, or a Cloud
  Function on the Blaze plan).
- Restaurant-visible bottle balance / empties owed.
- Restaurant editing an order (v1: cancel + re-order instead of edit).
