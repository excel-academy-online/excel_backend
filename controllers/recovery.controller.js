/**
 * Restoring access for students who bought before the migration.
 *
 * About 900 WordPress student accounts were deleted while their orders and
 * enrolments survived. `scripts/importWordpress.js` rebuilt 792 of them into
 * `studentRecovery/{emailKey}`, keyed by the email that paid.
 *
 * When one of those people signs up again with the same email, this turns that
 * record into real enrolments so their courses come back.
 *
 *   GET  /api/students/recovery        what is waiting for me?
 *   POST /api/students/recovery/claim  give it to me
 *
 * Both read the email from the verified Firebase token, never from the request
 * body - otherwise anyone could claim anyone else's purchases.
 */
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const RECOVERY = "studentRecovery";
const ENROLLMENTS = "enrollments";
const COURSES = "courses";

const emailKey = (e) => (e || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

async function loadRecord(req) {
  const email = req.user && req.user.email;
  if (!email) return { email: null, doc: null };
  const doc = await db.collection(RECOVERY).doc(emailKey(email)).get();
  return { email, doc: doc.exists ? doc : null };
}

/** Courses the record refers to that still exist, with their titles. */
async function resolveCourses(courseIds) {
  if (!courseIds.length) return [];
  const refs = courseIds.map((id) => db.collection(COURSES).doc(String(id)));
  const docs = await db.getAll(...refs);
  return docs
    .filter((d) => d.exists)
    .map((d) => ({ id: d.id, title: d.data().title || "", programId: d.data().programId || "" }));
}

/** Lesson count, so the progress record starts with a sensible total. */
const lessonCount = (course) =>
  (course.lesson || []).reduce((n, session) => n + (session.content || []).length, 0);

/* ------------------------------------------------------------------ */

/** GET /api/students/recovery */
module.exports.CheckRecovery = catchAsync(async (req, res, next) => {
  const { email, doc } = await loadRecord(req);
  if (!email) {
    return next(new AppError("Your account has no email address", 400));
  }

  if (!doc) {
    return res.status(200).json({
      status: "ok",
      message: "No previous purchases found for this email",
      data: { email, found: false, courses: [], claimed: false },
    });
  }

  const record = doc.data();
  const courses = await resolveCourses(record.courseIds || []);

  res.status(200).json({
    status: "ok",
    message: "Previous purchases found",
    data: {
      email,
      found: true,
      claimed: !!record.claimedByUid,
      claimedAt: record.claimedAt || null,
      orders: (record.orderIds || []).length,
      courses,
    },
  });
});

/** POST /api/students/recovery/claim */
module.exports.ClaimRecovery = catchAsync(async (req, res, next) => {
  const { email, doc } = await loadRecord(req);
  if (!email) {
    return next(new AppError("Your account has no email address", 400));
  }
  if (!doc) {
    return next(new AppError("No previous purchases found for this email", 404));
  }

  const record = doc.data();

  // Claiming twice should be harmless, not an error: the app may retry, and
  // the enrolment ids below are deterministic anyway.
  if (record.claimedByUid && record.claimedByUid !== req.uid) {
    return next(
      new AppError("These purchases have already been restored to another account", 409)
    );
  }

  // The app calls this on every launch. Once restored to this account, do
  // nothing: re-running rewrote the enrolments and sent "Your courses are
  // back" every time the app opened.
  if (record.claimedByUid === req.uid) {
    return res.status(200).json({
      status: "ok",
      message: "Already restored",
      data: { email, restored: [], alreadyClaimed: true },
    });
  }

  const courseDocs = await db.getAll(
    ...(record.courseIds || []).map((id) => db.collection(COURSES).doc(String(id)))
  );
  const courses = courseDocs.filter((d) => d.exists);

  if (!courses.length) {
    return next(new AppError("The courses on this record no longer exist", 404));
  }

  const now = new Date().toISOString();
  const batch = db.batch();
  const restored = [];

  for (const course of courses) {
    const data = course.data();
    // Deterministic id: re-running restores the same enrolment instead of
    // creating a second one.
    const ref = db.collection(ENROLLMENTS).doc(`${req.uid}_${course.id}`);
    batch.set(
      ref,
      {
        course_id: course.id,
        student_id: req.uid,
        program_id: data.programId || "",
        enrollment_date: now,
        status: "active",
        progress: {
          percentage: 0,
          lessons_completed: 0,
          total_lessons: lessonCount(data),
          quizzes_completed: 0,
          total_quizzes: (data.quiz || []).length,
          assignments_completed: 0,
          total_assignments: (data.assignment || []).length,
        },
        source: "wordpress-recovery",
      },
      { merge: true }
    );
    restored.push({ id: course.id, title: data.title || "" });
  }

  batch.set(
    doc.ref,
    { claimedByUid: req.uid, claimedAt: now },
    { merge: true }
  );

  await batch.commit();

  if (restored.length) {
    await require("./notification.controller").notify(req.uid, {
      type: "account",
      title: "Your courses are back",
      body: `We restored ${restored.length} course(s) you bought on our old website.`,
      data: { screen: "my_learning" },
    });
  }

  res.status(200).json({
    status: "ok",
    message: `Restored access to ${restored.length} course(s)`,
    data: { email, restored },
  });
});
