#!/usr/bin/env node
/**
 * Tests for the chat endpoints.
 *
 *   npm run test:chat
 *
 * Firestore is stubbed, so no credentials or network are needed. The point of
 * these is the authorisation rules: a student must never be able to read or
 * write another student's conversation.
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

/* ------------------------------------------------------- Firestore stub */

const store = { conversations: {}, messages: {} };   // messages: uid -> [{id,...}]
const INCREMENT = Symbol("increment");
const SERVER_TS = Symbol("serverTimestamp");

const resolve = (value, existing) => {
  if (value === SERVER_TS) return Date.now();
  if (value && value[INCREMENT]) return (existing || 0) + value.by;
  return value;
};

function messagesCollection(uid) {
  const list = () => (store.messages[uid] ||= []);
  const col = {
    _uid: uid,
    doc(id) {
      const docId = id || `m${list().length + 1}`;
      return {
        id: docId,
        async get() {
          const found = list().find((m) => m.id === docId);
          return { exists: !!found, id: docId, data: () => found };
        },
      };
    },
    _order: null, _limit: 100, _after: null,
    orderBy(field, dir) { col._order = { field, dir }; return col; },
    limit(n) { col._limit = n; return col; },
    startAfter(cursor) { col._after = cursor.id; return col; },
    async get() {
      let docs = [...list()].sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0));
      if (col._after) {
        const i = docs.findIndex((d) => d.id === col._after);
        if (i >= 0) docs = docs.slice(i + 1);
      }
      docs = docs.slice(0, col._limit);
      return { size: docs.length, docs: docs.map((d) => ({ id: d.id, data: () => d })) };
    },
  };
  return col;
}

function conversationsCollection() {
  const col = {
    doc(uid) {
      return {
        id: uid,
        async get() {
          const d = store.conversations[uid];
          return { exists: !!d, id: uid, data: () => d };
        },
        async set(data, opts) { applySet(uid, data, opts); },
        collection() { return messagesCollection(uid); },
      };
    },
    _where: null, _order: null, _limit: 100,
    where(f, _op, v) { col._where = { f, v }; return col; },
    orderBy(f, d) { col._order = { f, d }; return col; },
    limit(n) { col._limit = n; return col; },
    async get() {
      let docs = Object.entries(store.conversations).map(([id, d]) => ({ id, ...d }));
      if (col._where) docs = docs.filter((d) => d[col._where.f] === col._where.v);
      if (col._order) docs = docs.filter((d) => d[col._order.f] != null)
        .sort((a, b) => (b[col._order.f] || 0) - (a[col._order.f] || 0));
      docs = docs.slice(0, col._limit);
      return { size: docs.length, docs: docs.map((d) => ({ id: d.id, data: () => d })) };
    },
  };
  return col;
}

function applySet(uid, data, opts) {
  const existing = (opts && opts.merge && store.conversations[uid]) || {};
  const next = { ...existing };
  for (const [k, v] of Object.entries(data)) next[k] = resolve(v, existing[k]);
  store.conversations[uid] = next;
}

const db = {
  collection: (name) => (name === "conversations" ? conversationsCollection() : messagesCollection("?")),
  batch() {
    const ops = [];
    return {
      set(ref, data, opts) { ops.push({ ref, data, opts }); },
      async commit() {
        for (const { ref, data, opts } of ops) {
          if (ref.collection) applySet(ref.id, data, opts);
          else {
            const uid = ref._uid || data._uid;
            const resolved = {};
            for (const [k, v] of Object.entries(data)) resolved[k] = resolve(v);
            (store.messages[uid] ||= []).push({ id: ref.id, ...resolved });
          }
        }
      },
    };
  },
};

const adminStub = {
  apps: [{}], initializeApp: () => {}, credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async () => ({ uid: "u" }) }),
  storage: () => ({ bucket: () => ({}) }),
  firestore: () => ({}),
};
adminStub.firestore.FieldValue = {
  serverTimestamp: () => SERVER_TS,
  increment: (by) => ({ [INCREMENT]: true, by }),
};

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req.indexOf("firebaseadminvar") !== -1)
    return { admin: adminStub, db, auth: adminStub.auth(), bucket: {}, firebaseConfig: {}, serviceAccount: {} };
  if (req === "firebase-admin") return adminStub;
  return origLoad.call(this, req, parent, isMain);
};

// The message ref needs to know its conversation for the stubbed batch.
const realMessages = messagesCollection;
/* eslint-disable no-func-assign */
messagesCollection = function (uid) {
  const col = realMessages(uid);
  const origDoc = col.doc;
  col.doc = (id) => Object.assign(origDoc(id), { _uid: uid });
  return col;
};

/* ------------------------------------------------------------- helpers */

const chat = require(path.join(__dirname, "..", "controllers", "chat.controller.js"));

