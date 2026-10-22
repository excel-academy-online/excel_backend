#!/usr/bin/env node
/**
 * Tests for one-device-per-account (utils/deviceSessions.js).
 * Firestore is stubbed - no credentials, no network.
 */
const assert = require("assert");
const Module = require("module");

const results = [];
const test = (name, fn) =>
  Promise.resolve().then(fn)
    .then(() => { results.push(true); console.log(`PASS  ${name}`); })
    .catch((e) => { results.push(false); console.log(`FAIL  ${name}\n      ${e.message}`); });

const store = {};
const ref = (id) => ({
  id,
  async get() { return { exists: !!store[id], data: () => store[id] && { ...store[id] } }; },
  async set(d, o) { store[id] = o && o.merge ? { ...(store[id] || {}), ...d } : { ...d }; },
  async delete() { delete store[id]; },
});
const db = {
  collection: () => ({ doc: (id) => ref(id) }),
  async runTransaction(fn) {
    const ops = [];
    const out = await fn({ get: (r) => r.get(), set: (r, d, o) => ops.push([r, d, o]) });
    for (const [r, d, o] of ops) await r.set(d, o);
    return out;
  },
};
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (/firebaseadminvar$/.test(req)) return { db };
  return origLoad.call(this, req, parent, isMain);
};

const s = require("../utils/deviceSessions");

(async () => {
  await test("first phone claims the account", async () => {
    assert.deepStrictEqual(await s.claim("u1", "phoneA", "Tecno Spark", "android"), { ok: true });
  });
  await test("the same phone can claim again (app restart)", async () => {
    assert.strictEqual((await s.claim("u1", "phoneA", "Tecno Spark")).ok, true);
  });
  await test("a second phone is refused and told which phone holds it", async () => {
    const r = await s.claim("u1", "phoneB", "Infinix");
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.deviceName, "Tecno Spark");
  });
  await test("requests from the holder pass, from another phone fail, without a device id pass", async () => {
    assert.strictEqual(await s.allowed("u1", "phoneA"), true);
    assert.strictEqual(await s.allowed("u1", "phoneB"), false);
    assert.strictEqual(await s.allowed("u1", ""), true);
  });
  await test("another phone can't release it; logging out on the holder frees it", async () => {
    await s.release("u1", "phoneB");
    assert.strictEqual((await s.claim("u1", "phoneB")).ok, false);
    await s.release("u1", "phoneA");
    assert.strictEqual((await s.claim("u1", "phoneB", "Infinix")).ok, true);
  });
  await test("staff can sign a lost phone out", async () => {
    await s.forceRelease("u1");
    assert.strictEqual((await s.claim("u1", "phoneC")).ok, true);
  });
  await test("a phone unused for 30+ days no longer blocks a new one", async () => {
    store.u2 = { deviceId: "old", deviceName: "Old phone", lastSeen: new Date(Date.now() - 31 * 86400000).toISOString() };
    assert.strictEqual((await s.claim("u2", "new", "New phone")).ok, true);
  });

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed.`);
  process.exit(passed === results.length ? 0 : 1);
})();
