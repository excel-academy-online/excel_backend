#!/usr/bin/env node
/**
 * Tests for in-app notifications, device tokens, broadcasts and push.
 *
 *   npm run test:notifications
 *
 * Firestore, Auth and FCM are replaced by in-memory fakes.
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
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function snapOf(colPath, id, d) {
  return { id, exists: d !== undefined, ref: docRef(colPath, id), data: () => (d === undefined ? undefined : JSON.parse(JSON.stringify(d))) };
}
function query(colPath, conds = [], order = null, max = Infinity) {
  const run = () => {
    let docs = Object.entries(colOf(colPath))
      .filter(([, d]) => conds.every(([f, op, v]) => (op === "==" ? d[f] === v : false)))
      .map(([id, d]) => snapOf(colPath, id, d));
    if (order) docs.sort((a, b) => (order[1] === "desc" ? -1 : 1) * cmp(a.data()[order[0]], b.data()[order[0]]));
    return docs.slice(0, max);
  };
  return {
    where: (f, op, v) => query(colPath, [...conds, [f, op, v]], order, max),
    orderBy: (f, dir) => query(colPath, conds, [f, dir], max),
    limit: (n) => query(colPath, conds, order, n),
    async get() { const docs = run(); return { empty: !docs.length, docs }; },
  };
}
const INC = Symbol("inc");
function merge(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) {
    if (v && v[INC] !== undefined) out[k] = (out[k] || 0) + v[INC];
    else if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object") out[k] = merge(out[k], v);
    else out[k] = v;
  }
  return out;
}
function docRef(colPath, id) {
  return {
    id,
    async get() { return snapOf(colPath, id, colOf(colPath)[id]); },
    async set(data, opts) { const c = colOf(colPath); c[id] = opts && opts.merge ? merge(c[id], data) : merge({}, data); },
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
  batch() { const ops = []; return { set: (r, d, o) => ops.push([r, d, o]), async commit() { for (const [r, d, o] of ops) await r.set(d, o); } }; },
  async runTransaction(fn) { return fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o) }); },
};

/* ------------------------------------------------ fake auth and FCM */

const users = {};
const sent = { multicast: [], topic: [] };
let deadTokens = new Set();
const fakeMessaging = {
  async sendEachForMulticast(msg) {
    sent.multicast.push(msg);
    const responses = msg.tokens.map((t) => deadTokens.has(t)
      ? { success: false, error: { code: "messaging/registration-token-not-registered" } }
      : { success: true });
    return { responses, successCount: responses.filter((r) => r.success).length };
  },
  async send(msg) { sent.topic.push(msg); return "msg-id"; },
};
const admin = {
  auth: () => ({ async getUser(uid) { if (!users[uid]) throw new Error("no user"); return users[uid]; } }),
  messaging: () => fakeMessaging,
  firestore: { FieldValue: { serverTimestamp: () => new Date().toISOString(), increment: (n) => ({ [INC]: n }) } },
};

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req.indexOf("firebaseadminvar") !== -1) return { db, admin, auth: {}, bucket: {}, firebaseConfig: {} };
  return origLoad.call(this, req, parent, isMain);
};

const ctl = (f) => require(path.join(__dirname, "..", "controllers", f));
const notif = ctl("notification.controller.js");
const chat = ctl("chat.controller.js");

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      json(body) { resolve({ code: this.code, body }); },
    };
    handler({ query: {}, params: {}, body: {}, role: "student", user: { name: "Ada", email: "ada@x.com" }, ...req }, res, (error) => resolve({ error }));
  });
}
const ok = (r) => { if (r.error) throw r.error; return r; };
const fails = (r, code) => { assert(r.error, "expected an error"); assert.strictEqual(r.error.statusCode, code, r.error.message); };
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const DAY = 86400000;

