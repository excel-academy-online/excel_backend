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
 *   { id, comment, sender, media: [url], status: 1, dateCreated, replyTo? }
 * Members who joined are in `members`; banned students in `removedStudent`
 * (the list the dashboard already manages).
 *
 * Attachments can't go to Firebase Storage while its billing is blocked, so
 * like profile photos they are kept in Firestore (`communityMedia/{id}`) and
 * served from /api/community/media/:id. The id is random and unguessable.
 */
const crypto = require("crypto");
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const MAX_TEXT = 2000;
const MAX_MEDIA_BYTES = 700 * 1024;
const isPublished = (g) => ["publish", "published"].includes(String(g.status || "").toLowerCase());
const repliesOpen = (g) => g.allow_replies === true || g.allow_replies === "true";

const baseUrl = (req) =>
  (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

let usersCache = null;
async function people() {
  if (usersCache && Date.now() - usersCache.at < 5 * 60 * 1000) return usersCache.map;
  const snap = await db.collection("users").get();
  const map = {};
  snap.docs.forEach((d) => {
    const u = d.data();
    const entry = {
      name: u.name || u.username || (u.email || "").split("@")[0] || "Student",
      email: u.email || "",
      photo: u.dp || null,
      staff: u.type === "admin" || u.admin === true,
    };
    map[d.id] = entry;
    if (u.id) map[u.id] = entry;
  });
  usersCache = { at: Date.now(), map };
  return map;
}

const liveMessages = (g) => (g.msg || []).filter((m) => Number(m.status ?? 1) === 1);

/** Joined members; groups from before joining existed count their posters. */
const membersOf = (g) =>
  Array.isArray(g.members) ? g.members : [...new Set(liveMessages(g).map((m) => m.sender))];

const shapeGroup = (d, uid, who = {}) => {
  const g = d.data();
  const msgs = liveMessages(g);
  const members = membersOf(g);
  return {
    id: d.id,
    title: g.title || "",
    description: g.description || "",
    category: g.category_type || "",
    thumbnail: g.thumbnail || null,
    messageCount: msgs.length,
    memberCount: members.length,
    joined: members.includes(uid),
    allowReplies: repliesOpen(g),
    removed: (g.removedStudent || []).includes(uid),
    lastActivity: msgs.length ? msgs[msgs.length - 1].dateCreated : g.dateUpdated || g.dateCreated || null,
    createdAt: g.dateCreated || g.date || null,
    // Up to five member photos for the card's avatar stack (newest members last).
    memberPhotos: members.map((m) => (who[m] || {}).photo).filter(Boolean).slice(-5),
  };
};

/** GET /api/community/groups - published groups. */
exports.ListGroups = catchAsync(async (req, res) => {
  const snap = await db.collection("communities").get();
  const groups = snap.docs.filter((d) => isPublished(d.data()));
  // Only the few members shown on each card - loading every user made the
  // list take seconds.
  const ids = [...new Set(groups.flatMap((d) => membersOf(d.data()).slice(-5)))];
  const docs = ids.length ? await db.getAll(...ids.map((id) => db.collection("users").doc(id))) : [];
  const who = Object.fromEntries(docs.filter((u) => u.exists).map((u) => [u.id, { photo: u.data().dp || null }]));
  const data = groups.map((d) => shapeGroup(d, req.uid, who));
  res.status(200).json({ status: "ok", message: "Groups fetched", data });
});

async function loadGroup(id, { any = false } = {}) {
  const ref = db.collection("communities").doc(String(id));
  const snap = await ref.get();
  if (!snap.exists || (!any && !isPublished(snap.data()))) throw new AppError("Group not found", 404);
  return { ref, snap };
}

/** GET /api/community/groups/:id/messages - oldest first, with author names. */
exports.ListMessages = catchAsync(async (req, res) => {
  const { snap } = await loadGroup(req.params.id);
  const who = await people();
  const all = liveMessages(snap.data());
  const byId = Object.fromEntries(all.map((m) => [m.id, m]));
  const messages = all.map((m) => {
    const author = who[m.sender] || {};
    const quoted = m.replyTo && (byId[m.replyTo.id] || m.replyTo);
    return {
      id: m.id,
      text: m.comment || "",
      senderId: m.sender,
      name: author.name || "Student",
      photo: author.photo || null,
      staff: !!author.staff,
      mine: m.sender === req.uid,
      media: (m.media || []).filter((x) => typeof x === "string"),
      mediaTypes: m.mediaTypes || [],
      replyTo: quoted
        ? {
            id: m.replyTo.id,
            name: (who[quoted.sender] || {}).name || "Student",
            text: String(quoted.comment || "").slice(0, 200),
            hasMedia: (quoted.media || []).length > 0,
          }
        : null,
      createdAt: m.dateCreated ? new Date(m.dateCreated).toISOString() : null,
    };
  });
  res.status(200).json({ status: "ok", message: "Messages fetched", data: { group: shapeGroup(snap, req.uid), messages } });
});

/** POST /api/community/groups/:id/join */
exports.Join = catchAsync(async (req, res) => {
  const { ref } = await loadGroup(req.params.id);
  await db.runTransaction(async (tx) => {
    const g = (await tx.get(ref)).data();
    if ((g.removedStudent || []).includes(req.uid)) throw new AppError("You were removed from this group", 403);
    const members = membersOf(g);
    if (!members.includes(req.uid)) tx.set(ref, { members: [...members, req.uid] }, { merge: true });
  });
  res.status(200).json({ status: "ok", message: "Joined", data: { id: req.params.id } });
});

/** POST /api/community/groups/:id/leave */
exports.Leave = catchAsync(async (req, res) => {
  const { ref } = await loadGroup(req.params.id);
  await db.runTransaction(async (tx) => {
    const g = (await tx.get(ref)).data();
    tx.set(ref, { members: membersOf(g).filter((u) => u !== req.uid) }, { merge: true });
  });
  res.status(200).json({ status: "ok", message: "Left the group", data: { id: req.params.id } });
});

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

/**
 * POST /api/community/groups/:id/messages { text?, replyTo?, attachment?, fileName? }
 * Post as yourself. `attachment` is base64 (image or PDF, up to 700 KB).
 */
exports.PostMessage = catchAsync(async (req, res) => {
  const body = req.body || {};
  const text = String(body.text || "").trim();
  const raw = String(body.attachment || "").replace(/^data:[^,]+,/, "");
  if (!text && !raw) throw new AppError("Write a message first", 400);
  if (text.length > MAX_TEXT) throw new AppError(`Messages are limited to ${MAX_TEXT} characters`, 400);

  let media = null;
  if (raw) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length > MAX_MEDIA_BYTES) throw new AppError("That file is too large - the limit is 700 KB", 413);
    const type = sniff(buf);
    if (!type) throw new AppError("You can share photos (JPEG, PNG, WebP) or PDF files", 400);
    media = { buf, type, name: String(body.fileName || "").slice(0, 120) };
  }

  const { ref, snap } = await loadGroup(req.params.id);
  const g = snap.data();
  if ((g.removedStudent || []).includes(req.uid)) throw new AppError("You were removed from this group", 403);
  if (!repliesOpen(g)) throw new AppError("Posting is closed in this group", 403);

  const msg = {
    id: crypto.randomUUID(),
    comment: text,
    sender: req.uid,
    media: [],
    status: 1,
    dateCreated: new Date().toUTCString(),
  };
  const replyId = String(body.replyTo || "");
  if (replyId) {
    const quoted = liveMessages(g).find((m) => m.id === replyId);
    if (quoted) msg.replyTo = { id: quoted.id, sender: quoted.sender, comment: String(quoted.comment || "").slice(0, 200) };
  }
  if (media) {
    const mediaId = crypto.randomBytes(16).toString("hex");
    await db.collection("communityMedia").doc(mediaId).set({
      data: media.buf.toString("base64"),
      type: media.type,
      name: media.name,
      groupId: ref.id,
      sender: req.uid,
      createdAt: new Date().toISOString(),
    });
    msg.media = [`${baseUrl(req)}/api/community/media/${mediaId}`];
    msg.mediaTypes = [media.type === "application/pdf" ? "pdf" : "image"];
  }

  await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data();
    const members = membersOf(fresh);
    tx.set(
      ref,
      {
        msg: [...(fresh.msg || []), msg],
        dateUpdated: msg.dateCreated,
        // Posting makes you a member.
        ...(members.includes(req.uid) ? {} : { members: [...members, req.uid] }),
      },
      { merge: true }
    );
  });
  // Tell the person being replied to (push + in-app notification).
  if (msg.replyTo && msg.replyTo.sender && msg.replyTo.sender !== req.uid) {
    const who = await people();
    const name = (who[req.uid] || {}).name || "Someone";
    const preview = text || (media ? (media.type === "application/pdf" ? "sent a PDF" : "sent a photo") : "");
    require("./notification.controller")
      .notify(msg.replyTo.sender, {
        type: "activities",
        title: `${name} replied to you in ${g.title || "your study group"}`,
        body: preview.length > 120 ? preview.slice(0, 117) + "..." : preview,
        data: { screen: "community", groupId: ref.id },
      })
      .catch(() => {});
  }
  res.status(201).json({ status: "ok", message: "Posted", data: { id: msg.id } });
});

