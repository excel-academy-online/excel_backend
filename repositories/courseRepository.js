/**
 * Course data access, with MongoDB and Firestore behind one interface.
 *
 * Background: the original 2024 backend stored courses in MongoDB. A later
 * developer began moving to Firestore and stopped halfway, leaving two parallel
 * course systems in course.controller.js - `GetAllCourses`/`CreateCourses`
 * (Mongo, serving the live app) and `getAllCourses`/`createProgramCourse`
 * (Firestore, unused). See AUDIT.md.
 *
 * This module finishes that migration without a flag day. Pick the backing
 * store with the DATA_SOURCE environment variable:
 *
 *   DATA_SOURCE=mongo      (default - current production behaviour)
 *   DATA_SOURCE=firestore  (the target)
 *
 * Both implementations return the SAME shape, so the shipped ExcelGroup app -
 * which reads `AllCourses` and `courseDetails` and checks for HTTP 202 - keeps
 * working either way. Response shape is deliberately preserved bug-for-bug;
 * fixing it is a separate, client-coordinated change.
 */
const AppError = require("../utils/errors/AppError");

const SOURCE = (process.env.DATA_SOURCE || "mongo").toLowerCase();

if (!["mongo", "firestore"].includes(SOURCE)) {
  throw new Error(
    `DATA_SOURCE must be "mongo" or "firestore", got "${SOURCE}"`
  );
}

/* ------------------------------------------------------------------ *
 * MongoDB implementation - the current production path.
 * ------------------------------------------------------------------ */

const mongoRepo = {
  async findAll() {
    const Courses = require("../models/courses.model");
    return Courses.find();
  },

  async findById(courseId) {
    const Courses = require("../models/courses.model");
    return Courses.findById(courseId);
  },

  async findManyByIds(ids) {
    const Courses = require("../models/courses.model");
    return Courses.find({ _id: { $in: ids } });
  },

  async search(term) {
    const Courses = require("../models/courses.model");
    return Courses.find({
      $or: [
        { title: { $regex: term, $options: "i" } },
        { description: { $regex: term, $options: "i" } },
      ],
    });
  },

  async addSubscriber(course, userId) {
    course.subscribers.push(userId);
    return course.save();
  },
};

/* ------------------------------------------------------------------ *
 * Firestore implementation.
 * ------------------------------------------------------------------ */

/**
 * Shape a Firestore document like a Mongoose document.
 *
 * The client indexes into `_id`, so the Firestore document id is exposed under
 * both `_id` and `id`. Timestamps are converted to ISO strings, which is what
 * `JSON.stringify` would have produced for Mongoose dates.
 */
function toApiShape(doc) {
  const data = doc.data();

  for (const [key, value] of Object.entries(data)) {
    // Firestore Timestamps have toDate(); Mongoose serialised Dates to ISO.
    if (value && typeof value.toDate === "function") {
      data[key] = value.toDate().toISOString();
    }
  }

  return { _id: doc.id, id: doc.id, ...data };
}

const firestoreRepo = {
  _collection() {
    const { db } = require("../firebaseadminvar");
    return db.collection("courses");
  },

  async findAll() {
    const snap = await this._collection().get();
    return snap.docs.map(toApiShape);
  },

  async findById(courseId) {
    const doc = await this._collection().doc(String(courseId)).get();
    return doc.exists ? toApiShape(doc) : null;
  },

  async findManyByIds(ids) {
    const unique = [...new Set(ids.map(String))];
    if (unique.length === 0) return [];

    // Firestore caps `in` at 30 values, so batch. A cart never approaches this,
    // but a bulk enrolment could.
    const batches = [];
    for (let i = 0; i < unique.length; i += 30) {
      batches.push(unique.slice(i, i + 30));
    }

    const { admin } = require("../firebaseadminvar");
    const results = await Promise.all(
      batches.map((batch) =>
        this._collection()
          .where(admin.firestore.FieldPath.documentId(), "in", batch)
          .get()
      )
    );

    return results.flatMap((snap) => snap.docs.map(toApiShape));
  },

  async search(term) {
    // Firestore has no substring search. Filtering in memory matches the
    // behaviour of the Mongo regex query at this catalogue size; if the
    // catalogue grows, this needs Algolia or an equivalent - the Mongo version
    // would not have scaled either, since an unanchored regex cannot use an index.
    const needle = String(term).toLowerCase();
    const all = await this.findAll();
    return all.filter(
      (c) =>
        (c.title || "").toLowerCase().includes(needle) ||
        (c.description || "").toLowerCase().includes(needle)
    );
  },

  async addSubscriber(course, userId) {
    const { admin } = require("../firebaseadminvar");
    // arrayUnion is atomic and idempotent, so concurrent purchases cannot lose
    // a subscriber the way a read-modify-write `push` + `save` could.
    return this._collection()
      .doc(String(course._id || course.id))
      .update({
        subscribers: admin.firestore.FieldValue.arrayUnion(String(userId)),
      });
  },
};

/* ------------------------------------------------------------------ */

const repo = SOURCE === "firestore" ? firestoreRepo : mongoRepo;

module.exports = {
  source: SOURCE,
  findAll: repo.findAll.bind(repo),
  findById: repo.findById.bind(repo),
  findManyByIds: repo.findManyByIds.bind(repo),
  search: repo.search.bind(repo),
  addSubscriber: repo.addSubscriber.bind(repo),
  // Exported for tests.
  _mongoRepo: mongoRepo,
  _firestoreRepo: firestoreRepo,
  _toApiShape: toApiShape,
};