const run = (fn, req) =>
  new Promise((resolve) => {
    const r = { code: null, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; resolve({ r, err: null }); return r; };
    fn(req, r, (err) => resolve({ r, err }));
  });

const student = (uid) => ({ uid, role: "student", user: { name: "Ade", email: `${uid}@x.com` } });
const staff = { uid: "admin-1", role: "admin", user: { name: "Admin" } };

/* --------------------------------------------------------------- tests */

(async () => {
  await test("student sends a message; thread is created", async () => {
    const { err, r } = await run(chat.SendMessage, { ...student("stu-1"), params: { studentUid: "stu-1" }, body: { body: "Hello, I need help" } });
    assert.ok(!err, err && err.message);
    assert.strictEqual(r.code, 201);
    assert.strictEqual(store.conversations["stu-1"].lastMessage, "Hello, I need help");
    assert.strictEqual(store.conversations["stu-1"].unreadForAdmin, 1, "admin should have 1 unread");
  });

  await test("the student's own unread count is not raised by their own message", () => {
    assert.ok(!store.conversations["stu-1"].unreadForStudent);
  });

  await test("admin replies; the student's unread count goes up", async () => {
    const { err } = await run(chat.SendMessage, { ...staff, params: { studentUid: "stu-1" }, body: { body: "How can I help?" } });
    assert.ok(!err, err && err.message);
    assert.strictEqual(store.conversations["stu-1"].unreadForStudent, 1);
    assert.strictEqual(store.conversations["stu-1"].lastSenderRole, "admin");
  });

  await test("a student CANNOT read another student's conversation", async () => {
    const { err } = await run(chat.ListMessages, { ...student("stu-2"), params: { studentUid: "stu-1" }, query: {} });
    assert.ok(err && err.statusCode === 403, "expected 403, got " + (err && err.statusCode));
  });

  await test("a student CANNOT post into another student's conversation", async () => {
    const { err } = await run(chat.SendMessage, { ...student("stu-2"), params: { studentUid: "stu-1" }, body: { body: "sneaky" } });
    assert.ok(err && err.statusCode === 403);
  });

  await test("an admin CAN read any conversation", async () => {
    const { err, r } = await run(chat.ListMessages, { ...staff, params: { studentUid: "stu-1" }, query: {} });
    assert.ok(!err, err && err.message);
    assert.strictEqual(r.body.data.messages.length, 2);
  });

  await test("messages come back oldest first", async () => {
    const { r } = await run(chat.ListMessages, { ...staff, params: { studentUid: "stu-1" }, query: {} });
    const [first, second] = r.body.data.messages;
    assert.strictEqual(first.senderRole, "student");
    assert.strictEqual(second.senderRole, "admin");
  });

  await test("empty and whitespace-only messages are rejected", async () => {
    for (const body of ["", "   ", null, 42]) {
      const { err } = await run(chat.SendMessage, { ...student("stu-1"), params: { studentUid: "stu-1" }, body: { body } });
      assert.ok(err && err.statusCode === 400, `accepted ${JSON.stringify(body)}`);
    }
  });

  await test("over-long messages are rejected", async () => {
    const { err } = await run(chat.SendMessage, { ...student("stu-1"), params: { studentUid: "stu-1" }, body: { body: "x".repeat(4001) } });
    assert.ok(err && err.statusCode === 400);
  });

  await test("marking read clears only the caller's own counter", async () => {
    await run(chat.MarkRead, { ...staff, params: { studentUid: "stu-1" } });
    assert.strictEqual(store.conversations["stu-1"].unreadForAdmin, 0);
    assert.strictEqual(store.conversations["stu-1"].unreadForStudent, 1, "student's unread must be untouched");
  });

  await test("admin inbox lists threads with a total unread count", async () => {
    await run(chat.SendMessage, { ...student("stu-3"), params: { studentUid: "stu-3" }, body: { body: "second student" } });
    const { err, r } = await run(chat.ListConversations, { ...staff, query: {} });
    assert.ok(!err, err && err.message);
    assert.strictEqual(r.body.data.conversations.length, 2);
    assert.strictEqual(r.body.data.unreadTotal, 1);
  });

  await test("closing a thread requires a valid status", async () => {
    const bad = await run(chat.SetStatus, { ...staff, params: { studentUid: "stu-1" }, body: { status: "archived" } });
    assert.ok(bad.err && bad.err.statusCode === 400);
    const ok = await run(chat.SetStatus, { ...staff, params: { studentUid: "stu-1" }, body: { status: "closed" } });
    assert.ok(!ok.err);
    assert.strictEqual(store.conversations["stu-1"].status, "closed");
  });

  await test("missing conversation returns 404, not an empty object", async () => {
    const { err } = await run(chat.GetConversation, { ...staff, params: { studentUid: "nobody" } });
    assert.ok(err && err.statusCode === 404);
  });

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
})();
