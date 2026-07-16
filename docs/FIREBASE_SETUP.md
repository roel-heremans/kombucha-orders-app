# Firebase setup (one-time)

1. Go to https://console.firebase.google.com and create a project (free Spark plan).
2. **Authentication** → Get started → enable **Email/Password**. Under Users, add two
   accounts (you and your wife) with email + password.
3. **Firestore Database** → Create database → start in production mode → pick a region
   (e.g. `europe-west`).
4. **Rules**: paste the contents of `firestore.rules`, replacing the two placeholder
   emails with your two account emails, then Publish.
5. **Project settings** (gear icon) → *Your apps* → **Web app** (`</>`). Register the
   app. Copy the `firebaseConfig` values.
6. In `index.html`, replace the `FIREBASE_CONFIG` object's `TODO` values with those
   values. Commit and push.
7. Open the GitHub Pages URL, log in with one of the accounts, and you're live.

Firebase web config values are safe to commit — access is controlled by the rules,
not by hiding the config.

## Restaurant logins

**Email/Password authentication now serves two roles:** admins (the two allowlisted emails in `firestore.rules`) and restaurants (any other authenticated user).

**Security rules enforce the split:**
- Admins (allowlisted emails) have full access to all data: customers, deliveries, orders, revenue, and settings.
- A restaurant user (non-allowlisted email) can only:
  - Create and read their own orders (matching their `uid`).
  - Cancel their own orders while they are still in "Requested" status.
  - Read flavours and settings (needed to display the order form).
  - Read their own customer document.
  - Cannot access other customers' data, deliveries, orders, revenue, or any admin features.

**To create a restaurant login (in-app):**
1. Log in as an admin.
2. Go to **Settings → Restaurant logins**.
3. Pick the customer from the dropdown.
4. Enter an email address and initial password (6+ characters).
5. Tap **Create login**.

This creates a new Firebase Auth user (using a secondary app instance so you stay logged in) and links it to the customer by writing the user's `uid` and `email` onto the customer document in Firestore. Hand the restaurant their email and password to log in.

**Console fallback (if in-app creation fails):**
1. In the [Firebase Console](https://console.firebase.google.com) → **Authentication** → **Users**, manually add a new user with email and password.
2. Copy the new user's **UID** (shown in the Users list).
3. In **Firestore** → **customers** collection, open the restaurant's customer document and add (or update):
   - `uid` field: paste the UID.
   - `email` field: paste the email address.
4. The restaurant can now log in with that email and password. The app matches them to their customer by `uid`.
