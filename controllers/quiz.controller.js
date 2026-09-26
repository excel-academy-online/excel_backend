/**
 * The EXCEL-BEAT-DA-SCORE quiz game: questions, answers, results, the
 * leaderboard and live matches between two students.
 *
 * Answers never leave the server. A game is either a solo session against
 * Excel Bot or a live match; the phone gets the questions without their
 * answers, sends each choice as it is made, and learns whether it was right
 * only after that choice is locked in. Scores are computed from the stored
 * choices, so a modified app or a look at the network traffic can't win.
 *
 * Questions are authored from the dashboard (`gamification`, status 1 =
 * published). They belong to a programme either by `program_id` (a
 * `programs` doc whose name matches, e.g. "Institute of Chartered Accountants
 * of Nigeria (ICAN)") or by `program_code` ("ACCA").
 *
 *   quizSessions/{id}   { uid, program, questions, answers: {qid: {choice, correct}},
 *                         finished, createdAt }
 *   quizMatches/{id}    { program, status: waiting|active|done|cancelled, players, names,
 *                         scores, answers: {uid: {qid: {...}}}, finished, questions, createdAt }
 *   quizResults/{id}    { uid, name, program, points, correct, total, opponentType,
 *                         opponentName, opponentPoints, won, pending, matchId, sessionId, createdAt }
 *   quizTotals/{uid}    { uid, name, points, games, bestScore }  (all-time leaderboard)
 */
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const POINTS_PER_CORRECT = 8;
const DEFAULT_COUNT = 10;
const MAX_COUNT = 30;
const MATCH_WAIT_MS = 60 * 1000;
const BOT_ACCURACY = 0.6;
const DAY = 24 * 60 * 60 * 1000;

const now = () => new Date().toISOString();
/**
 * Student names and photos for the game and leaderboard. The token's name
 * was often missing, so boards showed email prefixes; the profile in
 * `users` has the real name. Cached briefly.
 */
let profilesCache = null;
async function profiles() {
  if (profilesCache && Date.now() - profilesCache.at < 5 * 60 * 1000) return profilesCache.map;
  const snap = await db.collection("users").get();
  const map = {};
  snap.docs.forEach((d) => {
    const u = d.data();
    const entry = { name: u.name || u.username || u.displayName || "", photo: u.dp || u.photoUrl || null };
    map[d.id] = entry;
    if (u.id) map[u.id] = entry;
  });
  profilesCache = { at: Date.now(), map };
  return map;
}
async function nameFor(req) {
  const p = (await profiles().catch(() => ({})))[req.uid];
  return (p && p.name) || displayName(req);
}

const displayName = (req) =>
  (req.user && (req.user.name || (req.user.email || "").split("@")[0])) || "Student";

/* -------------------------------------------------------- questions */

/** "option3" -> 2, 2 -> 2, "2" -> 2. The dashboard has stored both forms. */
function answerIndex(raw, optionCount) {
  if (typeof raw === "number") return raw >= 0 && raw < optionCount ? raw : null;
  const m = String(raw ?? "").match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (/option/i.test(String(raw))) return n - 1 < optionCount ? n - 1 : null;
  return n < optionCount ? n : null;
}

/** Dashboard options are [{option1: "..."}, ...] (or plain strings). */
const optionText = (o) => (typeof o === "string" ? o : Object.values(o || {})[0] ?? "");

/** Full question, answer included. Server-side only. */
function shapeQuestion(doc) {
  const d = doc.data();
  const options = (d.options || []).map((o) => String(optionText(o)));
  const correct = answerIndex(d.questionAnswer, options.length);
  if (!d.question || options.length < 2 || correct === null) return null;
  return { id: doc.id, question: d.question, options, correctOptions: [correct] };
}

/** What the phone is allowed to see. */
const publicQuestion = (q) => ({ id: q.id, question: q.question, options: q.options });

async function programIds(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return [];
  const snap = await db.collection("programs").get();
  return snap.docs
    .filter((d) => {
      const p = String(d.data().program_name || "").toLowerCase();
      return p === key || p.includes(`(${key})`) || p.split(/\W+/).includes(key);
    })
    .map((d) => d.id);
}

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function pickQuestions(program, count) {
  const ids = await programIds(program);
  const docs = new Map();
  for (let i = 0; i < ids.length; i += 10) {
    const snap = await db.collection("gamification").where("program_id", "in", ids.slice(i, i + 10)).get();
    snap.docs.forEach((d) => docs.set(d.id, d));
  }
  const code = String(program || "").trim().toUpperCase();
  if (code) {
    const snap = await db.collection("gamification").where("program_code", "==", code).get();
    snap.docs.forEach((d) => docs.set(d.id, d));
  }
  const questions = [...docs.values()]
    .filter((d) => Number(d.data().status) === 1)
    .map(shapeQuestion)
    .filter(Boolean);
  return shuffle(questions).slice(0, count);
}

