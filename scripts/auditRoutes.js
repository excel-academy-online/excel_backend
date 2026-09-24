#!/usr/bin/env node
/**
 * Prints every route with the auth middleware guarding it, and exits non-zero
 * if any route has none.
 *
 *   npm run audit:routes
 *
 * This exists because the original codebase shipped a verifyToken middleware
 * that was never actually attached to a route. A test that enumerates the
 * router stack is the only thing that catches that class of mistake.
 *
 * Routes that are deliberately reachable without an account must use
 * `optionalAuth` so the intent is explicit and this script stays green.
 */
const path = require("path");
const Module = require("module");

// Stub Firebase so the routers can be loaded without real credentials.
const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  credential: { cert: () => ({}) },
  firestore: () => ({}),
  storage: () => ({ bucket: () => ({}) }),
  auth: () => ({ verifyIdToken: async () => ({ uid: "u", role: "student" }) }),
};
const stubConfig = {
  apiKey: "stub",
  authDomain: "stub.firebaseapp.com",
  projectId: "stub-project",
  storageBucket: "stub.appspot.com",
  messagingSenderId: "1",
  appId: "1:1:web:1",
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.indexOf("firebaseadminvar") !== -1) {
    return {
      admin: adminStub,
      serviceAccount: { project_id: "stub-project" },
      firebaseConfig: stubConfig,
      db: {},
      auth: adminStub.auth(),
      bucket: {},
    };
  }
  if (request === "firebase-admin") return adminStub;
  return origLoad.call(this, request, parent, isMain);
};

for (const [k, v] of Object.entries(stubConfig)) process.env[k] = v;
process.env.key = "0".repeat(64);
process.env.iv = "0".repeat(32);

// Mount table, mirroring index.js.
const MOUNTS = [
  ["/api", "../routes/videos"],
  ["/api/auth", "../routes/user.routes"],
  ["/api/admin", "../routes/admin.routes"],
  ["/api/dashboard", "../routes/dashboard.routes"],
  ["/api/course", "../routes/course.routes"],
  ["/api/gamification", "../routes/gamification.routes"],
  ["/api/roles", "../routes/roles_modules.routes"],
  ["/api/community", "../routes/community.routes"],
  ["/api/advertisement", "../routes/advertisement.routes"],
  ["/api/students", "../routes/students.routes"],
  ["/api/announcements", "../routes/announcement.routes"],
  ["/api/payment", "../routes/purchase.routes"],
  ["/api/certificates", "../routes/cert.routes"],
  ["/api/chat", "../routes/chat.routes"],
];

const AUTH_NAMES = ["requireAuth", "requireRoleMiddleware", "requireSelfOrAdminMiddleware"];

/**
 * Endpoints that must be reachable with no credentials at all, because they
 * are how a caller obtains credentials in the first place. Anything not on
 * this list needs requireAuth, requireAdmin or an explicit optionalAuth.
 */
const ALLOW_ANONYMOUS = new Set([
  "POST /api/auth/register",
  "PATCH /api/auth/login",
  "POST /api/admin/login",
  // Authenticated by Paystack's HMAC signature rather than a user token.
  "POST /api/payment/webhook",
]);
const protectedRoutes = [];
const publicRoutes = [];
const unguarded = [];

for (const [prefix, modPath] of MOUNTS) {
  const router = require(path.join(__dirname, modPath));
  for (const layer of router.stack) {
    if (!layer.route) continue;

    const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
    const chain = layer.route.stack.map((h) => h.handle.name || "anonymous");
    const label = `${methods.join(",").padEnd(6)} ${prefix}${layer.route.path}`;

    if (chain.some((n) => AUTH_NAMES.includes(n))) {
      const admin = chain.includes("requireRoleMiddleware");
      protectedRoutes.push(`${admin ? "ADMIN " : "USER  "} ${label}`);
    } else if (chain.includes("optionalAuth")) {
      publicRoutes.push(`PUBLIC ${label}`);
    } else if (ALLOW_ANONYMOUS.has(`${methods.join(",")} ${prefix}${layer.route.path}`)) {
      publicRoutes.push(`ANON   ${label}`);
    } else {
      unguarded.push(`${label}   [${chain.join(" -> ")}]`);
    }
  }
}

const total = protectedRoutes.length + publicRoutes.length + unguarded.length;

console.log("=== Protected ===");
protectedRoutes.sort().forEach((r) => console.log("  " + r));
console.log("\n=== Deliberately public (optionalAuth) ===");
publicRoutes.sort().forEach((r) => console.log("  " + r));

if (unguarded.length) {
  console.log("\n=== UNGUARDED - no auth middleware ===");
  unguarded.forEach((r) => console.log("  " + r));
}

console.log(
  `\n${total} routes: ${protectedRoutes.length} protected, ` +
    `${publicRoutes.length} public, ${unguarded.length} unguarded.`
);

if (unguarded.length) {
  console.error("\nFAIL: every route must use requireAuth, requireAdmin or optionalAuth.");
  process.exit(1);
}
console.log("PASS");
