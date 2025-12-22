# Firestore rules setup (required for sync)

If you see `Missing or insufficient permissions`, your Firebase project's Firestore Security Rules are blocking reads/writes.

This repo includes a development rule set:

- `firestore.rules`

## Apply in Firebase Console

1. Open Firebase Console → your project → **Firestore Database** → **Rules**
2. Replace rules with the contents of `firestore.rules`
3. Publish

## OAuth warning on localhost/127.0.0.1

If you see a console warning like “current domain is not authorized for OAuth operations”, add your dev domain:

Firebase Console → **Authentication** → **Settings** → **Authorized domains** → add `127.0.0.1` (and/or `localhost`).

This warning does not affect anonymous auth + Firestore sync, but it will affect popup/redirect OAuth flows.

## Important security note

`firestore.rules` is **permissive** (any authenticated user, including anonymous auth, can read/write under `users/{vaultId}`).
This is acceptable for local/dev testing but **not** safe for production.

To make this production-safe you need a backend that issues custom auth claims (or a different auth model) so rules can enforce that only the correct user/device can access a vault.
