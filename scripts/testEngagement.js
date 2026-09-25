#!/usr/bin/env node
/**
 * Tests for notes, bookmarks, progress, orders/receipts, achievements, home
 * sections, the quiz game and referrals.
 *
 *   npm run test:engagement
 *
 * Firestore and Firebase Auth are replaced by an in-memory fake.
 */
const assert = require("assert");
const Module = require("module");
const path = require("path");

const results = [];
const test = (name, fn) =>
  Promise.resolve().then(fn)
    .then(() => { results.push(true); console.log(`PASS  ${name}`); })
    .catch((e) => { results.push(false); console.log(`FAIL  ${name}\n      ${e.message}`); });

/* ------------------------------------------------------ fake firestore */

let store = {};
let autoId = 0;
const colOf = (p) => (store[p] = store[p] || {});

function query(colPath, conds = []) {
  const q = {
    where: (f, op, v) => query(colPath, [...conds, [f, op, v]]),
    limit: () => q,
    async get() {
      const docs = Object.entries(colOf(colPath))
        .filter(([, d]) => conds.every(([f, op, v]) =>
          op === "==" ? d[f] === v : op === "in" ? v.includes(d[f]) : op === ">=" ? d[f] >= v : false))
        .map(([id, d]) => snapOf(colPath, id, d));
      return { empty: !docs.length, docs };
    },
  };
  return q;
}
function snapOf(colPath, id, d) {
  return { id, exists: d !== undefined, ref: docRef(colPath, id), data: () => (d === undefined ? undefined : JSON.parse(JSON.stringify(d))) };
}
function deepMerge(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}
function docRef(colPath, id) {
  return {
    id,
    async get() { return snapOf(colPath, id, colOf(colPath)[id]); },
    async set(data, opts) { const c = colOf(colPath); c[id] = opts && opts.merge ? deepMerge(c[id], data) : JSON.parse(JSON.stringify(data)); },
    async delete() { delete colOf(colPath)[id]; },
    collection: (sub) => collection(`${colPath}/${id}/${sub}`),
  };
}
function collection(colPath) {
  return {
    ...query(colPath),
    doc: (id) => docRef(colPath, id || `auto${++autoId}`),
    async add(data) { const ref = docRef(colPath, `auto${++autoId}`); await ref.set(data); return ref; },
  };
}
const db = {
  collection,
  async getAll(...refs) { return Promise.all(refs.map((r) => r.get())); },
  batch() { const ops = []; return { set: (r, d, o) => ops.push([r, d, o]), async commit() { for (const [r, d, o] of ops) await r.set(d, o); } }; },
  async runTransaction(fn) { return fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o) }); },
};

const users = {};
const admin = {
  auth: () => ({
    async getUser(uid) {
      if (!users[uid]) throw new Error("no user");
      return users[uid];
    },
  }),
};

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req.indexOf("firebaseadminvar") !== -1) return { db, admin, auth: {}, bucket: {}, firebaseConfig: {} };
  return origLoad.call(this, req, parent, isMain);
};

const ctl = (f) => require(path.join(__dirname, "..", "controllers", f));
const sd = ctl("studentData.controller.js");
const quiz = ctl("quiz.controller.js");
const ref = ctl("referral.controller.js");
const disc = ctl("discover.controller.js");
const rev = ctl("review.controller.js");

/** Run a catchAsync handler; resolves to { code, body } or { error }. */
function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      json(body) { resolve({ code: this.code, body }); },
      type() { return this; },
      send(body) { resolve({ code: this.code, body }); },
    };
    handler({ query: {}, params: {}, body: {}, role: "student", user: { name: "Ada", email: "ada@x.com" }, ...req }, res, (error) => resolve({ error }));
  });
}
const ok = (r) => { if (r.error) throw r.error; return r; };
const fails = (r, code) => { assert(r.error, "expected an error"); assert.strictEqual(r.error.statusCode, code, r.error.message); };

