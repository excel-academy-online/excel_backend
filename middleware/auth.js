/**
 * Authentication and authorisation middleware.
 *
 * Every client (the Flutter apps and the React dashboard) signs in with
 * Firebase Auth, so the server's job is to verify the Firebase ID token the
 * client already holds - not to run a second login system of its own.
 *
 * Roles are read from Firebase custom claims. Grant one with:
 *   node scripts/setRole.js <email> admin
 *
 * Each middleware is a *named* function so that it shows up in stack traces
 * and so the route audit in scripts/auditRoutes.js can see it.
 */
const { auth } = require("../firebaseadminvar");
const AppError = require("../utils/errors/AppError");

const ADMIN_ROLES = ["admin", "superadmin"];

/**
 * Pull the ID token from an `Authorization: Bearer <token>` header, falling
 * back to the `access_token` cookie for browser clients.
 */
function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  if (req.cookies && req.cookies.access_token) {
    return req.cookies.access_token;
  }
  return null;
}

function applyClaims(req, decoded) {
  req.user = decoded;
  req.uid = decoded.uid;
  req.role = decoded.role || "student";
}

// checkRevoked: true so that disabling a user or revoking their refresh tokens
// takes effect immediately rather than at their next hourly token refresh.
function verify(token) {
  return auth.verifyIdToken(token, true);
}

/** Rejects the request unless it carries a valid Firebase ID token. */
async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return next(new AppError("Authentication required", 401));
  }

  try {
    applyClaims(req, await verify(token));
  } catch (err) {
    if (err.code === "auth/id-token-expired") {
      return next(new AppError("Session expired, please sign in again", 401));
    }
    if (err.code === "auth/id-token-revoked") {
      return next(new AppError("Session revoked, please sign in again", 401));
    }
    return next(new AppError("Invalid authentication token", 401));
  }
  next();
}

/**
 * Attaches req.user when a token is present but does not reject anonymous
 * callers. For endpoints that must stay reachable without an account.
 */
async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    applyClaims(req, await verify(token));
  } catch {
    // An unreadable token on an optional route is treated as anonymous.
  }
  next();
}

/**
 * Restricts a route to the given roles. Must run after requireAuth.
 *   router.post("/x", requireAuth, requireRole("admin"), handler)
 */
function requireRole(...roles) {
  return function requireRoleMiddleware(req, res, next) {
    if (!req.user) {
      return next(new AppError("Authentication required", 401));
    }
    if (!roles.includes(req.role)) {
      return next(
        new AppError("You do not have permission to perform this action", 403)
      );
    }
    next();
  };
}

/**
 * Confirms the caller is acting on their own record, unless they are an admin.
 * Reads the subject id from the named route param, body field or query field.
 */
function requireSelfOrAdmin(field = "user_id") {
  return function requireSelfOrAdminMiddleware(req, res, next) {
    if (!req.user) {
      return next(new AppError("Authentication required", 401));
    }
    if (ADMIN_ROLES.includes(req.role)) return next();

    const target =
      (req.params && req.params[field]) ||
      (req.body && req.body[field]) ||
      (req.query && req.query[field]);

    if (target && target !== req.uid) {
      return next(new AppError("You can only act on your own account", 403));
    }
    next();
  };
}

const requireAdmin = [requireAuth, requireRole(...ADMIN_ROLES)];

module.exports = {
  requireAuth,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireSelfOrAdmin,
  ADMIN_ROLES,
};
