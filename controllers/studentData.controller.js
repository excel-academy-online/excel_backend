/**
 * The signed-in student's own data: notes, bookmarks, lesson progress,
 * payment history with receipts, and achievements.
 *
 * Shape:
 *   studentProfiles/{uid}                  { bookmarks: [courseId], bank, ... }
 *     notes/{autoId}                       { courseId, text, positionMs, createdAt, updatedAt }
 *   enrollments/{uid}_{courseId}.progress  { completedModules: [id], percentage, ... }
 *
 * Everything is keyed by the uid from the verified token, so a student can
 * only ever read or change their own records.
 */
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const PROFILES = "studentProfiles";
const MAX_NOTE = 5000;
const MAX_BOOKMARKS = 500;

const profile = (uid) => db.collection(PROFILES).doc(uid);
const notesOf = (uid) => profile(uid).collection("notes");
const now = () => new Date().toISOString();

const shapeNote = (doc) => {
  const d = doc.data() || {};
  return {
    id: doc.id,
    courseId: d.courseId,
    text: d.text,
    positionMs: d.positionMs ?? null,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
  };
};

const cleanText = (text) => {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) throw new AppError("Note text is required", 400);
  if (t.length > MAX_NOTE) throw new AppError(`Notes are limited to ${MAX_NOTE} characters`, 400);
  return t;
};

/* ------------------------------------------------------------ notes */

/** GET /api/students/notes?courseId= - the student's notes, oldest first. */
exports.ListNotes = catchAsync(async (req, res) => {
  const { courseId } = req.query;
  let q = notesOf(req.uid);
  if (courseId) q = q.where("courseId", "==", String(courseId));
  const snap = await q.get();
  const notes = snap.docs.map(shapeNote).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  res.status(200).json({ status: "ok", message: "Notes fetched", data: notes });
});

/** POST /api/students/notes { courseId, text, positionMs? } */
exports.CreateNote = catchAsync(async (req, res) => {
  const { courseId, positionMs } = req.body || {};
  if (!courseId) throw new AppError("courseId is required", 400);
  const text = cleanText(req.body.text);
  const ref = notesOf(req.uid).doc();
  const data = {
    courseId: String(courseId),
    text,
    positionMs: Number.isFinite(Number(positionMs)) && positionMs !== null ? Math.max(0, Math.round(Number(positionMs))) : null,
    createdAt: now(),
    updatedAt: now(),
  };
  await ref.set(data);
  res.status(201).json({ status: "ok", message: "Note saved", data: { id: ref.id, ...data } });
});

/** PATCH /api/students/notes/:id { text } */
exports.UpdateNote = catchAsync(async (req, res) => {
  const ref = notesOf(req.uid).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError("Note not found", 404);
  const text = cleanText(req.body && req.body.text);
  await ref.set({ text, updatedAt: now() }, { merge: true });
  res.status(200).json({ status: "ok", message: "Note updated", data: { ...shapeNote(snap), text } });
});

/** DELETE /api/students/notes/:id */
exports.DeleteNote = catchAsync(async (req, res) => {
  const ref = notesOf(req.uid).doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) throw new AppError("Note not found", 404);
  await ref.delete();
  res.status(200).json({ status: "ok", message: "Note deleted", data: { id: req.params.id } });
});

/* -------------------------------------------------------- bookmarks */

/** GET /api/students/bookmarks - ids of bookmarked courses. */
exports.GetBookmarks = catchAsync(async (req, res) => {
  const snap = await profile(req.uid).get();
  const bookmarks = (snap.exists && Array.isArray(snap.data().bookmarks)) ? snap.data().bookmarks : [];
  res.status(200).json({ status: "ok", message: "Bookmarks fetched", data: bookmarks });
});

/** PUT /api/students/bookmarks { courseIds: [] } - replaces the whole set. */
exports.SetBookmarks = catchAsync(async (req, res) => {
  const ids = req.body && req.body.courseIds;
  if (!Array.isArray(ids)) throw new AppError("courseIds must be an array", 400);
  const bookmarks = [...new Set(ids.map(String).filter(Boolean))].slice(0, MAX_BOOKMARKS);
  await profile(req.uid).set({ bookmarks, updatedAt: now() }, { merge: true });
  res.status(200).json({ status: "ok", message: "Bookmarks saved", data: bookmarks });
});

/* --------------------------------------------------------- progress */

const { courseProgress, videoIds } = require("../utils/courseProgress");

/**
 * POST /api/students/progress { courseId, moduleId }
 * Marks one lesson video as watched. Only for courses the student owns.
 */
exports.MarkLessonComplete = catchAsync(async (req, res) => {
  const { courseId, moduleId } = req.body || {};
  if (!courseId || !moduleId) throw new AppError("courseId and moduleId are required", 400);

  const enrolRef = db.collection("enrollments").doc(`${req.uid}_${courseId}`);
  const [enrol, course] = await Promise.all([enrolRef.get(), db.collection("courses").doc(String(courseId)).get()]);
  if (!enrol.exists) throw new AppError("You are not enrolled in this course", 403);
  if (!course.exists) throw new AppError("Course not found", 404);

  const all = videoIds(course.data());
  if (!all.includes(String(moduleId))) throw new AppError("Lesson not found in this course", 404);

  const prev = enrol.data().progress || {};
  const done = [...new Set([...(prev.completedModules || []), String(moduleId)])].filter((id) => all.includes(id));
  const p = courseProgress(course.data(), done);
  const progress = {
    ...prev,
    completedModules: done,
    lessons_completed: p.completed,
    total_lessons: p.total,
    percentage: p.percentage,
    ...(p.percentage === 100 && !prev.completedAt ? { completedAt: now() } : {}),
  };
  await enrolRef.set({ progress }, { merge: true });
  res.status(200).json({
    status: "ok",
    message: "Progress saved",
    data: { percentage: p.percentage, lessons_completed: p.completed, total_lessons: p.total, completedModules: done },
  });
});

