/**
 * The EXCEL-BEAT-DA-SCORE quiz game: questions, results, the leaderboard and
 * live matches between two students.
 *
 * Questions are the ones admins already author from the dashboard
 * (`gamification` collection, status 1 = published). The app picks a
 * programme by short name ("ICAN"), which is matched against programme names
 * ("Institute of Chartered Accountants of Nigeria (ICAN)").
 *
 *   quizResults/{autoId}   { uid, name, program, points, correct, total,
 *                            opponentType, opponentName, opponentPoints, won,
 *                            matchId, createdAt }
 *   quizMatches/{autoId}   { program, status: waiting|active|done, players,
 *                            names, scores, finished, questions, createdAt }
 */
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const POINTS_PER_CORRECT = 8;
const DEFAULT_COUNT = 10;
const MAX_COUNT = 30;
const MATCH_WAIT_MS = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const displayName = (req) =>
  (req.user && (req.user.name || (req.user.email || "").split("@")[0])) || "Student";

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

function shapeQuestion(doc) {
  const d = doc.data();
  const options = (d.options || []).map((o) => String(optionText(o)));
  const correct = answerIndex(d.questionAnswer, options.length);
  if (!d.question || options.length < 2 || correct === null) return null;
  return { id: doc.id, question: d.question, options, correctOptions: [correct] };
}

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
  if (!ids.length) return [];
  const docs = [];
  for (let i = 0; i < ids.length; i += 10) {
    const snap = await db.collection("gamification").where("program_id", "in", ids.slice(i, i + 10)).get();
    docs.push(...snap.docs);
  }
  const questions = docs.filter((d) => Number(d.data().status) === 1).map(shapeQuestion).filter(Boolean);
  return shuffle(questions).slice(0, count);
}

const clampCount = (n) => Math.min(MAX_COUNT, Math.max(1, Number(n) || DEFAULT_COUNT));

/** GET /api/quiz/questions?program=ICAN&count=10 */
exports.GetQuestions = catchAsync(async (req, res) => {
  if (!req.query.program) throw new AppError("program is required", 400);
  const questions = await pickQuestions(req.query.program, clampCount(req.query.count));
  res.status(200).json({ status: "ok", message: "Questions fetched", data: questions });
});

/* ---------------------------------------------------------- results */

/**
 * POST /api/quiz/results
 * { program, correct, total, opponentType: "bot"|"real", opponentName?, opponentPoints?, matchId? }
 * Points are derived from `correct`, never taken from the client. For a live
 * match the opponent's score comes from the match record.
 */
