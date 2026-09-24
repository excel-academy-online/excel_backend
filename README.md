# Excel Academy - Backend API

Express API for the Excel Academy learning platform. Serves the `ExcelGroup`
Flutter app and is the intended API for the admin dashboard.

## Quick start

```bash
npm install
cp .env.example .env     # then fill it in - see below
npm run dev
```

The server refuses to start without a reachable MongoDB, by design: a process
that boots without its database looks healthy to the host and 500s every
request.

## Configuration

Every variable is documented in [`.env.example`](.env.example). The two that
must be set before anything works:

| Variable | Purpose |
| --- | --- |
| `Mongo_Uri` | MongoDB connection string. |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | Base64 of the Firebase service-account JSON. |

Generate the second with `base64 -w0 your-key.json`.

> **Never commit a service-account key.** `.gitignore` blocks the usual
> filenames. See [SECURITY-ROTATION.md](SECURITY-ROTATION.md) - the key that was
> previously committed to this repo still needs rotating.

## Authentication

Clients sign in with **Firebase Auth** and send the resulting ID token:

```
Authorization: Bearer <firebase id token>
```

The server verifies it with the Admin SDK. Roles come from Firebase custom
claims. To create the first administrator:

```bash
npm run set:role -- you@example.com admin
```

Full endpoint list and access levels: [API.md](API.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with nodemon. |
| `npm start` | Start for production. |
| `npm test` | Route-guard audit + auth enforcement tests. |
| `npm run audit:routes` | List every route and its required role; fails if any route is unguarded. |
| `npm run test:auth` | Boot the app and assert 401/403 behaviour over real HTTP. |
| `npm run docs` | Regenerate `API.md` from the router stack. |
| `npm run set:role -- <email> <role>` | Grant `student`, `instructor`, `admin` or `superadmin`. |

`npm test` is the guard against the original defect in this codebase: an auth
middleware that existed but was never attached to a route. Keep it passing.

## Layout

```
index.js            app wiring, security middleware, startup
firebaseadminvar.js Firebase Admin bootstrap (credentials from env)
middleware/auth.js  token verification + role guards
routes/             one router per domain; every route declares its access level
controllers/        request handlers
models/             Mongoose schemas
scripts/            operational tooling and tests
```

## Known issues

Outstanding problems, with reasoning, are recorded in [AUDIT.md](AUDIT.md).
The largest is that the app writes to both MongoDB and Firestore with no single
source of truth.