const clampCount = (n) => Math.min(MAX_COUNT, Math.max(1, Number(n) || DEFAULT_COUNT));

/** GET /api/quiz/questions?program=ICAN&count=10 - preview only, no answers. */
exports.GetQuestions = catchAsync(async (req, res) => {
  if (!req.query.program) throw new AppError("program is required", 400);
  const questions = await pickQuestions(req.query.program, clampCount(req.query.count));
  res.status(200).json({ status: "ok", message: "Questions fetched", data: questions.map(publicQuestion) });
});

/* ----------------------------------------------- answering questions */

/**
 * Locks in [choice] for [questionId] in [answers] (first answer wins, so a
 * student can't probe every option) and returns the verdict.
 */
function lockAnswer(questions, answers, questionId, choice) {
  const q = (questions || []).find((x) => x.id === String(questionId));
  if (!q) throw new AppError("That question is not part of this game", 404);
  const existing = (answers || {})[q.id];
  if (existing) return { entry: existing, q, fresh: false };
  const picked = Number.isInteger(choice) && choice >= 0 && choice < q.options.length ? choice : null;
  const entry = { choice: picked, correct: picked !== null && q.correctOptions.includes(picked), at: now() };
  return { entry, q, fresh: true };
}

const countCorrect = (answers) => Object.values(answers || {}).filter((a) => a.correct).length;

/** POST /api/quiz/session { program } - a solo game against Excel Bot. */
exports.StartSession = catchAsync(async (req, res) => {
  const program = String((req.body || {}).program || "").trim();
  if (!program) throw new AppError("program is required", 400);
  const questions = await pickQuestions(program, DEFAULT_COUNT);
  if (!questions.length) throw new AppError("There are no questions for this programme yet", 404);
  // Excel Bot: right about 60% of the time, answering 3-18s into each
  // question like a person would.
  const botPlan = questions.map(() => ({
    correct: Math.random() < BOT_ACCURACY,
    atSec: 3 + Math.floor(Math.random() * 16),
  }));
  const session = { uid: req.uid, program, questions, answers: {}, botPlan, finished: false, createdAt: now() };
  const ref = await db.collection("quizSessions").add(session);
  sessionCache.set(ref.id, { at: Date.now(), s: session });
  res.status(201).json({
    status: "ok",
    message: "Game started",
    data: { id: ref.id, program, questions: questions.map(publicQuestion), botPlan },
  });
});

// Games in progress, kept in memory so checking an answer doesn't wait on a
// database read. Firestore stays the record; this is only a shortcut.
const sessionCache = new Map();
const SESSION_TTL_MS = 30 * 60 * 1000;

async function loadSession(req, id) {
  const ref = db.collection("quizSessions").doc(String(id));
  const hit = sessionCache.get(String(id));
  if (hit && Date.now() - hit.at < SESSION_TTL_MS) {
    if (hit.s.uid !== req.uid) throw new AppError("Game not found", 404);
    return { ref, s: hit.s };
  }
  const snap = await ref.get();
  if (!snap.exists || snap.data().uid !== req.uid) throw new AppError("Game not found", 404);
  const s = snap.data();
  sessionCache.set(String(id), { at: Date.now(), s });
  return { ref, s };
}

/** POST /api/quiz/session/:id/answer { questionId, choice } */
exports.AnswerSession = catchAsync(async (req, res) => {
  const { ref, s } = await loadSession(req, req.params.id);
  if (s.finished) throw new AppError("This game is over", 409);
  const { questionId, choice } = req.body || {};
  const { entry, q, fresh } = lockAnswer(s.questions, s.answers, questionId, choice);
  if (fresh) s.answers = { ...(s.answers || {}), [q.id]: entry };
  // Reply first, then save: the student sees green/red without waiting on
  // the database write.
  res.status(200).json({ status: "ok", message: "Answer recorded", data: { correct: entry.correct, correctOptions: q.correctOptions } });
  if (fresh) ref.set({ answers: { [q.id]: entry } }, { merge: true }).catch((e) => console.error("Saving answer failed:", e.message));
});

/* ---------------------------------------------------------- results */

async function addToTotals(uid, name, points) {
  const ref = db.collection("quizTotals").doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() : { points: 0, games: 0, bestScore: 0 };
    tx.set(ref, {
      uid,
      name,
      points: (prev.points || 0) + points,
      games: (prev.games || 0) + 1,
      bestScore: Math.max(prev.bestScore || 0, points),
      updatedAt: now(),
    });
  });
}

