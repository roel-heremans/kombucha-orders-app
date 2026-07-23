# Toast Confirmation — Design Spec

Date: 2026-07-23
Status: design approved, implementation pending

## Problem

After an RV upload, the handler sets `#ruMsg` to "Uploaded ✓ — emailed …", but the
`recibos` Firestore snapshot immediately fires `APP.render()` (index.html:211),
which rebuilds the Recibo view and wipes `#ruMsg`. The confirmation flashes for a
split second and is unreadable — a problem now that the message reports whether
the restaurant was emailed.

## Solution

A small global **toast**: a fixed-position notification that lives outside the
re-rendered view containers (appended to `document.body`), so re-renders never
touch it. It shows the outcome for ~5 seconds then fades. Reusable via
`APP.toast(msg, isError)`.

## Components

- **CSS** (in the `<style>` block, before `</style>` at index.html:34): `.toast`,
  `.toast.show`, `.toast.error` rules. Success uses `var(--green)` (#4a7c59),
  error uses #c0392b (the existing error red). Bottom-center, fade + slide,
  `z-index:1000`, `pointer-events:none`, `max-width:90vw`.
- **`window.APP.toast(msg, isError)`** (after the `emailRecibo` block, ~index.html:342):
  lazily creates a single `#appToast` element on first call (with
  `role="status"` / `aria-live="polite"`), sets its text, shows it, and hides it
  after 5s via a debounced timer (`clearTimeout` any prior timer so rapid calls
  don't hide early).
- **Upload handler wiring** (index.html #ruUpload handler): call `A.toast(msg)`
  in the success branch (alongside the existing `#ruMsg` set), and
  `A.toast("Upload failed: " + (ex.code || ex.message), true)` in the `catch`.

## Testing

- `npm test` stays green at 73 (no lib change).
- Manual: upload an RV → a green toast "Uploaded ✓ — emailed …" appears bottom-center,
  stays readable ~5s through the list re-render, then fades. Upload for a name-login
  → green toast "…no email on file; send it manually." A failed upload → red toast.

## Out of scope

- Replacing other inline status messages across the app with toasts (future, if wanted).
- Any change to the email/upload logic itself.
