/**
 * Student <-> admin chat.
 *
 * There was no chat backend at all: the dashboard screen was a placeholder and
 * the Flutter app faked replies with a hardcoded string on a timer. This
 * defines the storage and the rules.
 *
 * Shape:
 *   conversations/{studentUid}            one thread per student
 *     messages/{autoId}                   the messages in it
 *
 * Keying the conversation by the student's uid means there is exactly one
 * thread per student, so nobody can open duplicates and the app never has to
 * "find or create" one first.
 *
 * Uses the Admin SDK (`db`) rather than the `firebase/*` client SDK, so it is
 * not subject to Firestore security rules - authorisation is done here.
 */
const { db, admin } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const ADMIN_ROLES = ["admin", "superadmin"];
const CONVERSATIONS = "conversations";
const MESSAGES = "messages";
const MAX_BODY = 4000;

const isAdmin = (req) => ADMIN_ROLES.includes(req.role);

/** A student may only touch their own thread; admins may touch any. */
function assertCanAccess(req, studentUid) {
  if (isAdmin(req)) return;
  if (req.uid !== studentUid) {
    throw new AppError("You can only access your own conversation", 403);
  }
}

const toMillis = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v || null);

const shapeConversation = (doc) => {
  const d = doc.data() || {};
  return {
    id: doc.id,
    studentUid: doc.id,
    studentName: d.studentName || null,
    studentEmail: d.studentEmail || null,
    lastMessage: d.lastMessage || null,
    lastMessageAt: toMillis(d.lastMessageAt),
    lastSenderRole: d.lastSenderRole || null,
    unreadForAdmin: d.unreadForAdmin || 0,
    unreadForStudent: d.unreadForStudent || 0,
    status: d.status || "open",
  };
};

const shapeMessage = (doc) => {
  const d = doc.data() || {};
  return {
    id: doc.id,
    body: d.body,
    senderUid: d.senderUid,
    senderRole: d.senderRole,
    senderName: d.senderName || null,
    sentAt: toMillis(d.sentAt),
  };
};

/* ------------------------------------------------------------------ */

/** GET /api/chat/conversations - admin inbox, newest activity first. */
module.exports.ListConversations = catchAsync(async (req, res) => {
  const { status, limit } = req.query;
  const size = Math.min(Number(limit) || 50, 200);

  let q = db.collection(CONVERSATIONS);
  if (status) q = q.where("status", "==", status);
  // Threads nobody has written to yet have no lastMessageAt and would be
  // dropped by the ordering, so they are excluded deliberately.
  const snap = await q.orderBy("lastMessageAt", "desc").limit(size).get();

  const conversations = snap.docs.map(shapeConversation);
  res.status(200).json({
    status: "ok",
    message: "Conversations fetched successfully",
    data: {
      conversations,
      unreadTotal: conversations.reduce((n, c) => n + (c.unreadForAdmin || 0), 0),
    },
  });
});

/** GET /api/chat/conversations/:studentUid */
module.exports.GetConversation = catchAsync(async (req, res, next) => {
  const { studentUid } = req.params;
  assertCanAccess(req, studentUid);

  const doc = await db.collection(CONVERSATIONS).doc(studentUid).get();
  if (!doc.exists) {
    return next(new AppError("Conversation not found", 404));
  }
  res.status(200).json({
    status: "ok",
    message: "Conversation fetched successfully",
    data: shapeConversation(doc),
  });
});

/** GET /api/chat/conversations/:studentUid/messages */
module.exports.ListMessages = catchAsync(async (req, res) => {
  const { studentUid } = req.params;
  assertCanAccess(req, studentUid);

  const size = Math.min(Number(req.query.limit) || 50, 200);
  let q = db
    .collection(CONVERSATIONS)
    .doc(studentUid)
    .collection(MESSAGES)
    .orderBy("sentAt", "desc")
    .limit(size);

  // Cursor pagination: pass the oldest id you already have.
  if (req.query.before) {
    const cursor = await db
      .collection(CONVERSATIONS)
      .doc(studentUid)
      .collection(MESSAGES)
      .doc(String(req.query.before))
      .get();
    if (cursor.exists) q = q.startAfter(cursor);
  }

  const snap = await q.get();
  // Reversed so the client receives them oldest-first for display.
  const messages = snap.docs.map(shapeMessage).reverse();

  res.status(200).json({
    status: "ok",
    message: "Messages fetched successfully",
    data: { messages, hasMore: snap.size === size },
  });
});

/** POST /api/chat/conversations/:studentUid/messages */
module.exports.SendMessage = catchAsync(async (req, res, next) => {
  const { studentUid } = req.params;
  const { body } = req.body;
  assertCanAccess(req, studentUid);

  if (typeof body !== "string" || !body.trim()) {
    return next(new AppError("Message body is required", 400));
  }
  if (body.length > MAX_BODY) {
    return next(new AppError(`Message must be under ${MAX_BODY} characters`, 400));
  }

  const senderRole = isAdmin(req) ? "admin" : "student";
  const now = admin.firestore.FieldValue.serverTimestamp();
  const conversationRef = db.collection(CONVERSATIONS).doc(studentUid);
  const messageRef = conversationRef.collection(MESSAGES).doc();

  const message = {
    body: body.trim(),
    senderUid: req.uid,
    senderRole,
    senderName: req.user?.name || req.user?.email || null,
    sentAt: now,
  };

  // One batch so a message can never exist without its conversation being
  // updated, which is what would strand it out of the inbox ordering.
  const batch = db.batch();
  batch.set(messageRef, message);
  batch.set(
    conversationRef,
    {
      studentUid,
      // Only fill in student details from the student's own token.
      ...(senderRole === "student"
        ? { studentName: req.user?.name || null, studentEmail: req.user?.email || null }
        : {}),
      lastMessage: body.trim().slice(0, 200),
      lastMessageAt: now,
      lastSenderRole: senderRole,
      status: "open",
      // The recipient's unread count goes up; the sender's is untouched.
      [senderRole === "admin" ? "unreadForStudent" : "unreadForAdmin"]:
        admin.firestore.FieldValue.increment(1),
    },
    { merge: true }
  );
  await batch.commit();

  // Tell the student when staff reply; they may not have the chat open.
  if (senderRole === "admin") {
    await require("./notification.controller").notify(studentUid, {
      type: "activities",
      title: "New message from Excel Academy",
      body: body.trim().slice(0, 140),
      data: { screen: "chat" },
    });
  }

  res.status(201).json({
    status: "ok",
    message: "Message sent",
    data: { id: messageRef.id, ...message, sentAt: Date.now() },
  });
});

/** PATCH /api/chat/conversations/:studentUid/read - clear your own unread count. */
module.exports.MarkRead = catchAsync(async (req, res) => {
  const { studentUid } = req.params;
  assertCanAccess(req, studentUid);

  const field = isAdmin(req) ? "unreadForAdmin" : "unreadForStudent";
  await db.collection(CONVERSATIONS).doc(studentUid).set({ [field]: 0 }, { merge: true });

  res.status(200).json({ status: "ok", message: "Marked as read", data: { [field]: 0 } });
});

/** PATCH /api/chat/conversations/:studentUid/status - admin closes or reopens. */
module.exports.SetStatus = catchAsync(async (req, res, next) => {
  const { studentUid } = req.params;
  const { status } = req.body;

  if (!["open", "closed"].includes(status)) {
    return next(new AppError('Status must be "open" or "closed"', 400));
  }

  await db.collection(CONVERSATIONS).doc(studentUid).set({ status }, { merge: true });
  res.status(200).json({ status: "ok", message: `Conversation ${status}`, data: { status } });
});
