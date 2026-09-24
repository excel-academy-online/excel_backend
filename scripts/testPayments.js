#!/usr/bin/env node
/**
 * Tests for the app-facing course shape and the Paystack purchase flow.
 *
 *   npm run test:payments
 *
 * Firestore and Paystack are stubbed - no credentials, no network, no money.
 */
const assert = require("assert");
const crypto = require("crypto");
const Module = require("module");
const path = require("path");

const results = [];
const test = (name, fn) =>
  Promise.resolve().then(fn)
    .then(() => { results.push(true); console.log(`PASS  ${name}`); })
    .catch((e) => { results.push(false); console.log(`FAIL  ${name}\n      ${e.message}`); });

/* ------------------------------------------------------------ stubs */

const store = { courses: {}, enrollments: {}, payments: {}, orders: {} };
const reset = () => {
  store.courses = {
    "wp-21": { title: "ICAN ATS 2", price: "12000", status: 1, lesson: [
      { id: "s1", session_name: "C1 Data", content: [
        { id: "i1", title: "(a) Data", medias: [{ type: "video", url: "https://v/a.mp4" }] },
        { id: "i2", title: "(b) Info", medias: [] } ] } ] },
    "wp-43": { title: "Financial Reporting", price: "8,000", status: 1, lesson: [] },
    "wp-99": { title: "Free thing", price: "", status: 1, lesson: [] },
  };
  store.enrollments = {}; store.payments = {}; store.orders = {};
};

const docRef = (col, id) => ({
  id, _col: col,
  async get() { const d = store[col][id]; return { exists: !!d, id, data: () => d }; },
  async set(data, opts) { store[col][id] = opts && opts.merge ? { ...(store[col][id] || {}), ...data } : { ...data }; },
});
const db = {
  collection: (col) => ({
    doc: (id) => docRef(col, id),
    where(f1, _o, v1) {
      const conds = [[f1, v1]];
      const q = {
        where(f, _o2, v) { conds.push([f, v]); return q; },
        limit() { return q; },
        async get() {
          const docs = Object.entries(store[col]).filter(([, d]) => conds.every(([f, v]) => d[f] === v))
            .map(([id, d]) => ({ id, data: () => d }));
          return { empty: !docs.length, docs };
        },
      };
      return q;
    },
  }),
  async getAll(...refs) { return refs.map((r) => ({ exists: !!store[r._col][r.id], id: r.id, data: () => store[r._col][r.id] })); },
  batch() {
    const ops = [];
    return { set: (r, d, o) => ops.push([r, d, o]), async commit() { for (const [r, d, o] of ops) await r.set(d, o); } };
  },
};

let paystackVerify = { status: "success", amount: 1200000, currency: "NGN" };
const axiosStub = {
  create: () => ({
    async post(url, body) { axiosStub.lastInit = body; return { data: { data: { authorization_url: "https://checkout/x", access_code: "ac" } } }; },
    async get() { return { data: { data: paystackVerify } }; },
  }),
};

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req.indexOf("firebaseadminvar") !== -1) return { db, admin: {}, auth: {}, bucket: {}, firebaseConfig: {} };
  if (req === "axios") return axiosStub;
  return origLoad.call(this, req, parent, isMain);
};
process.env.PAYSTACK_SECRET_KEY = "sk_test_secret";

const ctl = require(path.join(__dirname, "..", "controllers", "payment.controller.js"));
const { legacyCourse } = require(path.join(__dirname, "..", "utils", "legacyCourseShape.js"));

const run = (fn, req) => new Promise((resolve) => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; resolve({ r, err: null }); return r; };
  fn(req, r, (err) => resolve({ r, err }));
});
const student = (uid, email = `${uid}@x.com`) => ({ uid, user: { email }, role: "student" });

/* ------------------------------------------------------------ tests */