const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const DAY = 86400000;

function seed() {
  store = {};
  store.courses = {
    c1: { title: "Audit", status: 1, level: "ICAN", datecreated: "2024-01-01", lesson: [{ id: "s1", content: [{ id: "m1" }, { id: "m2" }] }] },
    c2: { title: "Tax", status: 1, level: "ICAN", datecreated: "2025-06-01", lesson: [] },
    c3: { title: "Draft", status: 0, lesson: [] },
  };
  store.enrollments = { u1_c1: { student_id: "u1", course_id: "c1", enrollment_date: iso(), progress: { percentage: 0 } } };
  store.orders = {
    r1: { reference: "r1", uid: "u1", email: "ada@x.com", courseIds: ["c1"], amount: 5000, status: "completed", paidAt: iso() },
    r2: { reference: "r2", uid: "u2", email: "b@x.com", courseIds: ["c2"], amount: 3000, status: "completed", paidAt: iso() },
  };
  store.programs = { p1: { program_name: "Institute of Chartered Accountants of Nigeria (ICAN)" }, p2: { program_name: "ACCA" } };
  store.gamification = {
    g1: { program_id: "p1", status: 1, question: "2+2?", options: [{ option1: "3" }, { option2: "4" }], questionAnswer: "option2" },
    g2: { program_id: "p1", status: 1, question: "Capital?", options: [{ option1: "A" }, { option2: "B" }, { option3: "C" }], questionAnswer: 2 },
    g3: { program_id: "p1", status: 0, question: "Draft", options: [{ option1: "A" }, { option2: "B" }], questionAnswer: 1 },
    g4: { program_id: "p2", status: 1, question: "Other", options: [{ option1: "A" }, { option2: "B" }], questionAnswer: 1 },
  };
  users.u1 = { uid: "u1", email: "ada@x.com", displayName: "Ada", metadata: { creationTime: new Date(Date.now() - 400 * DAY).toUTCString() } };
  users.u2 = { uid: "u2", email: "bo@x.com", displayName: "Bo", metadata: { creationTime: new Date().toUTCString() } };
  users.u3 = { uid: "u3", email: "cy@x.com", displayName: "Cy", metadata: { creationTime: new Date().toUTCString() } };
  disc._resetCache();
}

