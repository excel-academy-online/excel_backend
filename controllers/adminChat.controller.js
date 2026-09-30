/**
 * Direct messages between a student and ONE specific admin (e.g. the admin of
 * a community group - Figma "Message2Admin"). Separate from the general
 * support chat (chat.controller), which any staff member answers.
 *
 *   adminThreads/{adminUid}_{studentUid}
 *       { adminUid, studentUid, adminName, studentName, studentPhoto, groupId, groupTitle,
 *         lastMessage, lastMessageAt, lastSenderUid, unreadForAdmin, unreadForStudent }
 *     messages/{autoId}  { body, senderUid, senderName, sentAt }
 *
 * The admin gets a push for every new student message; the student gets one
 * for every reply. Each side only ever sees their own threads.
 */
const { db, admin, auth } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const THREADS = "adminThreads";
const MAX_BODY = 4000;
const ADMIN_ROLES = ["admin", "superadmin"];
const threadId = (adminUid, studentUid) => `${adminUid}_${studentUid}`;
const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v || null);

async function profileOf(uid) {
  const snap = await db.collection("users").doc(uid).get();
  const u = snap.exists ? snap.data() : {};
  let name = u.name || u.username || "";
  let photo = u.dp || null;
  if (!name || !photo) {
    const a = await auth.getUser(uid).catch(() => null);
    name = name || (a && (a.displayName || (a.email || "").split("@")[0])) || "Student";
    photo = photo || (a && a.photoURL) || null;
  }
  return { name, photo };
}

async function isAdminUid(uid) {
  const u = await auth.getUser(uid).catch(() => null);
  return !!(u && ADMIN_ROLES.includes((u.customClaims || {}).role));
}

const shapeThread = (d, viewerUid) => {
  const t = d.data();
  const iAmAdmin = t.adminUid === viewerUid;
  return {
    id: d.id,
    adminUid: t.adminUid,
    studentUid: t.studentUid,
    // "with" = the other person, from the viewer's side.
    withUid: iAmAdmin ? t.studentUid : t.adminUid,
    withName: iAmAdmin ? t.studentName : t.adminName,
    withPhoto: iAmAdmin ? t.studentPhoto || null : t.adminPhoto || null,
    groupId: t.groupId || null,
    groupTitle: t.groupTitle || null,
    lastMessage: t.lastMessage || "",
    lastMessageAt: ms(t.lastMessageAt),
    lastFromMe: t.lastSenderUid === viewerUid,
    unread: (iAmAdmin ? t.unreadForAdmin : t.unreadForStudent) || 0,
  };
};

/** GET /api/admin-chat/admins - admins a student can message (for "Message2Admin" and pickers). */
exports.ListAdmins = catchAsync(async (req, res) => {
  const out = [];
  let page;
  do {
    page = await auth.listUsers(1000, page && page.pageToken);
    for (const u of page.users) {
      if (!u.disabled && ADMIN_ROLES.includes((u.customClaims || {}).role)) {
        const p = await profileOf(u.uid);
        out.push({ uid: u.uid, name: p.name, photo: p.photo, ...(ADMIN_ROLES.includes(req.role) ? { email: u.email || "" } : {}) });
      }
    }
  } while (page.pageToken);
  res.status(200).json({ status: "ok", message: "Admins", data: out });
});

/**
 * GET /api/admin-chat/threads - my conversations, newest first.
 * An admin sees everyone who messaged them; a student sees their threads with admins.
 */
exports.ListThreads = catchAsync(async (req, res) => {
  const [asAdmin, asStudent] = await Promise.all([
    db.collection(THREADS).where("adminUid", "==", req.uid).get(),
    db.collection(THREADS).where("studentUid", "==", req.uid).get(),
  ]);
  const data = [...asAdmin.docs, ...asStudent.docs]
    .map((d) => shapeThread(d, req.uid))
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  res.status(200).json({
    status: "ok",
    message: "Threads",
    data: { threads: data, unreadTotal: data.reduce((n, t) => n + t.unread, 0), isAdmin: ADMIN_ROLES.includes(req.role) },
  });
});

