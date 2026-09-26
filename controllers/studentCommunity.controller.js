/**
 * Community groups for students - the same groups staff manage on the
 * dashboard (`communities` collection).
 *
 * The app used to treat every course as a "forum" and keep its own messages
 * inside course documents, so staff groups never reached students and
 * student posts never reached staff. The old postComment endpoint also took
 * the author from the request body, so anyone could post as anyone. Here the
 * author is always the signed-in student.
 *
 * Messages stay in the group's `msg` array in the format the dashboard reads:
 *   { id, comment, sender, media: [], status: 1, dateCreated }
 */
const crypto = require("crypto");
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const MAX_TEXT = 2000;
const isPublished = (g) => String(g.status || "").toLowerCase() === "publish" || String(g.status || "").toLowerCase() === "published";

let usersCache = null;
async function people() {
  if (usersCache && Date.now() - usersCache.at < 5 * 60 * 1000) return usersCache.map;
  const snap = await db.collection("users").get();
  const map = {};
  snap.docs.forEach((d) => {
    const u = d.data();
    const entry = { name: u.name || u.username || (u.email || "").split("@")[0] || "Student", photo: u.dp || null, staff: u.type === "admin" || u.admin === true };
    map[d.id] = entry;
    if (u.id) map[u.id] = entry;
  });
  usersCache = { at: Date.now(), map };
  return map;
}

const shapeGroup = (d, uid) => {
  const g = d.data();
  const msgs = (g.msg || []).filter((m) => Number(m.status ?? 1) === 1);
  return {
    id: d.id,
    title: g.title || "",
    description: g.description || "",
    category: g.category_type || "",
    thumbnail: g.thumbnail || null,
    messageCount: msgs.length,
    memberCount: new Set(msgs.map((m) => m.sender)).size,
    allowReplies: g.allow_replies === true || g.allow_replies === "true",
    removed: (g.removedStudent || []).includes(uid),
    lastActivity: msgs.length ? msgs[msgs.length - 1].dateCreated : g.dateUpdated || g.dateCreated || null,
  };
};

/** GET /api/community/groups - published groups. */
exports.ListGroups = catchAsync(async (req, res) => {
  const snap = await db.collection("communities").get();
  const data = snap.docs.filter((d) => isPublished(d.data())).map((d) => shapeGroup(d, req.uid));
  res.status(200).json({ status: "ok", message: "Groups fetched", data });
});

async function loadGroup(id) {
  const ref = db.collection("communities").doc(String(id));
  const snap = await ref.get();
  if (!snap.exists || !isPublished(snap.data())) throw new AppError("Group not found", 404);
  return { ref, snap };
}

/** GET /api/community/groups/:id/messages - oldest first, with author names. */
exports.ListMessages = catchAsync(async (req, res) => {
  const { snap } = await loadGroup(req.params.id);
  const who = await people();
  const messages = (snap.data().msg || [])
    .filter((m) => Number(m.status ?? 1) === 1)
    .map((m) => ({
      id: m.id,
      text: m.comment || "",
      senderId: m.sender,
      name: (who[m.sender] || {}).name || "Student",
      photo: (who[m.sender] || {}).photo || null,
      staff: !!(who[m.sender] || {}).staff,
      mine: m.sender === req.uid,
      createdAt: m.dateCreated ? new Date(m.dateCreated).toISOString() : null,
    }));
  res.status(200).json({ status: "ok", message: "Messages fetched", data: { group: shapeGroup(snap, req.uid), messages } });
});

/** POST /api/community/groups/:id/messages { text } - post as yourself. */
exports.PostMessage = catchAsync(async (req, res) => {
  const text = String((req.body || {}).text || "").trim();
  if (!text) throw new AppError("Write a message first", 400);
  if (text.length > MAX_TEXT) throw new AppError(`Messages are limited to ${MAX_TEXT} characters`, 400);
  const { ref, snap } = await loadGroup(req.params.id);
  const g = snap.data();
  if ((g.removedStudent || []).includes(req.uid)) throw new AppError("You were removed from this group", 403);
  if (!(g.allow_replies === true || g.allow_replies === "true")) throw new AppError("Posting is closed in this group", 403);

  const msg = { id: crypto.randomUUID(), comment: text, sender: req.uid, media: [], status: 1, dateCreated: new Date().toUTCString() };
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    tx.set(ref, { msg: [...(fresh.data().msg || []), msg], dateUpdated: msg.dateCreated }, { merge: true });
  });
  res.status(201).json({ status: "ok", message: "Posted", data: { id: msg.id } });
});

/** DELETE /api/community/groups/:id/messages/:messageId - your own message. */
exports.DeleteMessage = catchAsync(async (req, res) => {
  const { ref } = await loadGroup(req.params.id);
  let found = false;
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const msgs = fresh.data().msg || [];
    const next = msgs.filter((m) => !(m.id === req.params.messageId && m.sender === req.uid));
    found = next.length !== msgs.length;
    if (found) tx.set(ref, { msg: next }, { merge: true });
  });
  if (!found) throw new AppError("Message not found", 404);
  res.status(200).json({ status: "ok", message: "Deleted", data: { id: req.params.messageId } });
});
