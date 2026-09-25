/**
 * Course reviews, shown on the course page's Comments tab.
 *
 *   courses/{courseId}/reviews/{uid}  { uid, name, rating 1-5, text, createdAt, updatedAt }
 *
 * One review per student per course (keyed by uid, so posting again edits it).
 * Only students enrolled in the course may review it; anyone may read.
 */
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const MAX_TEXT = 2000;
const reviewsOf = (courseId) => db.collection("courses").doc(String(courseId)).collection("reviews");

const shape = (doc) => {
  const d = doc.data() || {};
  return { id: doc.id, name: d.name || "Student", rating: d.rating, text: d.text, createdAt: d.createdAt, updatedAt: d.updatedAt || null };
};

/** GET /api/course/:courseId/reviews - newest first, with the average. */
exports.ListReviews = catchAsync(async (req, res) => {
  const snap = await reviewsOf(req.params.courseId).get();
  const reviews = snap.docs.map(shape).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const average = reviews.length ? Math.round((reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length) * 10) / 10 : null;
  const mine = req.uid ? reviews.find((r) => r.id === req.uid) || null : null;
  res.status(200).json({ status: "ok", message: "Reviews fetched", data: { reviews, average, count: reviews.length, mine } });
});

/** POST /api/course/:courseId/reviews { rating, text } - create or edit your review. */
exports.SaveReview = catchAsync(async (req, res) => {
  const { courseId } = req.params;
  const rating = Math.round(Number((req.body || {}).rating));
  const text = String((req.body || {}).text || "").trim();
  if (!(rating >= 1 && rating <= 5)) throw new AppError("Rating must be between 1 and 5", 400);
  if (!text) throw new AppError("Write a few words about the course", 400);
  if (text.length > MAX_TEXT) throw new AppError(`Reviews are limited to ${MAX_TEXT} characters`, 400);

  const enrolled = await db.collection("enrollments").doc(`${req.uid}_${courseId}`).get();
  if (!enrolled.exists) throw new AppError("Only students taking this course can review it", 403);

  const ref = reviewsOf(courseId).doc(req.uid);
  const prev = await ref.get();
  const nowIso = new Date().toISOString();
  const data = {
    uid: req.uid,
    name: (req.user && (req.user.name || (req.user.email || "").split("@")[0])) || "Student",
    rating,
    text,
    createdAt: prev.exists ? prev.data().createdAt : nowIso,
    ...(prev.exists ? { updatedAt: nowIso } : {}),
  };
  await ref.set(data);
  res.status(prev.exists ? 200 : 201).json({ status: "ok", message: "Review saved", data: shape({ id: req.uid, data: () => data }) });
});

/** DELETE /api/course/:courseId/reviews/:uid - your own, or any for staff. */
exports.DeleteReview = catchAsync(async (req, res) => {
  const isAdmin = ["admin", "superadmin"].includes(req.role);
  if (req.params.uid !== req.uid && !isAdmin) throw new AppError("You can only delete your own review", 403);
  await reviewsOf(req.params.courseId).doc(req.params.uid).delete();
  res.status(200).json({ status: "ok", message: "Review deleted", data: { id: req.params.uid } });
});
