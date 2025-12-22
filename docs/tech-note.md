# Tech Note

## What Changed
- Hardened admin model with role checks, ADM username enforcement, and admin invite codes for protected admin creation.
- Added input validation for usernames and PINs, plus recovery file flow fixes.
- Added admin invite management UI and hid admin entry points for non-admin users.
- Removed the document conversion server and UI (feature cleanup).

## How To Create/Grant An Admin Account
1. Sign in to an existing admin vault (username must start with `ADM`).
2. Open the Admin Console and generate an Admin Invite code.
3. Share the invite code out-of-band with the new admin user.
4. During registration, the new admin must use an `ADM...` username and the invite code.

If there is no existing admin, create one as an offline setup step by:
1. Create a vault with an `ADM...` username.
2. Use Developer Tools to insert a valid admin invite in IndexedDB meta under `admin_invite`,
   then re-run registration with the invite code.

## How RBAC Works
- Roles are stored in vault metadata (`role: admin|user`).
- Admin access requires both role `admin` and a username matching `^ADM[\\w-]+`.
- Admin UI and actions are blocked unless `vaultService.isAdmin()` passes.

## Responsive Test Checklist
- 360x800, 390x844, 412x915, 430x932 (Samsung S24 Ultra range)
- 768x1024 (tablet)
- 1024x1366 (large tablet)
- 1280x800, 1440x900 (laptop)
- Validate: no horizontal scroll, modals fit, buttons >= 44px, admin panel usable, footer menu accessible.