(async () => {
  reset();

  // ---- the shape the Flutter models parse -------------------------------
  await test("legacy shape has every field the app's fromJson reads", () => {
    const c = legacyCourse({ _id: "wp-21", ...store.courses["wp-21"] });
    for (const k of ["_id", "title", "creator", "description", "thumbnail", "price", "lessons", "subscribers"])
      assert.ok(k in c, `missing ${k}`);
    assert.strictEqual(typeof c.price, "number", "app declares price as int");
    assert.ok(Array.isArray(c.subscribers));
    const m = c.lessons[0].modules[0];
    for (const k of ["_id", "module_name", "firebase_id", "subscriptionRequired"]) assert.ok(k in m, `module missing ${k}`);
    assert.strictEqual(c.lessons[0].lesson_name, "C1 Data");
  });

  await test("prices with commas or blanks become safe integers", () => {
    assert.strictEqual(legacyCourse(store.courses["wp-43"]).price, 8000);
    assert.strictEqual(legacyCourse(store.courses["wp-99"]).price, 0);
  });

  await test("non-owners never receive video URLs", () => {
    const c = legacyCourse(store.courses["wp-21"], { owned: false });
    assert.strictEqual(c.lessons[0].modules[0].firebase_id, "");
    assert.strictEqual(c.lessons[0].modules[0].subscriptionRequired, true);
  });

  await test("owners receive the playable URL", () => {
    const c = legacyCourse(store.courses["wp-21"], { owned: true });
    assert.strictEqual(c.lessons[0].modules[0].firebase_id, "https://v/a.mp4");
    assert.strictEqual(c.lessons[0].modules[0].subscriptionRequired, false);
  });

  // ---- initialise --------------------------------------------------------
  await test("price is computed from Firestore, not taken from the client", async () => {
    const { err, r } = await run(ctl.InitializePayment,
      { ...student("u1"), body: { courseIds: ["wp-21", "wp-43"], amount: 1 } });
    assert.ok(!err, err && err.message);
    assert.strictEqual(r.body.data.amount, 20000);
    assert.strictEqual(axiosStub.lastInit.amount, "2000000", "kobo sent to Paystack");
  });

  await test("the buyer email comes from the token, never the body", async () => {
    await run(ctl.InitializePayment, { ...student("u2", "real@x.com"),
      body: { email: "azag@gmail.com", metadata: { cart_id: ["wp-21"], user_id: "6599b3ffcb35baa479a98db8" } } });
    assert.strictEqual(axiosStub.lastInit.email, "real@x.com");
    assert.strictEqual(axiosStub.lastInit.metadata.uid, "u2");
  });

  await test("the old app's { metadata: { cart_id } } body still works", async () => {
    const { err, r } = await run(ctl.InitializePayment, { ...student("u3"), body: { metadata: { cart_id: ["wp-21"] } } });
    assert.ok(!err, err && err.message);
    assert.strictEqual(r.body.data.amount, 12000);
  });

  await test("a pending payment is recorded before Paystack is called", () => {
    const pending = Object.values(store.payments).filter((p) => p.uid === "u3");
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].status, "pending");
  });

  await test("unknown courses are rejected", async () => {
    const { err } = await run(ctl.InitializePayment, { ...student("u4"), body: { courseIds: ["nope"] } });
    assert.ok(err && err.statusCode === 404);
  });

  await test("courses with no price cannot be bought for free", async () => {
    const { err } = await run(ctl.InitializePayment, { ...student("u4"), body: { courseIds: ["wp-99"] } });
    assert.ok(err && err.statusCode === 400);
  });

  // ---- verify ------------------------------------------------------------
  const refOf = (uid) => Object.values(store.payments).find((p) => p.uid === uid).reference;

  await test("successful verification enrols the student", async () => {
    paystackVerify = { status: "success", amount: 1200000, currency: "NGN" };
    const ref = refOf("u3");
    const { err, r } = await run(ctl.VerifyPayment, { ...student("u3"), params: { reference: ref } });
    assert.ok(!err, err && err.message);
    assert.strictEqual(r.code, 200);
    const e = store.enrollments["u3_wp-21"];
    assert.ok(e && e.status === "active" && e.student_id === "u3");
    assert.strictEqual(e.progress.total_lessons, 2);
    assert.ok(store.orders[ref], "order recorded");
  });

  await test("verifying twice is harmless", async () => {
    const before = Object.keys(store.enrollments).length;
    const { err, r } = await run(ctl.VerifyPayment, { ...student("u3"), params: { reference: refOf("u3") } });
    assert.ok(!err);
    assert.match(r.body.message, /already/);
    assert.strictEqual(Object.keys(store.enrollments).length, before);
  });

  await test("nobody can verify someone else's payment", async () => {
    const { err } = await run(ctl.VerifyPayment, { ...student("thief"), params: { reference: refOf("u1") } });
    assert.ok(err && err.statusCode === 403);
  });

  await test("an underpaid transaction does NOT enrol", async () => {
    paystackVerify = { status: "success", amount: 100, currency: "NGN" };
    const { err } = await run(ctl.VerifyPayment, { ...student("u1"), params: { reference: refOf("u1") } });
    assert.ok(err && err.statusCode === 400, "expected amount mismatch");
    assert.ok(!store.enrollments["u1_wp-21"]);
  });

  await test("an abandoned payment does NOT enrol", async () => {
    paystackVerify = { status: "abandoned", amount: 1200000, currency: "NGN" };
    const { err } = await run(ctl.VerifyPayment, { ...student("u2"), params: { reference: refOf("u2") } });
    assert.ok(err && err.statusCode === 402);
    assert.ok(!store.enrollments["u2_wp-21"]);
  });

  await test("already-owned courses are not charged again", async () => {
    const { err } = await run(ctl.InitializePayment, { ...student("u3"), body: { courseIds: ["wp-21"] } });
    assert.ok(err && err.statusCode === 409);
  });

  // ---- webhook -----------------------------------------------------------
  const sign = (raw) => crypto.createHmac("sha512", "sk_test_secret").update(raw).digest("hex");

  await test("webhook with a forged signature is rejected", async () => {
    const raw = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: refOf("u2") } }));
    const { r } = await run(ctl.PaystackWebhook, { headers: { "x-paystack-signature": "f".repeat(128) }, rawBody: raw, body: JSON.parse(raw) });
    assert.strictEqual(r.code, 401);
    assert.ok(!store.enrollments["u2_wp-21"]);
  });

  await test("a signed webhook enrols even if the app never verified", async () => {
    const data = { reference: refOf("u2"), status: "success", amount: 1200000, currency: "NGN" };
    const raw = Buffer.from(JSON.stringify({ event: "charge.success", data }));
    const { r } = await run(ctl.PaystackWebhook, { headers: { "x-paystack-signature": sign(raw) }, rawBody: raw, body: JSON.parse(raw) });
    assert.strictEqual(r.code, 200);
    assert.ok(store.enrollments["u2_wp-21"], "webhook should have enrolled u2");
  });

  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})();
