/**
 * Mock exams (Figma "🏆🥇Gamified": instructions, exam, results, statistics,
 * solutions).
 *
 *   mockExams/{courseId}   { courseId, title, minutes, level, status: 1,
 *                            questions: [{ id, question, options[], answer (index), explanation }] }
 *   mockAttempts/{uid}_{courseId}
 *       current: { order[], answers{qid: index}, remainingSec, startedAt, savedAt } | null
 *       history: [{ at, score, correct, incorrect, omitted, total, timeSpentSec, review[] }]
 *
 * Answers never leave the server until an attempt is submitted. An attempt can
 * be paused and continued later with the time that was left.
 */
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const EXAMS = "mockExams";
const ATTEMPTS = "mockAttempts";
const { ownedCourseIds } = require("../utils/ownership");

const now = () => new Date().toISOString();

async function loadExam(courseId) {
  const snap = await db.collection(EXAMS).doc(String(courseId)).get();
  if (!snap.exists || Number(snap.data().status ?? 1) !== 1 || !(snap.data().questions || []).length) {
    throw new AppError("There is no mock exam for this course yet", 404);
  }
  return snap.data();
}

async function requireOwner(uid, courseId) {
  if (!(await ownedCourseIds(uid)).includes(String(courseId))) {
    throw new AppError("Enrol in this course to take its mock exam", 403);
  }
}

const attemptRef = (uid, courseId) => db.collection(ATTEMPTS).doc(`${uid}_${courseId}`);

const summary = (exam, attempt) => {
  const history = (attempt && attempt.history) || [];
  const last = history[history.length - 1] || null;
  return {
    courseId: exam.courseId,
    title: exam.title,
    level: exam.level || "",
    minutes: exam.minutes,
    questionCount: exam.questions.length,
    inProgress: !!(attempt && attempt.current),
    remainingSec: attempt && attempt.current ? attempt.current.remainingSec : null,
    answered: attempt && attempt.current ? Object.keys(attempt.current.answers || {}).length : 0,
    attempts: history.length,
    lastScore: last ? last.score : null,
    bestScore: history.length ? Math.max(...history.map((h) => h.score)) : null,
    lastAt: last ? last.at : null,
  };
};

/** GET /api/mock-exams - mock exams for the courses the student owns. */
exports.ListMine = catchAsync(async (req, res) => {
  const owned = await ownedCourseIds(req.uid);
  if (!owned.length) return res.status(200).json({ status: "ok", message: "Mock exams", data: [] });
  const refs = owned.map((id) => db.collection(EXAMS).doc(id));
  const exams = (await db.getAll(...refs)).filter((d) => d.exists && Number(d.data().status ?? 1) === 1).map((d) => d.data());
  const attempts = exams.length ? await db.getAll(...exams.map((e) => attemptRef(req.uid, e.courseId))) : [];
  const data = exams.map((e, i) => summary(e, attempts[i].exists ? attempts[i].data() : null));
  res.status(200).json({ status: "ok", message: "Mock exams", data });
});

/** GET /api/mock-exams/:courseId - the instructions screen: counts, time, progress. */
exports.GetOne = catchAsync(async (req, res) => {
  const exam = await loadExam(req.params.courseId);
  const snap = await attemptRef(req.uid, exam.courseId).get();
  res.status(200).json({
    status: "ok",
    message: "Mock exam",
    data: { ...summary(exam, snap.exists ? snap.data() : null), owned: (await ownedCourseIds(req.uid)).includes(exam.courseId) },
  });
});

const shuffle = (a) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};

/**
 * POST /api/mock-exams/:courseId/start - starts an attempt, or continues the
 * paused one. Questions come without answers.
 */
exports.Start = catchAsync(async (req, res) => {
  await requireOwner(req.uid, req.params.courseId);
  const exam = await loadExam(req.params.courseId);
  const ref = attemptRef(req.uid, exam.courseId);
  const snap = await ref.get();
  let current = snap.exists ? snap.data().current : null;
  const byId = Object.fromEntries(exam.questions.map((q) => [q.id, q]));
  if (!current || !(current.order || []).every((id) => byId[id])) {
    current = {
      order: shuffle(exam.questions.map((q) => q.id)),
      answers: {},
      remainingSec: exam.minutes * 60,
      startedAt: now(),
      savedAt: now(),
    };
    await ref.set({ uid: req.uid, courseId: exam.courseId, current }, { merge: true });
  }
  res.status(200).json({
    status: "ok",
    message: "Mock exam started",
    data: {
      courseId: exam.courseId,
      title: exam.title,
      level: exam.level || "",
      minutes: exam.minutes,
      remainingSec: current.remainingSec,
      answers: current.answers,
      questions: current.order.map((id) => ({ id, question: byId[id].question, options: byId[id].options })),
    },
  });
});