(async () => {
  seed();

  /* notes & bookmarks */
  await test("notes are private per student and CRUD works", async () => {
    const made = ok(await call(sd.CreateNote, { uid: "u1", body: { courseId: "c1", text: " hello ", positionMs: 61000 } }));
    assert.strictEqual(made.code, 201);
    assert.strictEqual(made.body.data.text, "hello");
    const id = made.body.data.id;
    ok(await call(sd.UpdateNote, { uid: "u1", params: { id }, body: { text: "edited" } }));
    let list = ok(await call(sd.ListNotes, { uid: "u1", query: { courseId: "c1" } }));
    assert.deepStrictEqual(list.body.data.map((n) => n.text), ["edited"]);
    assert.strictEqual(list.body.data[0].positionMs, 61000);
    const other = ok(await call(sd.ListNotes, { uid: "u2", query: { courseId: "c1" } }));
    assert.strictEqual(other.body.data.length, 0);
    fails(await call(sd.UpdateNote, { uid: "u2", params: { id }, body: { text: "hack" } }), 404);
    ok(await call(sd.DeleteNote, { uid: "u1", params: { id } }));
    list = ok(await call(sd.ListNotes, { uid: "u1", query: { courseId: "c1" } }));
    assert.strictEqual(list.body.data.length, 0);
  });
  await test("empty notes are rejected", async () => {
    fails(await call(sd.CreateNote, { uid: "u1", body: { courseId: "c1", text: "   " } }), 400);
  });
  await test("bookmarks round-trip and de-duplicate", async () => {
    ok(await call(sd.SetBookmarks, { uid: "u1", body: { courseIds: ["c1", "c2", "c1"] } }));
    const got = ok(await call(sd.GetBookmarks, { uid: "u1" }));
    assert.deepStrictEqual(got.body.data, ["c1", "c2"]);
  });

  /* progress & achievements */
  await test("progress only for owned courses and real lessons", async () => {
    fails(await call(sd.MarkLessonComplete, { uid: "u2", body: { courseId: "c1", moduleId: "m1" } }), 403);
    fails(await call(sd.MarkLessonComplete, { uid: "u1", body: { courseId: "c1", moduleId: "nope" } }), 404);
    const half = ok(await call(sd.MarkLessonComplete, { uid: "u1", body: { courseId: "c1", moduleId: "m1" } }));
    assert.strictEqual(half.body.data.percentage, 50);
    const again = ok(await call(sd.MarkLessonComplete, { uid: "u1", body: { courseId: "c1", moduleId: "m1" } }));
    assert.strictEqual(again.body.data.percentage, 50, "watching twice does not double count");
    const full = ok(await call(sd.MarkLessonComplete, { uid: "u1", body: { courseId: "c1", moduleId: "m2" } }));
    assert.strictEqual(full.body.data.percentage, 100);
  });
  await test("a finished course shows up as an achievement", async () => {
    const a = ok(await call(sd.Achievements, { uid: "u1" }));
    assert.strictEqual(a.body.data.courses.length, 1);
    assert.match(a.body.data.courses[0].text, /Completed Audit/);
  });

  /* orders & receipts */
  await test("students see only their own orders, with course titles", async () => {
    const o = ok(await call(sd.MyOrders, { uid: "u1" }));
    assert.strictEqual(o.body.data.length, 1);
    assert.strictEqual(o.body.data[0].courses[0].title, "Audit");
  });
  await test("receipts are private and escape their contents", async () => {
    store.courses.c1.title = "<script>x</script>";
    const r = ok(await call(sd.Receipt, { uid: "u1", params: { reference: "r1" } }));
    assert.match(r.body, /Payment receipt/);
    assert(!r.body.includes("<script>x"), "course title must be escaped");
    fails(await call(sd.Receipt, { uid: "u2", params: { reference: "r1" } }), 404);
    ok(await call(sd.Receipt, { uid: "staff", role: "admin", params: { reference: "r1" } }));
    store.courses.c1.title = "Audit";
  });

  /* home sections */
  await test("home sections hide unpublished courses and rank by enrolments", async () => {
    const s = ok(await call(disc.CourseSections, {}));
    assert(!s.body.data.trending.includes("c3"));
    assert.strictEqual(s.body.data.trending[0], "c1");
    assert.strictEqual(s.body.data.newest[0], "c2");
  });
  await test("recommendations skip courses the student already owns", async () => {
    const s = ok(await call(disc.CourseSections, { uid: "u1" }));
    assert(!s.body.data.recommended.includes("c1"));
    assert.strictEqual(s.body.data.recommended[0], "c2");
  });

  /* quiz */
  await test("answer formats from the dashboard are normalised", () => {
    assert.strictEqual(quiz._answerIndex("option3", 4), 2);
    assert.strictEqual(quiz._answerIndex(2, 4), 2);
    assert.strictEqual(quiz._answerIndex("option9", 4), null);
  });
  await test("questions: only published ones for the chosen programme", async () => {
    const q = ok(await call(quiz.GetQuestions, { uid: "u1", query: { program: "ICAN" } }));
    const ids = q.body.data.map((x) => x.id).sort();
    assert.deepStrictEqual(ids, ["g1", "g2"]);
    const g1 = q.body.data.find((x) => x.id === "g1");
    assert.deepStrictEqual(g1.options, ["3", "4"]);
    assert.deepStrictEqual(g1.correctOptions, [1]);
  });
  await test("points come from correct answers, not from the client", async () => {
    const r = ok(await call(quiz.SubmitResult, { uid: "u1", body: { program: "ICAN", correct: 99, total: 2, points: 100000, opponentPoints: 8 } }));
    assert.strictEqual(r.body.data.correct, 2);
    assert.strictEqual(r.body.data.points, 16);
    assert.strictEqual(r.body.data.won, true);
  });
  await test("leaderboard ranks by points and marks the caller", async () => {
    ok(await call(quiz.SubmitResult, { uid: "u2", user: { name: "Bo" }, body: { program: "ICAN", correct: 1, total: 2 } }));
    const l = ok(await call(quiz.Leaderboard, { uid: "u2", query: { period: "weekly" } }));
    assert.deepStrictEqual(l.body.data.entries.map((e) => e.uid), ["u1", "u2"]);
    assert.strictEqual(l.body.data.me.rank, 2);
  });
  await test("a won challenge shows up as an achievement", async () => {
    const a = ok(await call(sd.Achievements, { uid: "u1" }));
    assert.strictEqual(a.body.data.challenges.length, 1);
  });
  await test("two students are matched and see each other's scores", async () => {
    const first = ok(await call(quiz.FindMatch, { uid: "u1", body: { program: "ICAN" } }));
    assert.strictEqual(first.body.data.status, "waiting");
    const second = ok(await call(quiz.FindMatch, { uid: "u2", user: { name: "Bo" }, body: { program: "ICAN" } }));
    assert.strictEqual(second.body.data.id, first.body.data.id);
    assert.strictEqual(second.body.data.status, "active");
    assert.strictEqual(second.body.data.opponent.name, "Ada");
    const id = first.body.data.id;
    ok(await call(quiz.UpdateScore, { uid: "u1", params: { id }, body: { correct: 1 } }));
    const view = ok(await call(quiz.GetMatch, { uid: "u2", params: { id } }));
    assert.strictEqual(view.body.data.opponent.points, 8);
    fails(await call(quiz.GetMatch, { uid: "u3", params: { id } }), 404);
    const res = ok(await call(quiz.SubmitResult, { uid: "u2", body: { program: "ICAN", correct: 2, total: 2, opponentType: "real", opponentPoints: 0, matchId: id } }));
    assert.strictEqual(res.body.data.opponentPoints, 8, "opponent score comes from the match");
    assert.strictEqual(res.body.data.opponentName, "Ada");
  });
  await test("no match without questions", async () => {
    fails(await call(quiz.FindMatch, { uid: "u1", body: { program: "CIMA" } }), 404);
  });

  /* referrals */
  await test("invite links parse; foreign hosts do not", () => {
    assert.strictEqual(ref._referrerFrom("https://excelacademyonline.com/invite/u1"), "u1");
    assert.strictEqual(ref._referrerFrom("https://evil.com/invite/u1"), null);
  });
  await test("self-referral, old accounts and unknown referrers are refused", async () => {
    fails(await call(ref.ClaimReferral, { uid: "u2", body: { link: "https://excelacademyonline.com/invite/u2" } }), 400);
    fails(await call(ref.ClaimReferral, { uid: "u1", body: { link: "https://excelacademyonline.com/invite/u2" } }), 400);
    fails(await call(ref.ClaimReferral, { uid: "u2", body: { link: "https://excelacademyonline.com/invite/ghost123" } }), 404);
  });
  await test("a referral pays nothing until the friend buys, then pays once", async () => {
    ok(await call(ref.ClaimReferral, { uid: "u2", body: { link: "https://excelacademyonline.com/invite/u1" } }));
    fails(await call(ref.ClaimReferral, { uid: "u2", body: { link: "https://excelacademyonline.com/invite/u1" } }), 409);
    let s = ok(await call(ref.Stats, { uid: "u1", query: { period: "week" } }));
    assert.strictEqual(s.body.data.referrals, 1);
    assert.strictEqual(s.body.data.points, 0);
    await ref.creditReferral("u2");
    await ref.creditReferral("u2");
    s = ok(await call(ref.Stats, { uid: "u1", query: { period: "allTime" } }));
    assert.strictEqual(s.body.data.points, 800);
    assert.strictEqual(s.body.data.totalEarnedNaira, 4000);
    assert.strictEqual(s.body.data.claimableNaira, 4000);
  });
  await test("payout needs bank details and reserves the points", async () => {
    fails(await call(ref.RequestPayout, { uid: "u1" }), 400);
    fails(await call(ref.SetBank, { uid: "u1", body: { accountNumber: "123", bankName: "GTB", accountName: "Ada" } }), 400);
    ok(await call(ref.SetBank, { uid: "u1", body: { accountNumber: "0123456789", bankName: "GTB", accountName: "Ada" } }));
    const p = ok(await call(ref.RequestPayout, { uid: "u1" }));
    assert.strictEqual(p.body.data.amountNaira, 4000);
    fails(await call(ref.RequestPayout, { uid: "u1" }), 409);
    const s = ok(await call(ref.Stats, { uid: "u1", query: { period: "allTime" } }));
    assert.strictEqual(s.body.data.points, 0);
  });
  await test("rejecting a payout gives the points back; decisions are final", async () => {
    const id = Object.keys(store.payouts)[0];
    ok(await call(ref.AdminDecidePayout, { uid: "staff", role: "admin", params: { id }, body: { status: "rejected" } }));
    fails(await call(ref.AdminDecidePayout, { uid: "staff", role: "admin", params: { id }, body: { status: "paid" } }), 409);
    const s = ok(await call(ref.Stats, { uid: "u1", query: { period: "allTime" } }));
    assert.strictEqual(s.body.data.points, 800);
  });

  /* reviews & quiz stats */
  await test("only enrolled students can review; posting again edits", async () => {
    fails(await call(rev.SaveReview, { uid: "u2", params: { courseId: "c1" }, body: { rating: 5, text: "Great" } }), 403);
    fails(await call(rev.SaveReview, { uid: "u1", params: { courseId: "c1" }, body: { rating: 9, text: "Great" } }), 400);
    const first = ok(await call(rev.SaveReview, { uid: "u1", params: { courseId: "c1" }, body: { rating: 4, text: "Great" } }));
    assert.strictEqual(first.code, 201);
    const again = ok(await call(rev.SaveReview, { uid: "u1", params: { courseId: "c1" }, body: { rating: 2, text: "Changed my mind" } }));
    assert.strictEqual(again.code, 200);
    const list = ok(await call(rev.ListReviews, { uid: "u1", params: { courseId: "c1" } }));
    assert.strictEqual(list.body.data.count, 1);
    assert.strictEqual(list.body.data.average, 2);
    assert.strictEqual(list.body.data.mine.text, "Changed my mind");
  });
  await test("students can't delete other people's reviews", async () => {
    fails(await call(rev.DeleteReview, { uid: "u2", params: { courseId: "c1", uid: "u1" } }), 403);
    ok(await call(rev.DeleteReview, { uid: "staff", role: "admin", params: { courseId: "c1", uid: "u1" } }));
  });
  await test("quiz stats count only the caller's games", async () => {
    const me = ok(await call(quiz.MyStats, { uid: "u1" }));
    assert.strictEqual(me.body.data.games, 1);
    assert.strictEqual(me.body.data.bestScore, 16);
    assert.strictEqual(me.body.data.rank, 2, "u2 scored more earlier in this run");
    const nobody = ok(await call(quiz.MyStats, { uid: "u3" }));
    assert.strictEqual(nobody.body.data.games, 0);
    assert.strictEqual(nobody.body.data.rank, null);
  });

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  process.exit(passed === results.length ? 0 : 1);
})();
