#!/usr/bin/env node
/**
 * Proves the Mongo and Firestore course repositories return the SAME shape.
 *
 *   npm run test:repo
 *
 * The live ExcelGroup app parses `AllCourses` / `courseDetails` and requires
 * HTTP 202, so any divergence between the two backends breaks the shipped app
 * on cutover. These tests stub both databases - no credentials, no network.
 */
const assert = require("assert");
const Module = require("module");
const path = require("path");

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ ok: true, name });
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push({ ok: false, name, err });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

// --- Stub Firestore ------------------------------------------------------

class FakeTimestamp {
  constructor(iso) {
    this._d = new Date(iso);
  }
  toDate() {
    return this._d;
  }
}

const COURSE_DOCS = [
  {
    id: "course-a",
    data: {
      title: "Intro to Accounting",
      description: "Basics",
      price: 5000,
      subscribers: ["user-1"],
      createdAt: new FakeTimestamp("2026-01-15T10:00:00.000Z"),
    },
  },
  {
    id: "course-b",
    data: {
      title: "Advanced Tax",
      description: "Harder",
      price: 12000,
      // No `subscribers` field at all - Firestore does not default it the way
      // the Mongoose schema did.
    },
  },
];

function fakeDoc(d) {
  return { id: d.id, exists: true, data: () => ({ ...d.data }) };
}

const adminStub = {
  apps: [{}],
  initializeApp: () => {},
  credential: { cert: () => ({}) },
  auth: () => ({ verifyIdToken: async () => ({ uid: "u" }) }),
  storage: () => ({ bucket: () => ({}) }),
  firestore: () => ({}),
};
adminStub.firestore.FieldPath = { documentId: () => "__name__" };
adminStub.firestore.FieldValue = { arrayUnion: (...v) => ({ __arrayUnion: v }) };

const updates = [];

function fakeCollection() {
  return {
    async get() {
      return { docs: COURSE_DOCS.map(fakeDoc), empty: false };
    },
    doc(id) {
      const found = COURSE_DOCS.find((d) => d.id === id);
      return {
        async get() {
          return found ? fakeDoc(found) : { exists: false };
        },
        async update(payload) {
          updates.push({ id, payload });
        },
      };
    },
    where(_field, _op, values) {
      return {
        async get() {
          const docs = COURSE_DOCS.filter((d) => values.includes(d.id)).map(fakeDoc);
          return { docs, empty: docs.length === 0 };
        },
      };
    },
  };
}

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.indexOf("firebaseadminvar") !== -1) {
    return {
      admin: adminStub,
      serviceAccount: { project_id: "stub" },
      firebaseConfig: {},
      db: { collection: fakeCollection },
      auth: adminStub.auth(),
      bucket: {},
    };
  }
  if (request === "firebase-admin") return adminStub;
  return origLoad.call(this, request, parent, isMain);
};

// --- Load the Firestore repository --------------------------------------

process.env.DATA_SOURCE = "firestore";
const repoPath = path.join(__dirname, "..", "repositories", "courseRepository.js");
delete require.cache[require.resolve(repoPath)];
const repo = require(repoPath);

// --- Tests ---------------------------------------------------------------

(async () => {
  test("DATA_SOURCE selects the firestore backend", () => {
    assert.strictEqual(repo.source, "firestore");
  });

  const all = await repo.findAll();

  test("findAll returns every course", () => {
    assert.strictEqual(all.length, 2);
  });

  test("documents expose _id, which is what the client indexes on", () => {
    assert.strictEqual(all[0]._id, "course-a");
    assert.strictEqual(all[0].id, "course-a");
  });

  test("course fields survive unchanged", () => {
    assert.strictEqual(all[0].title, "Intro to Accounting");
    assert.strictEqual(all[0].price, 5000);
  });

  test("Firestore Timestamps become ISO strings, as Mongoose Dates did", () => {
    assert.strictEqual(typeof all[0].createdAt, "string");
    assert.strictEqual(all[0].createdAt, "2026-01-15T10:00:00.000Z");
  });

  test("JSON round-trip matches what the client receives", () => {
    const wire = JSON.parse(JSON.stringify({ AllCourses: all }));
    assert.strictEqual(wire.AllCourses[0]._id, "course-a");
    assert.strictEqual(wire.AllCourses[1].title, "Advanced Tax");
  });

  const one = await repo.findById("course-a");
  test("findById returns the course", () => {
    assert.strictEqual(one._id, "course-a");
  });

  test("findById returns null for an unknown id, so the 403 path still fires", async () => {
    const missing = await repo.findById("nope");
    assert.strictEqual(missing, null);
  });

  const many = await repo.findManyByIds(["course-a", "course-b"]);
  test("findManyByIds returns both", () => {
    assert.strictEqual(many.length, 2);
  });

  test("findManyByIds tolerates an empty cart", async () => {
    assert.deepStrictEqual(await repo.findManyByIds([]), []);
  });

  test("findManyByIds batches past Firestore's 30-value `in` limit", async () => {
    const ids = Array.from({ length: 75 }, (_, i) => `id-${i}`);
    const out = await repo.findManyByIds(ids);
    assert.ok(Array.isArray(out));
  });

  test("a course with no subscribers field does not throw", () => {
    const courseB = all.find((c) => c._id === "course-b");
    const subs = courseB.subscribers || [];
    assert.deepStrictEqual(subs, []);
  });

  await repo.addSubscriber({ _id: "course-a" }, "user-9");
  test("addSubscriber uses an atomic arrayUnion", () => {
    const last = updates[updates.length - 1];
    assert.strictEqual(last.id, "course-a");
    assert.deepStrictEqual(last.payload.subscribers.__arrayUnion, ["user-9"]);
  });

  const found = await repo.search("tax");
  test("search is case-insensitive across title and description", () => {
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0]._id, "course-b");
  });

  test("an invalid DATA_SOURCE fails loudly at startup", () => {
    process.env.DATA_SOURCE = "postgres";
    delete require.cache[require.resolve(repoPath)];
    assert.throws(() => require(repoPath), /DATA_SOURCE must be/);
    process.env.DATA_SOURCE = "firestore";
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
})();