const cleanAnswers = (answers, exam) => {
  const ids = new Set(exam.questions.map((q) => q.id));
  const out = {};
  for (const [k, v] of Object.entries(answers || {})) {
    if (ids.has(k) && Number.isInteger(v) && v >= 0 && v < 10) out[k] = v;
  }
  return out;
};

/** POST /api/mock-exams/:courseId/save { answers, remainingSec } - pause / continue later. */
exports.Save = catchAsync(async (req, res) => {
  const exam = await loadExam(req.params.courseId);
  const ref = attemptRef(req.uid, exam.courseId);
  const snap = await ref.get();
  const current = snap.exists ? snap.data().current : null;
  if (!current) throw new AppError("Start the mock exam first", 409);
  const remainingSec = Math.max(0, Math.min(Number(req.body.remainingSec) || 0, current.remainingSec));
  await ref.set(
    { current: { ...current, answers: cleanAnswers(req.body.answers, exam), remainingSec, savedAt: now() } },
    { merge: true }
  );
  res.status(200).json({ status: "ok", message: "Progress saved", data: { remainingSec } });
});

/** POST /api/mock-exams/:courseId/submit { answers, remainingSec } - marks the attempt. */
exports.Submit = catchAsync(async (req, res) => {
  const exam = await loadExam(req.params.courseId);
  const ref = attemptRef(req.uid, exam.courseId);
  const snap = await ref.get();
  const current = snap.exists ? snap.data().current : null;
  if (!current) throw new AppError("Start the mock exam first", 409);
  const answers = cleanAnswers({ ...current.answers, ...(req.body.answers || {}) }, exam);
  const byId = Object.fromEntries(exam.questions.map((q) => [q.id, q]));
  const review = current.order.map((id) => {
    const q = byId[id];
    const chosen = answers[id];
    return {
      id,
      question: q.question,
      options: q.options,
      answer: q.answer,
      chosen: chosen ?? null,
      correct: chosen === q.answer,
      explanation: q.explanation || "",
    };
  });
  const correct = review.filter((r) => r.correct).length;
  const omitted = review.filter((r) => r.chosen == null).length;
  const total = review.length;
  const remainingSec = Math.max(0, Math.min(Number(req.body.remainingSec) || 0, current.remainingSec));
  const result = {
    at: now(),
    score: Math.round((correct / total) * 100),
    correct,
    incorrect: total - correct - omitted,
    omitted,
    total,
    timeSpentSec: exam.minutes * 60 - remainingSec,
    review,
  };
  const history = [...((snap.data().history || []).slice(-9)), result];
  await ref.set({ current: null, history }, { merge: true });
  res.status(200).json({ status: "ok", message: "Mock exam submitted", data: { ...result, attempts: history.length } });
});

/** GET /api/mock-exams/:courseId/result - the latest marked attempt (solutions, statistics). */
exports.LastResult = catchAsync(async (req, res) => {
  const snap = await attemptRef(req.uid, req.params.courseId).get();
  const history = snap.exists ? snap.data().history || [] : [];
  if (!history.length) throw new AppError("You have not finished this mock exam yet", 404);
  res.status(200).json({ status: "ok", message: "Result", data: { ...history[history.length - 1], attempts: history.length } });
});

/** DELETE /api/mock-exams/:courseId/attempt - discard a paused attempt and start over. */
exports.Discard = catchAsync(async (req, res) => {
  await attemptRef(req.uid, req.params.courseId).set({ current: null }, { merge: true });
  res.status(200).json({ status: "ok", message: "Attempt discarded", data: {} });
});

/* ------------------------------------------------------------ staff */