/**
 * POST /api/quiz/results { sessionId } or { matchId }
 *
 * Scores come from the choices already locked in on the server; unanswered
 * questions count as wrong. Excel Bot's score is rolled here too. In a live
 * match the result stays `pending` until both players have finished; the
 * second submission settles both.
 */
exports.SubmitResult = catchAsync(async (req, res) => {
  const b = req.body || {};
  const name = await nameFor(req);

  if (b.sessionId) {
    const { ref, s } = await loadSession(req, b.sessionId);
    if (s.finished) throw new AppError("This game is already finished", 409);
    const total = s.questions.length;
    const correct = countCorrect(s.answers);
    const points = correct * POINTS_PER_CORRECT;
    // The bot's score is the plan the phone showed, so the two always agree.
    const plan = Array.isArray(s.botPlan) ? s.botPlan : s.questions.map(() => ({ correct: Math.random() < BOT_ACCURACY }));
    const opponentPoints = plan.filter((m) => m.correct).length * POINTS_PER_CORRECT;
    s.finished = true;
    await ref.set({ finished: true, finishedAt: now(), answers: s.answers || {} }, { merge: true });
    sessionCache.delete(String(b.sessionId));

    const result = {
      uid: req.uid, name, program: s.program, points, correct, total,
      opponentType: "bot", opponentName: "Excel Bot", opponentPoints,
      won: points > opponentPoints, pending: false,
      sessionId: String(b.sessionId), matchId: null, createdAt: now(),
    };
    const saved = await db.collection("quizResults").add(result);
    await addToTotals(req.uid, name, points);
    return res.status(201).json({ status: "ok", message: "Result saved", data: { id: saved.id, ...result } });
  }

  if (!b.matchId) throw new AppError("sessionId or matchId is required", 400);
  const { ref: matchRef, m } = await loadMatch(req, b.matchId);
  if ((m.finished || {})[req.uid]) throw new AppError("You have already finished this match", 409);

  const mine = (m.answers || {})[req.uid] || {};
  const total = (m.questions || []).length;
  const correct = countCorrect(mine);
  const points = correct * POINTS_PER_CORRECT;
  const other = (m.players || []).find((p) => p !== req.uid) || null;
  const otherDone = !!(other && (m.finished || {})[other]);
  const otherPoints = other ? (m.scores || {})[other] || 0 : 0;

  await matchRef.set(
    { scores: { [req.uid]: points }, finished: { [req.uid]: true }, ...(otherDone ? { status: "done" } : {}) },
    { merge: true }
  );

  const result = {
    uid: req.uid, name, program: m.program, points, correct, total,
    opponentType: "real",
    opponentName: other ? (m.names || {})[other] || "Opponent" : "Opponent",
    opponentPoints: otherPoints,
    won: otherDone ? points > otherPoints : false,
    pending: !otherDone,
    matchId: String(b.matchId), sessionId: null, createdAt: now(),
  };
  const saved = await db.collection("quizResults").add(result);
  await addToTotals(req.uid, name, points);

  if (otherDone) {
    const theirs = await db.collection("quizResults").where("matchId", "==", String(b.matchId)).get();
    for (const d of theirs.docs) {
      if (d.data().uid !== other) continue;
      await d.ref.set({ opponentPoints: points, won: otherPoints > points, pending: false }, { merge: true });
      // They finished first and may have left the game screen.
      await require("./notification.controller").notify(other, {
        type: "activities",
        title: otherPoints > points ? "You won your match!" : otherPoints === points ? "Your match was a draw" : "Match result is in",
        body: `${m.program}: you scored ${otherPoints}, ${name} scored ${points}.`,
        data: { screen: "leaderboard" },
      });
    }
  }

  res.status(201).json({
    status: "ok",
    message: otherDone ? "Result saved" : "Waiting for your opponent to finish",
    data: { id: saved.id, ...result },
  });
});

/* ------------------------------------------------------ leaderboard */

const PERIODS = { daily: DAY, weekly: 7 * DAY, monthly: 30 * DAY, allTime: null };