(async () => {
  users.u1 = { uid: "u1", metadata: { creationTime: new Date(Date.now() - 10 * DAY).toUTCString() } };
  users.u2 = { uid: "u2", metadata: { creationTime: new Date(Date.now() - 1 * DAY).toUTCString() } };

  await test("device tokens are stored once each, newest kept", async () => {
    ok(await call(notif.RegisterToken, { uid: "u1", body: { token: "t-old" } }));
    ok(await call(notif.RegisterToken, { uid: "u1", body: { token: "t-new" } }));
    ok(await call(notif.RegisterToken, { uid: "u1", body: { token: "t-old" } }));
    assert.deepStrictEqual(store.studentProfiles.u1.fcmTokens, ["t-new", "t-old"]);
    fails(await call(notif.RegisterToken, { uid: "u1", body: {} }), 400);
    for (let i = 0; i < 15; i++) ok(await call(notif.RegisterToken, { uid: "u2", body: { token: `d${i}` } }));
    assert.strictEqual(store.studentProfiles.u2.fcmTokens.length, 10);
    assert.strictEqual(store.studentProfiles.u2.fcmTokens[9], "d14");
  });

  await test("notify saves the notification and pushes to the student's phones", async () => {
    const id = await notif.notify("u1", { title: "Payment confirmed", body: "Audit is unlocked", type: "account", data: { screen: "my_learning" } });
    assert(id);
    const item = store["notifications/u1/items"][id];
    assert.strictEqual(item.read, false);
    assert.strictEqual(item.type, "account");
    const push = sent.multicast.at(-1);
    assert.deepStrictEqual(push.tokens, ["t-new", "t-old"]);
    assert.strictEqual(push.notification.title, "Payment confirmed");
    assert.strictEqual(push.data.screen, "my_learning");
  });

  await test("tokens for uninstalled apps are forgotten", async () => {
    deadTokens = new Set(["t-old"]);
    await notif.notify("u1", { title: "Hi", body: "There" });
    assert.deepStrictEqual(store.studentProfiles.u1.fcmTokens, ["t-new"]);
    deadTokens = new Set();
  });

  await test("a push failure never breaks the action that caused it", async () => {
    const broken = { async sendEachForMulticast() { throw new Error("FCM down"); }, async send() { throw new Error("FCM down"); } };
    notif._setMessaging(broken);
    const id = await notif.notify("u1", { title: "Still saved", body: "even if push fails" });
    assert(id, "the in-app copy is still saved");
    assert(await notif.broadcast({ title: "News", body: "still saved" }));
    notif._setMessaging(null);
  });

  await test("unknown types fall back to activities", async () => {
    const id = await notif.notify("u2", { title: "X", body: "Y", type: "spam" });
    assert.strictEqual(store["notifications/u2/items"][id].type, "activities");
  });

  await test("the list mixes own notifications and broadcasts, newest first", async () => {
    store.broadcasts = {};
    store.broadcasts.old = { title: "Before u2 joined", body: "", type: "news", createdAt: ago(5 * DAY) };
    await new Promise((r) => setTimeout(r, 5));
    await notif.broadcast({ title: "Exam timetable out", body: "Check the app" });
    assert.strictEqual(sent.topic.at(-1).topic, "all");
    const l1 = ok(await call(notif.ListNotifications, { uid: "u1" }));
    assert.strictEqual(l1.body.data.items[0].title, "Exam timetable out");
    assert(l1.body.data.items.some((n) => n.title === "Before u2 joined"));
    const l2 = ok(await call(notif.ListNotifications, { uid: "u2" }));
    assert(!l2.body.data.items.some((n) => n.title === "Before u2 joined"), "no news from before they signed up");
    assert(!l2.body.data.items.some((n) => n.title === "Payment confirmed"), "only their own notifications");
  });

  await test("mark all read clears the unread count, broadcasts included", async () => {
    const before = ok(await call(notif.ListNotifications, { uid: "u1" }));
    assert(before.body.data.unread > 0);
    ok(await call(notif.MarkAllRead, { uid: "u1" }));
    const after = ok(await call(notif.ListNotifications, { uid: "u1" }));
    assert.strictEqual(after.body.data.unread, 0);
    // A new one after that is unread again.
    await new Promise((r) => setTimeout(r, 5));
    await notif.notify("u1", { title: "New", body: "one" });
    const again = ok(await call(notif.ListNotifications, { uid: "u1" }));
    assert.strictEqual(again.body.data.unread, 1);
  });

  await test("admins can broadcast and message one student; input is checked", async () => {
    fails(await call(notif.AdminBroadcast, { uid: "staff", role: "admin", body: { title: "" } }), 400);
    ok(await call(notif.AdminBroadcast, { uid: "staff", role: "admin", body: { title: "Holiday", body: "Office closed Monday" } }));
    ok(await call(notif.AdminSend, { uid: "staff", role: "admin", body: { uid: "u2", title: "Hello", body: "Your certificate is ready" } }));
    const l2 = ok(await call(notif.ListNotifications, { uid: "u2" }));
    assert(l2.body.data.items.some((n) => n.title === "Hello"));
  });

  await test("a staff chat reply notifies the student; a student message doesn't notify anyone", async () => {
    const before = Object.keys(store["notifications/u1/items"]).length;
    ok(await call(chat.SendMessage, { uid: "u1", params: { studentUid: "u1" }, body: { body: "Hi, I need help" } }));
    assert.strictEqual(Object.keys(store["notifications/u1/items"]).length, before);
    ok(await call(chat.SendMessage, { uid: "staff", role: "admin", user: { name: "Tutor" }, params: { studentUid: "u1" }, body: { body: "Sure, what's up?" } }));
    const items = Object.values(store["notifications/u1/items"]);
    assert.strictEqual(items.length, before + 1);
    assert(items.some((n) => n.title === "New message from Excel Academy" && n.body === "Sure, what's up?"));
  });

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  process.exit(passed === results.length ? 0 : 1);
})();