/* ------------------------------------------------- orders & receipts */

async function titlesFor(courseIds) {
  const ids = [...new Set(courseIds.map(String))];
  if (!ids.length) return {};
  const docs = await db.getAll(...ids.map((id) => db.collection("courses").doc(id)));
  const out = {};
  docs.forEach((d) => {
    const c = d.exists ? d.data() : {};
    out[d.id] = { id: d.id, title: c.title || "Course", category: c.level || c.category || c.programName || "Course" };
  });
  return out;
}

/** GET /api/students/orders - the student's completed purchases, newest first. */
exports.MyOrders = catchAsync(async (req, res) => {
  const snap = await db.collection("orders").where("uid", "==", req.uid).get();
  const orders = snap.docs.map((d) => d.data()).filter((o) => o.status === "completed");
  const titles = await titlesFor(orders.flatMap((o) => o.courseIds || []));
  const data = orders
    .map((o) => ({
      reference: o.reference,
      amount: o.amount,
      currency: o.currency || "NGN",
      paidAt: o.paidAt,
      channel: o.channel || null,
      vendor: "Paystack",
      courses: (o.courseIds || []).map((id) => titles[id] || { id, title: "Course", category: "Course" }),
      receiptPath: `/students/orders/${encodeURIComponent(o.reference)}/receipt`,
    }))
    .sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));
  res.status(200).json({ status: "ok", message: "Orders fetched", data });
});

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const naira = (n) => "NGN " + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 });

/** GET /api/students/orders/:reference/receipt - a printable HTML receipt. */
exports.Receipt = catchAsync(async (req, res) => {
  const snap = await db.collection("orders").doc(req.params.reference).get();
  if (!snap.exists) throw new AppError("Receipt not found", 404);
  const o = snap.data();
  const isAdmin = ["admin", "superadmin"].includes(req.role);
  if (o.uid !== req.uid && !isAdmin) throw new AppError("Receipt not found", 404);

  const titles = await titlesFor(o.courseIds || []);
  const rows = (o.courseIds || [])
    .map((id) => "<tr><td>" + esc((titles[id] || {}).title) + "</td><td>" + esc((titles[id] || {}).category) + "</td></tr>")
    .join("");
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Receipt " + esc(o.reference) + "</title>" +
    "<style>body{font-family:Arial,sans-serif;max-width:560px;margin:24px auto;padding:0 16px;color:#222}" +
    "h1{font-size:20px}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{text-align:left;padding:8px;border-bottom:1px solid #ddd}" +
    ".total{font-size:18px;font-weight:bold}.muted{color:#666;font-size:13px}</style></head><body>" +
    "<h1>Excel Academy - Payment receipt</h1>" +
    '<p class="muted">Reference: ' + esc(o.reference) + "<br>Date: " + esc(new Date(o.paidAt).toUTCString()) +
    "<br>Paid by: " + esc(o.email) + "<br>Paid via: Paystack" + (o.channel ? " (" + esc(o.channel) + ")" : "") + "</p>" +
    "<table><tr><th>Course</th><th>Category</th></tr>" + rows + "</table>" +
    '<p class="total">Total paid: ' + esc(naira(o.amount)) + "</p>" +
    '<p class="muted">Thank you for learning with Excel Academy.</p></body></html>';
  res.status(200).type("html").send(html);
});

/* ----------------------------------------------------- achievements */

/** GET /api/students/achievements - finished courses and won quiz challenges. */
exports.Achievements = catchAsync(async (req, res) => {
  const [enrolSnap, resultSnap] = await Promise.all([
    db.collection("enrollments").where("student_id", "==", req.uid).get(),
    db.collection("quizResults").where("uid", "==", req.uid).get(),
  ]);

  const enrolments = enrolSnap.docs.map((d) => d.data());
  const courseDocs = enrolments.length
    ? await db.getAll(...enrolments.map((e) => db.collection("courses").doc(String(e.course_id))))
    : [];
  const finishedIds = enrolments
    .filter((e, i) => courseDocs[i].exists && courseProgress(courseDocs[i].data(), (e.progress || {}).completedModules).percentage === 100)
    .map((e) => e.course_id);
  const titles = await titlesFor(finishedIds);

  const courses = finishedIds.map((id) => ({
    courseId: id,
    title: (titles[id] || {}).title || "a course",
    text: `Completed ${(titles[id] || {}).title || "a course"}. Congratulations on this achievement!`,
  }));
  const challenges = resultSnap.docs
    .map((d) => d.data())
    .filter((r) => r.won)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((r) => ({
      program: r.program,
      points: r.points,
      opponentPoints: r.opponentPoints,
      at: r.createdAt,
      text: `Won a ${r.program} challenge against ${r.opponentName || "an opponent"} (${r.points} - ${r.opponentPoints}).`,
    }));

  res.status(200).json({ status: "ok", message: "Achievements fetched", data: { courses, challenges } });
});
