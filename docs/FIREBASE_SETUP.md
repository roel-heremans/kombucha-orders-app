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
