# Recibo Verde PDF Distribution — Design Spec (Project B)

Date: 2026-07-16
Status: design complete, implementation pending

## Goal

Let admins (Roel + Nina) upload a restaurant's monthly **Recibo Verde** PDF, and
let that restaurant download / print their own RVs after logging in. Backlog
items B1 (admin upload) and B2 (restaurant download).

Stays on the free Firebase **Spark** plan — no Blaze, no billing card. PDF bytes
are stored base64 in Firestore.

## Storage model (Firestore, no Cloud Storage)

Two collections, split so the list stays lightweight and each doc respects
Firestore's 1 MB limit:

### `recibos` — metadata (listed)

Doc id: **`<customerId>_<monthKey>`** (e.g. `abc123_2026-07`). Deterministic id
gives "one per month + replace on re-upload" for free.

| field         | type      | notes                                    |
| ------------- | --------- | ---------------------------------------- |
| `customerId`  | string    | customers doc id                         |
| `customerUid` | string    | the restaurant login's auth uid          |
| `monthKey`    | string    | `"YYYY-MM"`                              |
| `fileName`    | string    | original file name (display only)        |
| `size`        | number    | raw file size in bytes                   |
| `uploadedAt`  | timestamp | server timestamp                         |
| `uploadedBy`  | string    | admin email                              |

### `reciboFiles` — the bytes (fetched on demand)

Doc id: **same** `<customerId>_<monthKey>`.

| field         | type   | notes                                          |
| ------------- | ------ | ---------------------------------------------- |
| `customerUid` | string | duplicated so the security rule can check it   |
| `data`        | string | base64 of the PDF (no `data:` prefix)          |
| `contentType` | string | `"application/pdf"`                            |

The restaurant list subscribes only to `recibos` (small). `reciboFiles` is read
via a one-off `getDoc` only when a download is requested.

### Size limit

A Firestore doc caps at 1,048,576 bytes; base64 inflates by ~4/3. Cap the raw
PDF at **700 KB** (`700 * 1024 = 716800` bytes). Upload validates
`file.size <= 716800` and rejects larger files with: *"PDF too large (max 700
KB). Please shrink it and try again."* Also validate the file is a PDF
(`file.type === "application/pdf"` or name ends in `.pdf`).

## Admin flow — in the Recibo view

The Recibo view already lets the admin pick a **customer + month** and generate
the RV description text. Add below it an **Upload RV PDF** card that reuses the
currently selected customer + month:

1. A file input (`accept="application/pdf"`) and an **Upload** button.
2. **Precondition:** the selected customer must have an app login
   (`customer.uid` set). If not, show: *"This customer has no app login yet —
   create one in Settings → Restaurant logins."* and disable upload.
3. On upload: validate type + size; read the file as base64
   (`FileReader.readAsArrayBuffer` → base64, or `readAsDataURL` and strip the
   prefix); write both docs with a batch `setDoc` on id `<customerId>_<monthKey>`
   (metadata → `recibos`, bytes → `reciboFiles`). Show "Uploaded ✓".
4. Below the uploader, list the **uploaded RVs for the selected customer**
   (query `recibos` where `customerId == selected`, month desc), each with its
   month + file name and a **Delete** button (batch-delete both docs).

Uploading again for the same customer+month overwrites both docs (replace).

## Restaurant flow — new "My Recibos" section

In the restaurant view (below "Your orders"), add a **My Recibos** card:

- Subscribes to `recibos` where `customerUid == myUid`, sorted by `monthKey`
  desc. Each row shows the month (`KO.windowLabel(mk, mk)` or `monthName`) and
  file name with a **Download / Print** button.
- On tap: `getDoc(reciboFiles/<id>)` → decode base64 → build a
  `Blob([bytes], { type: "application/pdf" })` → `URL.createObjectURL` →
  `window.open(url)` in a new tab (view + print/share). Revoke the object URL
  after a short delay.
- Empty state: *"No recibos yet."*

## Security rules

Add to `firestore.rules` (restaurant reads only its own; admin writes):

```
match /recibos/{id} {
  allow read: if isAdmin() ||
    (signedIn() && resource.data.customerUid == request.auth.uid);
  allow write: if isAdmin();
}
match /reciboFiles/{id} {
  allow read: if isAdmin() ||
    (signedIn() && resource.data.customerUid == request.auth.uid);
  allow write: if isAdmin();
}
```

`isAdmin()` / `signedIn()` already exist. Requires a **rules redeploy** (manual
in the Firebase console, with playground checks — same process as the ordering
feature). Restaurant users can read only rows whose `customerUid` matches their
uid; they cannot write. The restaurant list query must filter by
`where("customerUid", "==", uid)` (a bare collection read would be denied).

## Data-layer wiring

- **Admin** (`onLogin`): add `watch("recibos", S.recibos)` so the Recibo view can
  list uploads. (`reciboFiles` is never listed — only `getDoc` on download, and
  admins can read it via rules.)
- **Restaurant** (`onRestaurantLogin`): add a filtered `onSnapshot` on `recibos`
  where `customerUid == uid` into `S.recibos`.
- New helpers on `A`: `uploadRecibo(customerId, customerUid, monthKey, fileName,
  size, base64)`, `deleteRecibo(id)`, `fetchReciboFile(id)` (returns the bytes
  doc). Use `writeBatch` for the two-doc upload/delete.

## Testing

- `lib.js`: a couple of small pure helpers get unit tests — e.g. a
  `reciboDocId(customerId, monthKey)` id builder and a base64↔bytes helper if one
  is added there; keep byte/DOM work in the view. (Most of this feature is
  Firebase + DOM glue, verified manually.)
- Manual end-to-end (real Firebase, after rules redeploy): as admin, upload a
  small PDF for a restaurant + month → appears in the admin list; re-upload
  replaces it; delete removes it. As that restaurant (incognito), the RV appears
  in My Recibos and Download/Print opens the PDF. Verify a >700 KB file is
  rejected, and a non-PDF is rejected. Verify a second restaurant cannot see the
  first's recibos (rules).

## Rollout / setup impact

- `firestore.rules` redeployed with the two new matches (manual, with playground
  checks provided at implementation time).
- No Firebase plan change (stays on Spark). No Cloud Storage.
- Base64 PDFs count toward Firestore storage/bandwidth (free tier: 1 GiB stored,
  10 GiB/month egress) — ample for a few small monthly PDFs.

## Out of scope

- Cloud Storage / Blaze (explicitly avoided by the storage decision).
- Generating the RV PDF in-app (admin produces it externally from Finanças and
  uploads the finished file).
- Emailing RVs to restaurants (they download in-app).
- Multiple files per month (one-per-month replace was chosen).
