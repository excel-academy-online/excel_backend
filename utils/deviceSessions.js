/**
 * One device per student account.
 *
 * deviceSessions/{uid} = { deviceId, deviceName, platform, claimedAt, lastSeen }
 *
 * - The app claims the account for its device right after signing in. A
 *   second phone is refused until the first one logs out (release).
 * - A device not seen for RELEASE_AFTER_DAYS is treated as gone, so a lost
 *   phone can't lock a student out for ever; staff can also release it.
 * - Every app request carries X-Device-Id; requireAuth rejects one from a
 *   device that doesn't hold the account. The holder is cached briefly so
 *   this costs no database read per request.
 * - Staff (admin/superadmin) are exempt: they use the app and dashboard together.
 */
const { db } = require("../firebaseadminvar");

const COLLECTION = "deviceSessions";
const RELEASE_AFTER_DAYS = 30;
const CACHE_MS = 60 * 1000;
const SEEN_EVERY_MS = 6 * 3600 * 1000; // refresh lastSeen at most this often

const cache = new Map(); // uid -> { at, session|null }

const ref = (uid) => db.collection(COLLECTION).doc(String(uid));
const expired = (s) => !s || Date.now() - Date.parse(s.lastSeen || s.claimedAt || 0) > RELEASE_AFTER_DAYS * 86400000;
const clean = (v, n) => String(v || "").trim().slice(0, n);

async function current(uid) {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.session;
  const snap = await ref(uid).get();
  const session = snap.exists ? snap.data() : null;
  cache.set(uid, { at: Date.now(), session });
  return session;
}

/**
 * Claims the account for this device. Returns { ok: true } or
 * { ok: false, deviceName, lastSeen } when another device holds it.
 */
async function claim(uid, deviceId, deviceName, platform) {
  deviceId = clean(deviceId, 100);
  if (!deviceId) return { ok: false, error: "missing device id" };
  const now = new Date().toISOString();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref(uid));
    const s = snap.exists ? snap.data() : null;
    if (s && s.deviceId !== deviceId && !expired(s)) {
      return { ok: false, deviceName: s.deviceName || "another device", lastSeen: s.lastSeen || s.claimedAt };
    }
    const session = {
      deviceId,
      deviceName: clean(deviceName, 80) || "a phone",
      platform: clean(platform, 20),
      claimedAt: s && s.deviceId === deviceId ? s.claimedAt : now,
      lastSeen: now,
    };
    tx.set(ref(uid), session);
    return { ok: true, session };
  });
  cache.set(uid, { at: Date.now(), session: result.ok ? result.session : (await ref(uid).get()).data() });
  return result.ok ? { ok: true } : result;
}

/** Frees the account if this device holds it (logging out). */
async function release(uid, deviceId) {
  const s = await current(uid);
  if (s && s.deviceId === clean(deviceId, 100)) await ref(uid).delete();
  cache.delete(uid);
}

/** Staff: sign the student out of their device so they can log in elsewhere. */
async function forceRelease(uid) {
  await ref(uid).delete();
  cache.delete(uid);
}

/**
 * True when this request's device may use the account. Requests without a
 * device id (dashboard, older app builds) are allowed; staff always are.
 */
async function allowed(uid, deviceId) {
  deviceId = clean(deviceId, 100);
  if (!deviceId) return true;
  const s = await current(uid);
  if (!s || expired(s)) return true;
  if (s.deviceId !== deviceId) return false;
  // Keep the holder "seen" so it isn't auto-released while in use.
  if (Date.now() - Date.parse(s.lastSeen || 0) > SEEN_EVERY_MS) {
    s.lastSeen = new Date().toISOString();
    ref(uid).set({ lastSeen: s.lastSeen }, { merge: true }).catch(() => {});
  }
  return true;
}

/** For the dashboard's student page. */
async function describe(uid) {
  const s = await current(uid);
  return s && !expired(s) ? { deviceName: s.deviceName, platform: s.platform, claimedAt: s.claimedAt, lastSeen: s.lastSeen } : null;
}

module.exports = { claim, release, forceRelease, allowed, describe, RELEASE_AFTER_DAYS };