exports.SubmitResult = catchAsync(async (req, res) => {
  const b = req.body || {};
  const total = Math.min(MAX_COUNT, Math.max(0, Math.floor(Number(b.total) || 0)));
  const correct = Math.min(total, Math.max(0, Math.floor(Number(b.correct) || 0)));
  if (!b.program || !total) throw new AppError("program and total are required", 400);
  const points = correct * POINTS_PER_CORRECT;

  let opponentPoints = Math.min(total * POINTS_PER_CORRECT, Math.max(0, Math.floor(Number(b.opponentPoints) || 0)));
  let opponentName = b.opponentName ? String(b.opponentName).slice(0, 60) : "Excel Bot";
  const opponentType = b.opponentType === "real" ? "real" : "bot";

  if (b.matchId) {
    const ref = db.collection("quizMatches").doc(String(b.matchId));
    const snap = await ref.get();
    if (!snap.exists) throw new AppError("Match not found", 404);
    const m = snap.data();
    if (!(m.players || []).includes(req.uid)) throw new AppError("Match not found", 404);
    const other = m.players.find((p) => p !== req.uid);
    await ref.set({ scores: { [req.uid]: points }, finished: { [req.uid]: true } }, { merge: true });
    if (other) {
      opponentPoints = (m.scores || {})[other] || 0;
      opponentName = (m.names || {})[other] || "Opponent";
    }
    const bothDone = other && (m.finished || {})[other];
    if (bothDone) await ref.set({ status: "done" }, { merge: true });
  }

  const result = {
    uid: req.uid,
    name: displayName(req),
    program: String(b.program).slice(0, 40),
    points,
    correct,
    total,
    opponentType,
    opponentName,
    opponentPoints,
    won: points > opponentPoints,
    matchId: b.matchId ? String(b.matchId) : null,
    createdAt: new Date().toISOString(),
  };
  const ref = await db.collection("quizResults").add(result);
  res.status(201).json({ status: "ok", message: "Result saved", data: { id: ref.id, ...result } });
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

/** GET /api/quiz/leaderboard?period=daily|weekly|monthly|allTime */
exports.Leaderboard = catchAsync(async (req, res) => {
  const period = Object.prototype.hasOwnProperty.call(PERIODS, req.query.period) ? req.query.period : "weekly";
  const span = PERIODS[period];
  const nowMs = Date.now();

  let q = db.collection("quizResults");
  if (span) q = q.where("createdAt", ">=", new Date(nowMs - 2 * span).toISOString());
  const all = (await q.get()).docs.map((d) => d.data());

  const current = span ? all.filter((r) => Date.parse(r.createdAt) >= nowMs - span) : all;
  const previous = span ? rank(all.filter((r) => Date.parse(r.createdAt) < nowMs - span)) : [];
  const prevRank = Object.fromEntries(previous.map((e) => [e.uid, e.rank]));

  const ranked = rank(current).map((e) => ({
    rank: e.rank,
    uid: e.uid,
    name: e.name,
    points: e.points,
    movedUp: prevRank[e.uid] === undefined ? true : e.rank <= prevRank[e.uid],
  }));
  const me = ranked.find((e) => e.uid === req.uid) || null;

  res.status(200).json({
    status: "ok",
    message: "Leaderboard fetched",
    data: { period, entries: ranked.slice(0, 50), me },
  });
});

/* ---------------------------------------------------------- matches */

const shapeMatch = (id, m, uid) => {
  const other = (m.players || []).find((p) => p !== uid) || null;
  return {
    id,
    program: m.program,
    status: m.status,
    opponent: other ? { uid: other, name: (m.names || {})[other] || "Opponent", points: (m.scores || {})[other] || 0, finished: !!(m.finished || {})[other] } : null,
    questions: m.questions || [],
  };
};

/**
 * POST /api/quiz/match { program }
 * Joins a student who is already waiting for this programme, or opens a new
 * match and waits. The app polls GET /match/:id until status is "active".
 */
exports.FindMatch = catchAsync(async (req, res) => {
  const program = String((req.body || {}).program || "").trim();
  if (!program) throw new AppError("program is required", 400);
  const name = displayName(req);
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
        startedAt: new Date().toISOString(),
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
    finished: {},
    questions,
    createdAt: new Date().toISOString(),
  };
  const ref = await db.collection("quizMatches").add(match);
  res.status(201).json({ status: "ok", message: "Waiting for an opponent", data: shapeMatch(ref.id, match, req.uid) });
});

async function loadMatch(req) {
  const ref = db.collection("quizMatches").doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists || !(snap.data().players || []).includes(req.uid)) throw new AppError("Match not found", 404);
  return { ref, m: snap.data() };
}

/** GET /api/quiz/match/:id - poll for the opponent joining and their score. */
exports.GetMatch = catchAsync(async (req, res) => {
  const { m } = await loadMatch(req);
  res.status(200).json({ status: "ok", message: "Match fetched", data: shapeMatch(req.params.id, m, req.uid) });
});

/** POST /api/quiz/match/:id/score { correct } - live score while playing. */
exports.UpdateScore = catchAsync(async (req, res) => {
  const { ref, m } = await loadMatch(req);
  const max = (m.questions || []).length;
  const correct = Math.min(max, Math.max(0, Math.floor(Number((req.body || {}).correct) || 0)));
  await ref.set({ scores: { [req.uid]: correct * POINTS_PER_CORRECT } }, { merge: true });
  const fresh = (await ref.get()).data();
  res.status(200).json({ status: "ok", message: "Score updated", data: shapeMatch(req.params.id, fresh, req.uid) });
});

/** DELETE /api/quiz/match/:id - give up waiting (only while nobody joined). */
exports.CancelMatch = catchAsync(async (req, res) => {
  const { ref, m } = await loadMatch(req);
  if (m.status === "waiting") await ref.set({ status: "cancelled" }, { merge: true });
  res.status(200).json({ status: "ok", message: "Match cancelled", data: { id: req.params.id } });
});

exports._answerIndex = answerIndex;
