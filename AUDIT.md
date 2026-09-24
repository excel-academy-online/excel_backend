# Backend audit

Audit of `excel_backend` at commit `2e9e541`, plus what has been changed since.
Kept in the repo so the reasoning survives the handover.

## Who actually calls this API

Worth knowing before planning any work, because it is not what the folder
structure suggests.

| Client | Talks to this API? |
| --- | --- |
| `ExcelGroup` (Flutter) | **Yes** - 4 endpoints, via `https://video-streams.onrender.com/api` |
| `ExcelAcademy` (Flutter) | No - reads Firebase directly, plus the notification service |
| `excel_dashboard` (React) | No - reads Firebase directly; contains no HTTP client at all |

The only consumed endpoints are `GET /api/all-courses`,
`GET /api/get-course-details/:id`, `POST /api/payment/initialize-payment` and
`GET /api/payment/verify-payment/:ref`. The other ~98 routes have no caller in
any client in this workspace.

`ExcelGroup` also references `/api/payment/initialize-payment/successful`,
which **does not exist** on the server.

## Fixed

### Critical

1. **No authentication on any endpoint.** `middleware/verifytoken.js` was
   written but imported by zero routes, so admin registration, the full user
   list, account disabling and payment verification were all publicly callable.
   Replaced with `middleware/auth.js` (Firebase ID-token verification plus role
   guards) and applied across all 102 routes. `npm test` now fails if any route
   is left unguarded.

2. **Committed Firebase private key.** `serviceAccountKey.json` was tracked from
   the first commit. Now untracked and gitignored; credentials load from
   `FIREBASE_SERVICE_ACCOUNT_BASE64`. **The key itself still needs rotating** -
   see [SECURITY-ROTATION.md](SECURITY-ROTATION.md).

3. **Payment amount check could never pass.** `amount !== initialAmount`
   compared a JSON value that arrives as a string against a number. Now compared
   as integers in kobo. The same handler built the Paystack amount by
   concatenating `"00"`, which broke for any non-integer price.

4. **Duplicate-purchase check ran after the mutation.** Courses were appended to
   the user, and only then was the "already bought this" error raised. Reordered.

5. **Unawaited writes on the payment path.** `forEach(async ...)` meant
   subscriber records were saved without being awaited, so the response could
   return before they landed. Now `Promise.all`.

### High

6. **`UpdateUserDP` was permanently broken.** It called the *client* SDK's
   `getAuth().currentUser`, which is always `null` in a server process, so the
   handler always returned 403. Now uses the verified `req.uid`.

7. **Password hashes returned to clients** from `Login` and `FetchAllUsers`.

8. **`FetchUsersByGender` always threw** - it referenced `numOfStudent` and
   `fetchAllUsers`, neither of which exists in that function.

9. **Import-time crash.** `course.controller.js` ran
   `Buffer.from(process.env.key, "hex")` at module scope, so the entire server
   failed to start if `key`/`iv` were unset. Now resolved lazily and validated.

10. **Server started without a database.** `Db.config.js` swallowed connection
    failures, so the process reported healthy and 500'd every request.

### Medium

11. `helmet` was imported but commented out; now enabled.
12. The rate limiter was imported in `index.js` and never applied. Now applied
    globally, with a stricter limit on login, registration and payment. The old
    setting (4 requests / 20s) was too tight for normal browsing and has been
    relaxed to 120/min baseline.
13. `cors()` allowed every origin while the app used cookies. Now an allowlist
    via `CORS_ORIGINS`.
14. Unbounded request bodies; now capped at 1 MB.
15. Unknown routes returned `501 Not Implemented`; now `404`.
16. JWT had no expiry and the cookie lacked `secure`/`sameSite`.
17. Added `GET /health` for the platform health check.

### Fixed after the dashboard rebuild (2026-09-23)

Bugs the admin dashboard hit while wiring against the API, each now covered by
`npm run test:controllers`:

