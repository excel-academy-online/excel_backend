#!/usr/bin/env node
/**
 * Grant or clear a role on a Firebase user.
 *
 *   node scripts/setRole.js <email> admin
 *   node scripts/setRole.js <email> student
 *
 * The role lands in the user's custom claims and is picked up by
 * middleware/auth.js on their next token refresh (within an hour, or
 * immediately if the client calls getIdToken(true)).
 */
require("dotenv").config();
const { auth } = require("../firebaseadminvar");

const VALID_ROLES = ["student", "instructor", "admin", "superadmin"];

async function main() {
  const [email, role] = process.argv.slice(2);

  if (!email || !role) {
    console.error("Usage: node scripts/setRole.js <email> <role>");
    console.error(`Roles: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid role "${role}". Use one of: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { role });
  // Force a token refresh so the new role applies right away.
  await auth.revokeRefreshTokens(user.uid);

  console.log(`Set role "${role}" on ${email} (uid ${user.uid}).`);
  console.log("Their existing sessions were revoked; they must sign in again.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
