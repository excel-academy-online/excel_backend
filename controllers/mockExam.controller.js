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