/** Resolves the thread from the URL's "other person" and checks the caller is in it. */
async function resolve(req) {
  const other = String(req.params.withUid);
  if (other === req.uid) throw new AppError("You can't message yourself", 400);
  // A thread is keyed admin_student. Look for one where I'm the admin (only if
  // I am one), then one where I'm the student; a new thread is always started
  // by the student, so it's the student->admin order.
  const mineAsAdmin = db.collection(THREADS).doc(threadId(req.uid, other));
  const mineAsStudent = db.collection(THREADS).doc(threadId(other, req.uid));
  const [a, s] = await Promise.all([mineAsAdmin.get(), mineAsStudent.get()]);
  if (a.exists && ADMIN_ROLES.includes(req.role)) return { ref: mineAsAdmin, snap: a, iAmAdmin: true, adminUid: req.uid, studentUid: other };
  if (s.exists) return { ref: mineAsStudent, snap: s, iAmAdmin: false, adminUid: other, studentUid: req.uid };
  return { ref: mineAsStudent, snap: s, iAmAdmin: false, adminUid: other, studentUid: req.uid, isNew: true };
}

/** GET /api/admin-chat/threads/:withUid/messages - oldest first. */
exports.ListMessages = catchAsync(async (req, res) => {
  const t = await resolve(req);
  if (t.isNew) return res.status(200).json({ status: "ok", message: "No messages yet", data: { messages: [] } });
  const snap = await t.ref.collection("messages").orderBy("sentAt", "desc").limit(Math.min(Number(req.query.limit) || 100, 300)).get();
  const messages = snap.docs
    .map((d) => {
      const m = d.data();
      return { id: d.id, body: m.body, mine: m.senderUid === req.uid, senderName: m.senderName || "", sentAt: ms(m.sentAt) };
    })
    .reverse();
  res.status(200).json({ status: "ok", message: "Messages", data: { messages, thread: shapeThread(t.snap, req.uid) } });
});

/**
 * POST /api/admin-chat/threads/:withUid/messages { body, groupId? }
 * A student messages an admin (starting the thread), or the admin replies.
 */
exports.Send = catchAsync(async (req, res) => {
  const body = String((req.body || {}).body || "").trim();
  if (!body) throw new AppError("Write a message first", 400);
  if (body.length > MAX_BODY) throw new AppError(`Messages are limited to ${MAX_BODY} characters`, 400);

  const t = await resolve(req);
  if (t.isNew && !(await isAdminUid(t.adminUid))) throw new AppError("You can only message Excel Academy admins", 403);

  const me = await profileOf(req.uid);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const patch = {
    adminUid: t.adminUid,
    studentUid: t.studentUid,
    lastMessage: body.slice(0, 200),
    lastMessageAt: now,
    lastSenderUid: req.uid,
    [t.iAmAdmin ? "unreadForStudent" : "unreadForAdmin"]: admin.firestore.FieldValue.increment(1),
  };
  let groupTitle = t.snap.exists ? t.snap.data().groupTitle : null;
  if (t.isNew) {
    const a = await profileOf(t.adminUid);
    Object.assign(patch, { adminName: a.name, adminPhoto: a.photo, createdAt: now });
  }
  if (!t.iAmAdmin) {
    Object.assign(patch, { studentName: me.name, studentPhoto: me.photo });
    const groupId = String((req.body || {}).groupId || "");
    if (groupId) {
      const g = await db.collection("communities").doc(groupId).get();
      if (g.exists) {
        groupTitle = g.data().title || null;
        Object.assign(patch, { groupId, groupTitle });
      }
    }
  }

  const msgRef = t.ref.collection("messages").doc();
  const batch = db.batch();
  batch.set(msgRef, { body, senderUid: req.uid, senderName: me.name, sentAt: now });
  batch.set(t.ref, patch, { merge: true });
  await batch.commit();

  // Push to the other person.
  const to = t.iAmAdmin ? t.studentUid : t.adminUid;
  require("./notification.controller")
    .notify(to, {
      type: "activities",
      title: t.iAmAdmin ? `${me.name} replied to you` : `New message from ${me.name}${groupTitle ? ` (${groupTitle})` : ""}`,
      body: body.length > 140 ? body.slice(0, 137) + "..." : body,
      data: { screen: "admin_chat", withUid: req.uid },
    })
    .catch(() => {});

  res.status(201).json({ status: "ok", message: "Sent", data: { id: msgRef.id } });
});

/** PATCH /api/admin-chat/threads/:withUid/read - clear my unread count. */
exports.MarkRead = catchAsync(async (req, res) => {
  const t = await resolve(req);
  if (!t.isNew) await t.ref.set({ [t.iAmAdmin ? "unreadForAdmin" : "unreadForStudent"]: 0 }, { merge: true });
  res.status(200).json({ status: "ok", message: "Read", data: {} });
});
