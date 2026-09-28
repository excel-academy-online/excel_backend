/**
 * Mock exam controller against an in-memory Firestore stand-in.
 * No credentials or network needed.
 */
const assert = require("assert");
const Module = require("module");

const store = { mockExams: {}, mockAttempts: {}, enrollments: {} };

const docRef = (col, id) => ({
  id,
  async get() {
    const v = store[col][id];
    return { id, exists: v !== undefined, data: () => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))) };
  },
  async set(val, opts) {
    store[col][id] = opts && opts.merge ? { ...(store[col][id] || {}), ...JSON.parse(JSON.stringify(val)) } : JSON.parse(JSON.stringify(val));
  },
});
const db = {
  collection: (col) => ({
    doc: (id) => docRef(col, id),
    where: (field, op, value) => ({
      async get() {
        const docs = Object.entries(store[col])
          .filter(([, v]) => v[field] === value)
          .map(([id, v]) => ({ id, data: () => v }));
        return { docs, size: docs.length };
      },
    }),
  }),
  getAll: async (...refs) => Promise.all(refs.map((r) => r.get())),
};

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req.indexOf("firebaseadminvar") !== -1) return { db, admin: {}, auth: {} };
  return origLoad.apply(this, arguments);
};
const m = require("../controllers/mockExam.controller");

function run(handler, req) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      json(body) { resolve({ r: { code: this.code, body } }); },
    };
    handler({ params: {}, body: {}, query: {}, ...req }, res, (err) => resolve({ err }));
  });
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("PASS ", name); }
  catch (e) { failed++; console.log("FAIL ", name, "\n     ", e.message); }
}

(async () => {
  store.mockExams.c1 = {
    courseId: "c1", title: "Tax mock", minutes: 10, level: "Skills", status: 1,
    questions: [
      { id: "q1", question: "1+1?", options: ["1", "2", "3", "4"], answer: 1, explanation: "Two." },
      { id: "q2", question: "2+2?", options: ["4", "5", "6", "7"], answer: 0, explanation: "Four." },
      { id: "q3", question: "3+3?", options: ["5", "6", "7", "8"], answer: 1, explanation: "Six." },
    ],
  };
  store.enrollments["u1_c1"] = { student_id: "u1", course_id: "c1", status: "active" };

  await test("a student who doesn't own the course can't start", async () => {
    const { err } = await run(m.Start, { uid: "u2", params: { courseId: "c1" } });
    assert.ok(err && err.statusCode === 403);
  });

  let started;
  await test("starting sends questions without answers", async () => {
    const { err, r } = await run(m.Start, { uid: "u1", params: { courseId: "c1" } });
    assert.ok(!err, err && err.message);
    started = r.body.data;
    assert.strictEqual(started.questions.length, 3);
    assert.strictEqual(started.remainingSec, 600);
    assert.ok(started.questions.every((q) => q.answer === undefined && q.explanation === undefined));
  });

  await test("pausing saves answers and time; starting again resumes them", async () => {
    await run(m.Save, { uid: "u1", params: { courseId: "c1" }, body: { answers: { q1: 1, bogus: 2 }, remainingSec: 400 } });
    const { r } = await run(m.Start, { uid: "u1", params: { courseId: "c1" } });
    assert.deepStrictEqual(r.body.data.answers, { q1: 1 });
    assert.strictEqual(r.body.data.remainingSec, 400);
    assert.deepStrictEqual(r.body.data.questions.map((q) => q.id), started.questions.map((q) => q.id));
  });

  await test("time left can't be wound back up", async () => {
    await run(m.Save, { uid: "u1", params: { courseId: "c1" }, body: { answers: { q1: 1 }, remainingSec: 9999 } });
    const { r } = await run(m.GetOne, { uid: "u1", params: { courseId: "c1" } });
    assert.strictEqual(r.body.data.remainingSec, 400);
    assert.strictEqual(r.body.data.inProgress, true);
  });

  await test("submitting marks it: correct, incorrect, omitted, score, solutions", async () => {
    const { err, r } = await run(m.Submit, { uid: "u1", params: { courseId: "c1" }, body: { answers: { q2: 3 }, remainingSec: 300 } });
    assert.ok(!err, err && err.message);
    const d = r.body.data;
    assert.strictEqual(d.correct, 1);
    assert.strictEqual(d.incorrect, 1);
    assert.strictEqual(d.omitted, 1);
    assert.strictEqual(d.score, 33);
    assert.strictEqual(d.timeSpentSec, 300);
    assert.ok(d.review.every((q) => typeof q.answer === "number" && q.explanation));
  });

  await test("after submitting there's no attempt to continue; the list shows the score", async () => {
    const { err } = await run(m.Save, { uid: "u1", params: { courseId: "c1" }, body: { answers: {}, remainingSec: 1 } });
    assert.ok(err && err.statusCode === 409);
    const { r } = await run(m.ListMine, { uid: "u1" });
    assert.strictEqual(r.body.data.length, 1);
    assert.strictEqual(r.body.data[0].inProgress, false);
    assert.strictEqual(r.body.data[0].lastScore, 33);
    assert.strictEqual(r.body.data[0].attempts, 1);
  });

  await test("the last result can be read back for review", async () => {
    const { r } = await run(m.LastResult, { uid: "u1", params: { courseId: "c1" } });
    assert.strictEqual(r.body.data.score, 33);
  });

  await test("a course without a mock exam says so", async () => {
    const { err } = await run(m.GetOne, { uid: "u1", params: { courseId: "nope" } });
    assert.ok(err && err.statusCode === 404);
  });

  await test("a paused attempt can be discarded to start over", async () => {
    await run(m.Start, { uid: "u1", params: { courseId: "c1" } });
    await run(m.Discard, { uid: "u1", params: { courseId: "c1" } });
    const { r } = await run(m.GetOne, { uid: "u1", params: { courseId: "c1" } });
    assert.strictEqual(r.body.data.inProgress, false);
  });

  console.log(`\n${passed}/${passed + failed} checks passed.`);
  process.exit(failed ? 1 : 0);
})();