function rank(results) {
  const byUid = {};
  for (const r of results) {
    const e = (byUid[r.uid] = byUid[r.uid] || { uid: r.uid, name: r.name, points: 0 });
    e.points += r.points || 0;
    e.name = r.name || e.name;
  }
  return Object.values(byUid)
    .sort((a, b) => b.points - a.points)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

/** 1 + the number of players with more all-time points than [points]. */
async function allTimeRank(points) {
  const snap = await db.collection("quizTotals").where("points", ">", points).count().get();
  return snap.data().count + 1;
}

/** GET /api/quiz/leaderboard?period=daily|weekly|monthly|allTime */
exports.Leaderboard = catchAsync(async (req, res) => {
  const period = Object.prototype.hasOwnProperty.call(PERIODS, req.query.period) ? req.query.period : "weekly";
  const span = PERIODS[period];

  // All time reads the running totals: one small query however many games
  // have been played.
  if (!span) {
    const top = await db.collection("quizTotals").orderBy("points", "desc").limit(50).get();
    const prof = await profiles().catch(() => ({}));
    const entries = top.docs.map((d, i) => ({
      rank: i + 1, uid: d.id, name: (prof[d.id] || {}).name || d.data().name, photo: (prof[d.id] || {}).photo || null,
      points: d.data().points, movedUp: true,
    }));
    let me = entries.find((e) => e.uid === req.uid) || null;
    if (!me) {
      const mine = await db.collection("quizTotals").doc(req.uid).get();
      if (mine.exists) {
        me = { rank: await allTimeRank(mine.data().points), uid: req.uid, name: mine.data().name, points: mine.data().points, movedUp: true };
      }
    }
    return res.status(200).json({ status: "ok", message: "Leaderboard fetched", data: { period, entries, me } });
  }

  const nowMs = Date.now();
  const prof = await profiles().catch(() => ({}));
  const all = (await db.collection("quizResults").where("createdAt", ">=", new Date(nowMs - 2 * span).toISOString()).get())
    .docs.map((d) => d.data());
  const current = all.filter((r) => Date.parse(r.createdAt) >= nowMs - span);
  const previous = rank(all.filter((r) => Date.parse(r.createdAt) < nowMs - span));
  const prevRank = Object.fromEntries(previous.map((e) => [e.uid, e.rank]));

  const ranked = rank(current).map((e) => ({
    rank: e.rank,
    uid: e.uid,
    name: e.name,
    points: e.points,
    movedUp: prevRank[e.uid] === undefined ? true : e.rank <= prevRank[e.uid],
  }));
  res.status(200).json({
    status: "ok",
    message: "Leaderboard fetched",
    data: (() => {
      const withProfile = ranked.map((e) => ({ ...e, name: (prof[e.uid] || {}).name || e.name, photo: (prof[e.uid] || {}).photo || null }));
      return { period, entries: withProfile.slice(0, 50), me: withProfile.find((e) => e.uid === req.uid) || null };
    })(),
  });
});

/** GET /api/quiz/me - the pre-game card: games played, best score, rank. */
exports.MyStats = catchAsync(async (req, res) => {
  const snap = await db.collection("quizTotals").doc(req.uid).get();
  const t = snap.exists ? snap.data() : null;
  res.status(200).json({
    status: "ok",
    message: "Quiz stats fetched",
    data: {
      name: await nameFor(req),
      games: t ? t.games || 0 : 0,
      bestScore: t ? t.bestScore || 0 : 0,
      totalPoints: t ? t.points || 0 : 0,
      rank: t ? await allTimeRank(t.points || 0) : null,
      questionsPerGame: DEFAULT_COUNT,
    },
  });
});

/* ---------------------------------------------------------- matches */

const shapeMatch = (id, m, uid) => {
  const other = (m.players || []).find((p) => p !== uid) || null;
  return {
    id,
    program: m.program,
    status: m.status,
    opponent: other
      ? {
          uid: other,
          name: (m.names || {})[other] || "Opponent",
          points: (m.scores || {})[other] || 0,
          finished: !!(m.finished || {})[other],
        }
      : null,
    questions: (m.questions || []).map(publicQuestion),
  };
};

async function loadMatch(req, id) {
  const ref = db.collection("quizMatches").doc(String(id));
  const snap = await ref.get();
  if (!snap.exists || !(snap.data().players || []).includes(req.uid)) throw new AppError("Match not found", 404);
  return { ref, m: snap.data() };
}

/**
 * POST /api/quiz/match { program }
 * Joins a student who is already waiting for this programme, or opens a new
 * match and waits. The app polls GET /match/:id until status is "active".
 */
exports.FindMatch = catchAsync(async (req, res) => {
  const program = String((req.body || {}).program || "").trim();
  if (!program) throw new AppError("program is required", 400);
  const name = await nameFor(req);
  const cutoff = new Date(Date.now() - MATCH_WAIT_MS).toISOString();

  const waiting = await db.collection("quizMatches").where("status", "==", "waiting").get();
  const candidates = waiting.docs.filter((d) => {
    const m = d.data();
    return m.program === program && m.createdAt >= cutoff && !(m.players || []).includes(req.uid);
  });

  for (const cand of candidates) {
    const joined = await db.runTransaction(async (tx) => {
      const snap = await tx.get(cand.ref);
      const m = snap.data();
      if (m.status !== "waiting" || (m.players || []).length !== 1) return null;
      const next = {
        status: "active",
        players: [...m.players, req.uid],
        names: { ...(m.names || {}), [req.uid]: name },
        scores: { ...(m.scores || {}), [req.uid]: 0 },
        startedAt: now(),
      };
      tx.set(cand.ref, next, { merge: true });
      return { ...m, ...next };
    });
    if (joined) return res.status(200).json({ status: "ok", message: "Match found", data: shapeMatch(cand.id, joined, req.uid) });
  }

  const questions = await pickQuestions(program, DEFAULT_COUNT);
  if (!questions.length) throw new AppError("There are no questions for this programme yet", 404);
  const match = {
    program,
    status: "waiting",
    players: [req.uid],
    names: { [req.uid]: name },
    scores: { [req.uid]: 0 },
    answers: {},
    finished: {},
    questions,
    createdAt: now(),
  };
  const ref = await db.collection("quizMatches").add(match);
  res.status(201).json({ status: "ok", message: "Waiting for an opponent", data: shapeMatch(ref.id, match, req.uid) });
});

/** GET /api/quiz/match/:id - poll for the opponent joining and their score. */
exports.GetMatch = catchAsync(async (req, res) => {
  const { m } = await loadMatch(req, req.params.id);
  res.status(200).json({ status: "ok", message: "Match fetched", data: shapeMatch(req.params.id, m, req.uid) });
});

/** POST /api/quiz/match/:id/answer { questionId, choice } - also updates the live score. */
exports.AnswerMatch = catchAsync(async (req, res) => {
  const { ref, m } = await loadMatch(req, req.params.id);
  if (m.status !== "active" && m.status !== "done") throw new AppError("This match hasn't started", 409);
  if ((m.finished || {})[req.uid]) throw new AppError("You have already finished this match", 409);
  const mine = (m.answers || {})[req.uid] || {};
  const { questionId, choice } = req.body || {};
  const { entry, q, fresh } = lockAnswer(m.questions, mine, questionId, choice);
  if (fresh) {
    const score = (countCorrect(mine) + (entry.correct ? 1 : 0)) * POINTS_PER_CORRECT;
    await ref.set({ answers: { [req.uid]: { [q.id]: entry } }, scores: { [req.uid]: score } }, { merge: true });
  }
  const fresh2 = (await ref.get()).data();
  res.status(200).json({
    status: "ok",
    message: "Answer recorded",
    data: { correct: entry.correct, correctOptions: q.correctOptions, match: shapeMatch(req.params.id, fresh2, req.uid) },
  });
});

/** DELETE /api/quiz/match/:id - give up waiting (only while nobody joined). */
exports.CancelMatch = catchAsync(async (req, res) => {
  const { ref, m } = await loadMatch(req, req.params.id);
  if (m.status === "waiting") await ref.set({ status: "cancelled" }, { merge: true });
  res.status(200).json({ status: "ok", message: "Match cancelled", data: { id: req.params.id } });
});

exports._answerIndex = answerIndex;
exports.POINTS_PER_CORRECT = POINTS_PER_CORRECT;

/**
 * POST /api/quiz/report { questionId, reason? } - a student flags a question
 * (wrong answer, typo, unclear). Staff review reports in quizReports; one
 * report per student per question.
 */
exports.ReportQuestion = catchAsync(async (req, res) => {
  const questionId = String((req.body || {}).questionId || "");
  if (!questionId) throw new AppError("questionId is required", 400);
  const q = await db.collection("gamification").doc(questionId).get();
  if (!q.exists) throw new AppError("Question not found", 404);
  const reason = String((req.body || {}).reason || "").trim().slice(0, 500);
  await db.collection("quizReports").doc(`${questionId}_${req.uid}`).set({
    questionId,
    question: q.data().question || "",
    uid: req.uid,
    name: await nameFor(req),
    reason,
    status: "open",
    createdAt: now(),
  });
  res.status(201).json({ status: "ok", message: "Thanks - we'll review this question", data: { questionId } });
});

/** GET /api/quiz/reports - staff: open question reports, newest first. */
exports.ListReports = catchAsync(async (req, res) => {
  const snap = await db.collection("quizReports").where("status", "==", "open").get();
  const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.status(200).json({ status: "ok", message: "Reports fetched", data });
});
