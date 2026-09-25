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
 * Grades [answers] ([{ id, choice }], choice = option index or null for
 * "time up") against the real questions. The client never says how many it
 * got right; the server works it out.
 */
async function grade(answers, matchQuestions) {
  const list = Array.isArray(answers) ? answers.slice(0, MAX_COUNT) : [];
  const seen = new Set();
  const unique = list.filter((x) => x && x.id && !seen.has(String(x.id)) && seen.add(String(x.id)));

  let byId;
  if (matchQuestions) {
    byId = Object.fromEntries(matchQuestions.map((q) => [String(q.id), q]));
  } else {
    const docs = unique.length
      ? await db.getAll(...unique.map((x) => db.collection("gamification").doc(String(x.id))))
      : [];
    byId = Object.fromEntries(
      docs.filter((d) => d.exists && Number(d.data().status) === 1).map((d) => [d.id, shapeQuestion(d)]).filter(([, q]) => q)
    );
  }

  const graded = unique.filter((x) => byId[String(x.id)]);
  const correct = graded.filter((x) => {
    const q = byId[String(x.id)];
    return Number.isInteger(x.choice) && q.correctOptions.includes(x.choice);
  }).length;
  return { total: graded.length, correct };
}

/**
 * POST /api/quiz/results
 * { program, answers: [{ id, choice }], opponentType: "bot"|"real", opponentName?, opponentPoints?, matchId? }
 *
 * Points come from server-side grading. In a live match the result stays
 * `pending` until both players have finished; the second submission settles
 * both players' results, so nobody is told they won while their opponent is
 * still playing.
 */
exports.SubmitResult = catchAsync(async (req, res) => {
  const b = req.body || {};
  if (!b.program) throw new AppError("program is required", 400);

  let match = null;
  let matchRef = null;
  if (b.matchId) {
    matchRef = db.collection("quizMatches").doc(String(b.matchId));
    const snap = await matchRef.get();
    if (!snap.exists || !(snap.data().players || []).includes(req.uid)) throw new AppError("Match not found", 404);
    match = snap.data();
    if ((match.finished || {})[req.uid]) throw new AppError("You have already finished this match", 409);
  }

  const { total, correct } = await grade(b.answers, match ? match.questions || [] : null);
  if (!total) throw new AppError("No valid answers to score", 400);
  const points = correct * POINTS_PER_CORRECT;

  const base = {
    uid: req.uid,
    name: displayName(req),
    program: String(b.program).slice(0, 40),
    points,
    correct,
    total,
    matchId: match ? String(b.matchId) : null,
    createdAt: new Date().toISOString(),
  };

  // Against Excel Bot the bot's score is simulated on the phone, so it is
  // capped to what was possible and taken as given.
  if (!match) {
    const opponentPoints = Math.min(total * POINTS_PER_CORRECT, Math.max(0, Math.floor(Number(b.opponentPoints) || 0)));
    const result = { ...base, opponentType: "bot", opponentName: "Excel Bot", opponentPoints, won: points > opponentPoints, pending: false };
    const ref = await db.collection("quizResults").add(result);
    return res.status(201).json({ status: "ok", message: "Result saved", data: { id: ref.id, ...result } });
  }

  const other = (match.players || []).find((p) => p !== req.uid) || null;
  const otherDone = !!(other && (match.finished || {})[other]);
  const otherPoints = other ? (match.scores || {})[other] || 0 : 0;
  const opponentName = other ? (match.names || {})[other] || "Opponent" : "Opponent";

  await matchRef.set(
    { scores: { [req.uid]: points }, finished: { [req.uid]: true }, ...(otherDone ? { status: "done" } : {}) },
    { merge: true }
  );

  const result = {
    ...base,
    opponentType: "real",
    opponentName,
    opponentPoints: otherPoints,
    won: otherDone ? points > otherPoints : false,
    pending: !otherDone,
  };
  const ref = await db.collection("quizResults").add(result);

  // Settle the opponent's result now that both scores are final.
  if (otherDone) {
    const theirs = await db.collection("quizResults").where("matchId", "==", String(b.matchId)).get();
    for (const d of theirs.docs) {
      if (d.data().uid !== other) continue;
      await d.ref.set({ opponentPoints: points, won: otherPoints > points, pending: false }, { merge: true });
    }
  }

  res.status(201).json({ status: "ok", message: otherDone ? "Result saved" : "Waiting for your opponent to finish", data: { id: ref.id, ...result } });
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

/** POST /api/quiz/match/:id/score { answers } - live score while playing, graded here. */
exports.UpdateScore = catchAsync(async (req, res) => {
  const { ref, m } = await loadMatch(req);
  if ((m.finished || {})[req.uid]) throw new AppError("You have already finished this match", 409);
  const { correct } = await grade((req.body || {}).answers, m.questions || []);
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

/** GET /api/quiz/me - the pre-game card: games played, best score, rank. */
exports.MyStats = catchAsync(async (req, res) => {
  const all = (await db.collection("quizResults").get()).docs.map((d) => d.data());
  const mine = all.filter((r) => r.uid === req.uid);
  const entry = rank(all).find((e) => e.uid === req.uid);
  res.status(200).json({
    status: "ok",
    message: "Quiz stats fetched",
    data: {
      name: displayName(req),
      games: mine.length,
      bestScore: mine.reduce((m, r) => Math.max(m, r.points || 0), 0),
      totalPoints: mine.reduce((s, r) => s + (r.points || 0), 0),
      rank: entry ? entry.rank : null,
      questionsPerGame: DEFAULT_COUNT,
    },
  });
});