18. **`createMultipleGamificationQst` rejected every valid request.** It ran
    `JSON.parse()` on `req.body.questions`, which Express has already parsed
    into an array. It now only parses when a string was actually sent, so both
    JSON and multipart clients work.
19. **`AdminLogin` never enforced the admin flag.** It read `userData.admin`,
    returned it in the response, and logged the caller in regardless - so any
    student with a valid password could obtain an admin session cookie. It now
    checks the Firebase custom claim (falling back to the legacy Firestore flag
    for accounts created before roles existed) and returns 403 otherwise.
20. **The status toggles accepted only `activate`/`deactivate`.** They now also
    accept `active`/`inactive`, booleans and 1/0, still storing 1/0 so existing
    records keep working.
21. **`status: false` was rejected as missing** by a `!status` guard. Found by
    the new tests, not by reading the code.
22. **`gamification.controller.js` crashed the process at import** when `key`
    and `iv` were unset - the same fault already fixed in
    `course.controller.js`, which had been missed in the first pass.

## Still outstanding

### 1. Two databases, no source of truth  (largest remaining item)

Users, courses and payments live in MongoDB via Mongoose. Courses,
gamification, community, certificates and announcements live in Firestore.
`course.controller.js` writes to both.

| Controller | Mongoose models | Firestore calls |
| --- | --- | --- |
| course | 2 | 25 |
| gamification | 2 | 16 |
| community | 1 | 10 |
| cert | 0 | 7 |
| purchaseCourse | 2 | 0 |

So a purchase appends a course id to the Mongo `user.courses` array while the
lesson content the student needs lives in Firestore. These will drift.

Because every client already reads Firestore directly, consolidating onto
Firestore is likely the cheaper direction - but it is a real migration and
should be scoped and priced separately.

### 2. The client SDK is still used for Firestore access

Controllers import `firebase/firestore` (the browser SDK) rather than
`firebase-admin`. Server-side this has no auth context, so writes are subject to
security rules that do not grant it anything. `firebaseadminvar.js` now exports
a ready `db` handle; controllers should migrate to it.

Note that `firebase/firestore.rules` in the `ExcelAcademy` repo defines no rules
at all for `courses`, `gamification`, `community`, `announcements` or
`certificates`, which means they are denied by default. If those writes work in
production, the deployed rules differ from the ones in the repo - worth
checking, because wide-open rules would be a second data-exposure problem.

### 3. Ownership checks inside controllers

Routes now enforce *authentication* and *role*, but several handlers still take
the acting user's id from the request body rather than from `req.uid`.
`community.deleteComment` and `editComment` are the clearest cases: any
signed-in user can pass another user's id. These need per-record ownership
checks in the controller.

### 4. Two parallel auth systems

`user.controller.Login` still issues its own bcrypt+JWT session, unused by any
client. It should be removed once confirmed dead, so there is one way in.

### 5. Smaller items

- `utils/fetchVideoFromFirebase.js` does `const bucket = require("./firebase.config")`,
  but that module exports a plain config object, not a bucket.
- `utils/encryptVideo.js` has a syntax oddity: `Buffer.from(key, )`.
- Env var names are inconsistent: `firebaseadminvar.js` uses `FIREBASE_API_KEY`
  while `utils/firebase.config.js` uses `apiKey` for the same value.
- `controllers/roles_modules_privileges.routes.js` is a controller with
  `.routes.js` in its name.
- `dashboard.conttroller.js` is misspelled.
- `xss-clean` is unmaintained; `multer@1.x` has advisories.
- `b_backend/backend-code/video-streaming` is a stale copy of this codebase and
  should be deleted to stop edits landing in the wrong place.
- The `merged/` repo is empty.

### 6. Deployment note

`index.js` previously ended with `exports.app = functions.https.onRequest(app)`
(Firebase Functions) *and* called `app.listen()` (a normal server). The app is
deployed on Render, so the Functions export has been removed. If a Functions
deployment is actually wanted, that needs to be a deliberate choice - the two
models do not mix.