/** GET /api/community/media/:id - an attachment (public; ids are unguessable). */
exports.GetMedia = catchAsync(async (req, res, next) => {
  const snap = await db.collection("communityMedia").doc(String(req.params.id)).get();
  if (!snap.exists) return next(new AppError("Not found", 404));
  const m = snap.data();
  res.set("Content-Type", m.type);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  if (m.type === "application/pdf") {
    res.set("Content-Disposition", `inline; filename="${(m.name || "document.pdf").replace(/"/g, "")}"`);
  }
  res.send(Buffer.from(m.data, "base64"));
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

/* ------------------------------------------------------------ staff */

/** GET /api/community/groups/:id/members - staff: members and banned students. */
exports.ListMembers = catchAsync(async (req, res) => {
  const { snap } = await loadGroup(req.params.id, { any: true });
  const g = snap.data();
  const who = await people();
  const posts = {};
  liveMessages(g).forEach((m) => (posts[m.sender] = (posts[m.sender] || 0) + 1));
  const row = (uid, banned) => ({
    uid,
    name: (who[uid] || {}).name || "Student",
    email: (who[uid] || {}).email || "",
    photo: (who[uid] || {}).photo || null,
    messages: posts[uid] || 0,
    banned,
  });
  const banned = g.removedStudent || [];
  res.status(200).json({
    status: "ok",
    message: "Members fetched",
    data: {
      members: membersOf(g).filter((u) => !banned.includes(u)).map((u) => row(u, false)),
      banned: banned.map((u) => row(u, true)),
    },
  });
});

/**
 * POST /api/community/groups/:id/members/:uid/:action - staff.
 *   remove: out of the group; they can join again.
 *   ban:    out, and blocked from joining or posting.
 *   unban:  allowed back (they join again themselves).
 */
exports.ModerateMember = catchAsync(async (req, res) => {
  const { action, uid } = req.params;
  if (!["remove", "ban", "unban"].includes(action)) throw new AppError("Unknown action", 400);
  const { ref } = await loadGroup(req.params.id, { any: true });
  await db.runTransaction(async (tx) => {
    const g = (await tx.get(ref)).data();
    const members = membersOf(g);
    const banned = g.removedStudent || [];
    const patch = {};
    if (action !== "unban") patch.members = members.filter((u) => u !== uid);
    if (action === "ban" && !banned.includes(uid)) patch.removedStudent = [...banned, uid];
    if (action === "unban") patch.removedStudent = banned.filter((u) => u !== uid);
    tx.set(ref, patch, { merge: true });
  });
  res.status(200).json({ status: "ok", message: `Member ${action === "unban" ? "unbanned" : action + (action === "ban" ? "ned" : "d")}`, data: { uid } });
});