/** GET /api/mock-exams/admin/all - every mock exam with how often it's taken. */
exports.AdminList = catchAsync(async (req, res) => {
  const [exams, attempts] = await Promise.all([db.collection(EXAMS).get(), db.collection(ATTEMPTS).get()]);
  const stats = {};
  attempts.docs.forEach((d) => {
    const a = d.data();
    const s = (stats[a.courseId] = stats[a.courseId] || { students: 0, attempts: 0, scoreSum: 0, inProgress: 0 });
    s.students++;
    if (a.current) s.inProgress++;
    for (const h of a.history || []) { s.attempts++; s.scoreSum += h.score; }
  });
  const data = exams.docs.map((d) => {
    const e = d.data();
    const s = stats[d.id] || { students: 0, attempts: 0, scoreSum: 0, inProgress: 0 };
    return {
      id: d.id,
      courseId: d.id,
      title: e.title || "",
      level: e.level || "",
      minutes: e.minutes || 0,
      questionCount: (e.questions || []).length,
      status: Number(e.status ?? 1),
      source: e.source || "staff",
      students: s.students,
      attempts: s.attempts,
      inProgress: s.inProgress,
      averageScore: s.attempts ? Math.round(s.scoreSum / s.attempts) : null,
      updatedAt: e.updatedAt || null,
    };
  });
  res.status(200).json({ status: "ok", message: "Mock exams", data });
});

/** GET /api/mock-exams/admin/:courseId - one exam with its answers, for editing. */
exports.AdminGet = catchAsync(async (req, res) => {
  const snap = await db.collection(EXAMS).doc(String(req.params.courseId)).get();
  if (!snap.exists) {
    const course = await db.collection("courses").doc(String(req.params.courseId)).get();
    if (!course.exists) throw new AppError("Course not found", 404);
    return res.status(200).json({
      status: "ok",
      message: "New mock exam",
      data: { courseId: course.id, title: `${course.data().title} - Mock Examination`, level: course.data().level || "", minutes: 15, status: 1, questions: [] },
    });
  }
  res.status(200).json({ status: "ok", message: "Mock exam", data: { ...snap.data(), courseId: snap.id } });
});

/**
 * PUT /api/mock-exams/admin/:courseId { title, minutes, status, questions[] }
 * Create or replace a course's mock exam. Each question needs text, 2-6
 * options and the index of the right one. Saved as a staff exam, so the
 * seed script never overwrites it.
 */
exports.AdminSave = catchAsync(async (req, res) => {
  const courseId = String(req.params.courseId);
  const course = await db.collection("courses").doc(courseId).get();
  if (!course.exists) throw new AppError("Course not found", 404);
  const b = req.body || {};
  const questions = Array.isArray(b.questions) ? b.questions : [];
  if (!questions.length) throw new AppError("Add at least one question", 400);
  const clean = questions.map((q, i) => {
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o || "").trim()).filter(Boolean);
    const answer = Number(q.answer);
    if (!String(q.question || "").trim()) throw new AppError(`Question ${i + 1} has no text`, 400);
    if (options.length < 2 || options.length > 6) throw new AppError(`Question ${i + 1} needs 2 to 6 options`, 400);
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      throw new AppError(`Question ${i + 1}: pick the correct option`, 400);
    }
    return {
      id: String(q.id || `q-${Date.now().toString(36)}-${i}`),
      question: String(q.question).trim(),
      options,
      answer,
      explanation: String(q.explanation || "").trim(),
    };
  });
  const minutes = Math.max(1, Math.min(300, Math.round(Number(b.minutes) || clean.length * 1.5)));
  await db.collection(EXAMS).doc(courseId).set({
    courseId,
    title: String(b.title || `${course.data().title} - Mock Examination`).trim(),
    level: course.data().level || "",
    minutes,
    status: Number(b.status ?? 1) === 1 ? 1 : 0,
    source: "staff",
    questions: clean,
    updatedAt: now(),
    updatedBy: req.uid,
  });
  res.status(200).json({ status: "ok", message: "Mock exam saved", data: { courseId, questionCount: clean.length } });
});

/** POST /api/mock-exams/admin/:courseId/status { status: 1|0 } - publish or hide. */
exports.AdminSetStatus = catchAsync(async (req, res) => {
  const ref = db.collection(EXAMS).doc(String(req.params.courseId));
  if (!(await ref.get()).exists) throw new AppError("Mock exam not found", 404);
  const status = Number((req.body || {}).status) === 1 ? 1 : 0;
  await ref.set({ status, updatedAt: now() }, { merge: true });
  res.status(200).json({ status: "ok", message: status ? "Mock exam published" : "Mock exam hidden", data: { status } });
});
