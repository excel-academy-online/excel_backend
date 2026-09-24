#!/usr/bin/env node
/**
 * Tests for restoring pre-migration purchases.
 *
 *   npm run test:recovery
 *
 * Firestore is stubbed. The rule that matters: the email is taken from the
 * verified token, so nobody can claim someone else's courses by asking.
 */
const assert = require("assert");
const Module = require("module");
const path = require("path");

const results = [];
const test = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(() => { results.push(true); console.log(`PASS  ${name}`); })
    .catch((e) => { results.push(false); console.log(`FAIL  ${name}\n      ${e.message}`); });

/* ---------------------------------------------------------- stub */

const store = {
  studentRecovery: {
    ada_example_com: { email: "ada@example.com", courseIds: ["wp-21", "wp-43", "wp-gone"], orderIds: ["214"] },
    taken_example_com: { email: "taken@example.com", courseIds: ["wp-21"], claimedByUid: "someone-else", claimedAt: "2026-01-01" },
    nocourses_example_com: { email: "nocourses@example.com", courseIds: ["wp-gone"] },
  },
  courses: {
    "wp-21": { title: "ICAN ATS 2 - Information Technology", programId: "ICAN", lesson: [{ content: [{}, {}] }, { content: [{}] }], quiz: [{}] },
    "wp-43": { title: "ICAN Financial Reporting", programId: "ICAN", lesson: [{ content: [{}] }] },
  },
  enrollments: {},
};

const ref = (col, id) => ({
  id,
  _col: col,
  async get() { return { exists: !!store[col][id], id, ref: ref(col, id), data: () => store[col][id] }; },
});

const db = {
  collection: (col) => ({ doc: (id) => ref(col, id) }),
  async getAll(...refs) {
    return refs.map((r) => ({ exists: !!store[r._col][r.id], id: r.id, data: () => store[r._col][r.id] }));
  },
  batch() {
    const ops = [];
    return {
      set(r, data, opts) { ops.push([r, data, opts]); },
      async commit() {
        for (const [r, data, opts] of ops) {
          const existing = (opts && opts.merge && store[r._col][r.id]) || {};
          store[r._col][r.id] = { ...existing, ...data };
        }
      },
    };
  },
};

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req.indexOf("firebaseadminvar") !== -1) return { db, admin: {}, auth: {}, bucket: {}, firebaseConfig: {}, serviceAccount: {} };
  return origLoad.call(this, req, parent, isMain);
};

const rec = require(path.join(__dirname, "..", "controllers", "recovery.controller.js"));

const run = (fn, req) =>
  new Promise((resolve) => {
    const r = { code: null, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; resolve({ r, err: null }); return r; };
    fn(req, r, (err) => resolve({ r, err }));
  });

const as = (uid, email) => ({ uid, user: { email }, role: "student" });

/* --------------------------------------------------------- tests */

(async () => {
  await test("a returning student sees what is waiting for them", async () => {
    const { err, r } = await run(rec.CheckRecovery, as("uid-ada", "ada@example.com"));
    assert.ok(!err, err && err.message);
    assert.strictEqual(r.body.data.found, true);
    // wp-gone no longer exists and must not be offered.
    assert.strictEqual(r.body.data.courses.length, 2);
    assert.strictEqual(r.body.data.claimed, false);
  });

  await test("email is matched case-insensitively", async () => {
    const { r } = await run(rec.CheckRecovery, as("uid-ada", "ADA@Example.com "));
    assert.strictEqual(r.body.data.found, true);
  });

  await test("someone with no history gets a clean answer, not an error", async () => {
    const { err, r } = await run(rec.CheckRecovery, as("uid-new", "new@example.com"));
    assert.ok(!err);
    assert.strictEqual(r.body.data.found, false);
  });

  await test("claiming restores the courses that still exist", async () => {
    const { err, r } = await run(rec.ClaimRecovery, as("uid-ada", "ada@example.com"));
    assert.ok(!err, err && err.message);
    assert.strictEqual(r.body.data.restored.length, 2);
    const e = store.enrollments["uid-ada_wp-21"];
    assert.ok(e, "enrolment not created");
    assert.strictEqual(e.student_id, "uid-ada");
    assert.strictEqual(e.status, "active");
    assert.strictEqual(e.program_id, "ICAN");
    assert.strictEqual(e.progress.total_lessons, 3, "lesson total should count items across sessions");
    assert.strictEqual(e.progress.total_quizzes, 1);
  });

  await test("the record is marked as claimed", () => {
    assert.strictEqual(store.studentRecovery.ada_example_com.claimedByUid, "uid-ada");
  });

  await test("claiming twice does not create duplicate enrolments", async () => {
    const before = Object.keys(store.enrollments).length;
    const { err } = await run(rec.ClaimRecovery, as("uid-ada", "ada@example.com"));
    assert.ok(!err, err && err.message);
    assert.strictEqual(Object.keys(store.enrollments).length, before);
  });

  await test("a different account CANNOT claim purchases already restored", async () => {
    const { err } = await run(rec.ClaimRecovery, as("uid-thief", "taken@example.com"));
    assert.ok(err && err.statusCode === 409, "expected 409, got " + (err && err.statusCode));
  });

  await test("the email comes from the token, so a forged body changes nothing", async () => {
    const req = { ...as("uid-thief", "thief@example.com"), body: { email: "ada@example.com" } };
    const { r } = await run(rec.CheckRecovery, req);
    assert.strictEqual(r.body.data.found, false, "body email must be ignored");
  });

  await test("an account with no email is rejected", async () => {
    const { err } = await run(rec.CheckRecovery, { uid: "x", user: {} });
    assert.ok(err && err.statusCode === 400);
  });

  await test("a record whose courses have all gone returns 404 on claim", async () => {
    const { err } = await run(rec.ClaimRecovery, as("uid-n", "nocourses@example.com"));
    assert.ok(err && err.statusCode === 404);
  });

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})();
