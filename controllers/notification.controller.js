/**
 * In-app notifications and phone push, in one place.
 *
 * This replaces the separate Cloud Run notification service (which ran in an
 * account we can't deploy to) and the Firestore collection the app used to
 * read directly but nothing ever wrote to.
 *
 *   notifications/{uid}/items/{id}  { title, body, type, data, read, createdAt }
 *   broadcasts/{id}                 { title, body, type, data, createdAt }   (everyone)
 *   studentProfiles/{uid}           { fcmTokens: [..], notificationsSeenAt }
 *
 * type is what the app's tabs filter on: "activities", "account" or "news".
 *
 * Other controllers call `notify(uid, …)` and `broadcast(…)`. Both are
 * best-effort: a failed push never fails the action that triggered it.
 */
const { db, admin } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const TYPES = ["activities", "account", "news"];
const TOPIC_ALL = "all";
const LIST_LIMIT = 50;
const MAX_TOKENS = 10;

const now = () => new Date().toISOString();
const profile = (uid) => db.collection("studentProfiles").doc(uid);
const itemsOf = (uid) => db.collection("notifications").doc(uid).collection("items");

const clean = (n) => ({
  title: String(n.title || "").slice(0, 120),
  body: String(n.body || "").slice(0, 1000),
  type: TYPES.includes(n.type) ? n.type : "activities",
  // FCM data values must be strings.
  data: Object.fromEntries(Object.entries(n.data || {}).map(([k, v]) => [k, String(v)])),
});

let messagingOverride = null;
const messaging = () => messagingOverride || admin.messaging();

/** Sends a push to [uid]'s devices and forgets tokens that no longer work. */
async function pushToUser(uid, n) {
  const snap = await profile(uid).get();
  const tokens = (snap.exists && snap.data().fcmTokens) || [];
  if (!tokens.length) return 0;
  const res = await messaging().sendEachForMulticast({
    tokens,
    notification: { title: n.title, body: n.body },
    data: { ...n.data, type: n.type },
    android: { priority: "high", notification: { channelId: "high_importance_channel" } },
  });
  const dead = res.responses
    .map((r, i) => (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test((r.error && r.error.code) || "") ? tokens[i] : null))
    .filter(Boolean);
  if (dead.length) {
    await profile(uid).set({ fcmTokens: tokens.filter((t) => !dead.includes(t)) }, { merge: true });
  }
  return res.successCount;
}

/** Records a notification for one student and pushes it to their phone. */
async function notify(uid, n) {
  if (!uid) return null;
  const item = { ...clean(n), read: false, createdAt: now() };
  try {
    const ref = await itemsOf(uid).add(item);
    await pushToUser(uid, item).catch((e) => console.error("Push failed for", uid, e.message));
    return ref.id;
  } catch (err) {
    console.error("Notification failed for", uid, err.message);
    return null;
  }
}

/** Records a notification for everyone and pushes it to the "all" topic. */
async function broadcast(n) {
  const item = { ...clean({ type: "news", ...n }), createdAt: now() };
  try {
    const ref = await db.collection("broadcasts").add(item);
    await messaging()
      .send({ topic: TOPIC_ALL, notification: { title: item.title, body: item.body }, data: { ...item.data, type: item.type } })
      .catch((e) => console.error("Broadcast push failed:", e.message));
    return ref.id;
  } catch (err) {
    console.error("Broadcast failed:", err.message);
    return null;
  }
}

exports.notify = notify;
exports.broadcast = broadcast;
exports._setMessaging = (m) => { messagingOverride = m; };

/* ------------------------------------------------------------ student */

