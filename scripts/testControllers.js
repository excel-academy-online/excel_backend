#!/usr/bin/env node
/**
 * Regression tests for the controller bugs the dashboard hit while wiring up.
 *
 *   npm run test:controllers
 *
 * Firebase and Mongo are stubbed, so these need no credentials and no network.
 * Each test names the bug it guards against.
 */
const assert = require("assert");
const Module = require("module");
const path = require("path");

const results = [];
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { results.push(true); console.log(`PASS  ${name}`); })
    .catch((e) => { results.push(false); console.log(`FAIL  ${name}\n      ${e.message}`); });
}

/* ------------------------------------------------------------ stubbing */

const firestoreDocs = new Map();     // path -> data
const updates = [];
let customClaims = { role: "admin" };

function docRef(p) {
  return {
    _p: p,
    async get() { return { exists: firestoreDocs.has(p), data: () => firestoreDocs.get(p) }; },
  };
}

// The client SDK surface these controllers use.
const clientFirestore = {
  getFirestore: () => ({}),
  collection: (_db, name) => ({ _name: name }),
  doc: (a, b, c) => docRef(typeof b === "string" && c ? `${b}/${c}` : `${a?._name || "col"}/${b}`),
  getDoc: async (ref) => ({ exists: () => firestoreDocs.has(ref._p), data: () => firestoreDocs.get(ref._p) }),
  getDocs: async () => ({ empty: true, docs: [] }),
  setDoc: async () => {},
  addDoc: async () => ({ id: "new" }),
  updateDoc: async (ref, payload) => { updates.push({ path: ref._p, payload }); },
  query: () => ({}),
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  serverTimestamp: () => new Date(),
};

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  credential: { cert: () => ({}) },
  firestore: () => ({}),
  storage: () => ({ bucket: () => ({}) }),
  auth: () => ({
    verifyIdToken: async () => ({ uid: "u", role: "admin" }),
    getUser: async () => ({ uid: "admin-1", customClaims }),
  }),
};

const cfg = { apiKey: "s", authDomain: "s.firebaseapp.com", projectId: "stub", storageBucket: "s.appspot.com", messagingSenderId: "1", appId: "1:1:web:1" };

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req.indexOf("firebaseadminvar") !== -1)
    return { admin: adminStub, serviceAccount: { project_id: "stub" }, firebaseConfig: cfg, db: {}, auth: adminStub.auth(), bucket: {} };
  if (req === "firebase-admin") return adminStub;
  if (req === "firebase/firestore") return clientFirestore;
  if (req === "firebase/app") return { initializeApp: () => ({}) };
  if (req === "firebase/storage") return { getStorage: () => ({}), ref: () => ({}), uploadBytesResumable: () => ({}), getDownloadURL: async () => "http://x" };
  return origLoad.call(this, req, parent, isMain);
};
Object.assign(process.env, cfg, { key: "0".repeat(64), iv: "0".repeat(32), Jwt_Secret_Key: "s" });

const res = () => {
  const r = { code: null, body: null, cookies: {}, cleared: [] };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.cookie = (k, v) => { r.cookies[k] = v; return r; };
  r.clearCookie = (k) => { r.cleared.push(k); return r; };
  return r;
};
const run = (fn, req) =>
  new Promise((resolve) => {
    const r = res();
    fn(req, r, (err) => resolve({ err, r }));
    setTimeout(() => resolve({ err: null, r }), 60);
  });

/* -------------------------------------------------------------- tests */

(async () => {
  const gam = require(path.join(__dirname, "..", "controllers", "gamification.controller.js"));
  const usr = require(path.join(__dirname, "..", "controllers", "user.controller.js"));

  // BUG: JSON.parse() ran on an already-parsed array, so every valid JSON
  // request was rejected before any work happened.
  await test("bulk questions: a normal JSON array is not rejected outright", async () => {
    const { err } = await run(gam.createMultipleGamificationQst, {
      body: { questions: [{ question: "1+1?", options: ["1", "2"], answer: "2" }] },
      files: [],
    });
    if (err) assert.ok(!/not valid JSON|must be an array/i.test(err.message), `rejected with: ${err.message}`);
  });

  await test("bulk questions: a JSON string body still works (multipart clients)", async () => {
    const { err } = await run(gam.createMultipleGamificationQst, {
      body: { questions: JSON.stringify([{ question: "1+1?", options: ["1", "2"], answer: "2" }]) },
      files: [],
    });
    if (err) assert.ok(!/not valid JSON|must be an array/i.test(err.message), `rejected with: ${err.message}`);
  });

  await test("bulk questions: genuinely broken JSON is still rejected", async () => {
    const { err } = await run(gam.createMultipleGamificationQst, { body: { questions: "{oops" }, files: [] });
    assert.ok(err && /not valid JSON/i.test(err.message), "should reject malformed JSON");
  });

  await test("bulk questions: an empty array is still rejected", async () => {
    const { err } = await run(gam.createMultipleGamificationQst, { body: { questions: [] }, files: [] });
    assert.ok(err && /at least one/i.test(err.message));
  });

  // BUG: only "activate"/"deactivate" were accepted, so the dashboard's
  // natural payloads ("active", true) were rejected.
  firestoreDocs.set("users/student-1", { status: 1 });
  for (const [value, expect] of [["activate", 1], ["active", 1], [true, 1], ["deactivate", 0], ["inactive", 0], [false, 0]]) {
    await test(`toggleUserStatus accepts ${JSON.stringify(value)} -> ${expect}`, async () => {
      updates.length = 0;
      const { err } = await run(usr.toggleUserStatus, { body: { user_id: "student-1", status: value } });
      assert.ok(!err, err && err.message);
      assert.strictEqual(updates.at(-1)?.payload.status, expect);
    });
  }

  await test("toggleUserStatus still rejects nonsense", async () => {
    const { err } = await run(usr.toggleUserStatus, { body: { user_id: "student-1", status: "banana" } });
    assert.ok(err && /Invalid status/i.test(err.message));
  });

  // BUG: AdminLogin read the admin flag but never enforced it, so any student
  // with a valid password was handed an admin session.
  await test("AdminLogin exports an admin check (non-admins must be refused)", async () => {
    const src = require("fs").readFileSync(path.join(__dirname, "..", "controllers", "admin.controller.js"), "utf8");
    assert.ok(/assertAdmin/.test(src), "assertAdmin helper missing");
    assert.ok(/does not have administrator access/.test(src), "no 403 for non-admins");
    assert.ok(/clearCookie\("access_token"\)/.test(src), "session cookie not cleared when refused");
  });

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})();
