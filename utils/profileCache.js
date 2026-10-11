/**
 * Student names and photos for community chats, member lists and the
 * leaderboard.
 *
 * These used to read the whole `users` collection every few minutes, which
 * grows with every sign-up and would use up Firestore's free daily reads.
 * Now only the people actually being shown are read, and each one is
 * remembered for 15 minutes. `refresh(uid)` re-reads someone straight away
 * (e.g. when they post, so a new name or photo shows at once).
 */
const { db } = require("../firebaseadminvar");

const TTL_MS = 15 * 60 * 1000;
const cache = new Map(); // uid -> { at, data }

/** uid -> the user's profile document data ({} when there is none). */
async function profiles(ids = []) {
  const now = Date.now();
  const want = [...new Set(ids.filter(Boolean).map(String))];
  const stale = want.filter((id) => {
    const hit = cache.get(id);
    return !hit || now - hit.at > TTL_MS;
  });
  for (let i = 0; i < stale.length; i += 100) {
    const docs = await db.getAll(...stale.slice(i, i + 100).map((id) => db.collection("users").doc(id)));
    docs.forEach((d) => cache.set(d.id, { at: now, data: d.exists ? d.data() : {} }));
  }
  const out = {};
  for (const id of want) out[id] = (cache.get(id) || {}).data || {};
  return out;
}

async function refresh(uid) {
  if (!uid) return;
  cache.delete(String(uid));
  await profiles([uid]);
}

module.exports = { profiles, refresh };