/** POST /api/notifications/token { token } - this phone can receive pushes. */
exports.RegisterToken = catchAsync(async (req, res) => {
  const token = String((req.body || {}).token || "").trim();
  if (!token || token.length > 4096) throw new AppError("A device token is required", 400);
  const ref = profile(req.uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const tokens = ((snap.exists && snap.data().fcmTokens) || []).filter((t) => t !== token);
    // Newest last; keep the most recent few devices.
    tx.set(ref, { fcmTokens: [...tokens, token].slice(-MAX_TOKENS) }, { merge: true });
  });
  res.status(200).json({ status: "ok", message: "Device registered", data: {} });
});

/** DELETE /api/notifications/token { token } - on sign-out. */
exports.RemoveToken = catchAsync(async (req, res) => {
  const token = String((req.body || {}).token || "").trim();
  const ref = profile(req.uid);
  const snap = await ref.get();
  const tokens = (snap.exists && snap.data().fcmTokens) || [];
  await ref.set({ fcmTokens: tokens.filter((t) => t !== token) }, { merge: true });
  res.status(200).json({ status: "ok", message: "Device removed", data: {} });
});

/**
 * GET /api/notifications - the student's own notifications plus broadcasts,
 * newest first, with an unread count.
 */
exports.ListNotifications = catchAsync(async (req, res) => {
  const [mine, broadcasts, prof, user] = await Promise.all([
    itemsOf(req.uid).orderBy("createdAt", "desc").limit(LIST_LIMIT).get(),
    db.collection("broadcasts").orderBy("createdAt", "desc").limit(LIST_LIMIT).get(),
    profile(req.uid).get(),
    admin.auth().getUser(req.uid).catch(() => null),
  ]);
  const seenAt = (prof.exists && prof.data().notificationsSeenAt) || "";
  // Don't show a new student years of old news.
  const joined = user && user.metadata && user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : "";

  const items = [
    ...mine.docs.map((d) => ({ id: d.id, ...d.data(), broadcast: false })),
    ...broadcasts.docs
      .map((d) => ({ id: d.id, ...d.data(), broadcast: true }))
      .filter((b) => b.createdAt >= joined)
      .map((b) => ({ ...b, read: b.createdAt <= seenAt })),
  ]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, LIST_LIMIT)
    .map((n) => ({ id: n.id, title: n.title, body: n.body, type: n.type, data: n.data || {}, read: !!n.read, broadcast: n.broadcast, createdAt: n.createdAt }));

  res.status(200).json({
    status: "ok",
    message: "Notifications fetched",
    data: { items, unread: items.filter((n) => !n.read).length },
  });
});

/** PATCH /api/notifications/read - marks everything read. */
exports.MarkAllRead = catchAsync(async (req, res) => {
  const unread = await itemsOf(req.uid).where("read", "==", false).get();
  const batch = db.batch();
  unread.docs.forEach((d) => batch.set(d.ref, { read: true }, { merge: true }));
  batch.set(profile(req.uid), { notificationsSeenAt: now() }, { merge: true });
  await batch.commit();
  res.status(200).json({ status: "ok", message: "All caught up", data: { unread: 0 } });
});

/* -------------------------------------------------------------- admin */

/** POST /api/notifications/broadcast { title, body, type? } - to every student. */
exports.AdminBroadcast = catchAsync(async (req, res) => {
  const { title, body, type } = req.body || {};
  if (!title || !body) throw new AppError("Title and message are required", 400);
  const id = await broadcast({ title, body, type: type || "news" });
  if (!id) throw new AppError("Could not send the broadcast", 502);
  res.status(201).json({ status: "ok", message: "Broadcast sent", data: { id } });
});

/** POST /api/notifications/send { uid, title, body, type? } - to one student. */
exports.AdminSend = catchAsync(async (req, res) => {
  const { uid, title, body, type } = req.body || {};
  if (!uid || !title || !body) throw new AppError("uid, title and message are required", 400);
  const id = await notify(String(uid), { title, body, type: type || "account" });
  if (!id) throw new AppError("Could not send the notification", 502);
  res.status(201).json({ status: "ok", message: "Notification sent", data: { id } });
});
