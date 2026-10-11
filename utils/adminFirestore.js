/**
 * Drop-in replacement for the parts of the "firebase/firestore" client SDK the
 * older controllers use, backed by the Admin SDK.
 *
 * The client SDK talked to Firestore as an anonymous user, so the security
 * rules had to let anyone on the internet read and write everything. With the
 * Admin SDK the server isn't subject to the rules, so they can be locked down
 * (see firestore.rules).
 *
 * Behaves like the client SDK where the controllers depend on it:
 *  - snapshot.exists() is a function (some code tests `snap.exists` without
 *    calling it, which is always truthy - same as before);
 *  - doc(collectionRef) makes a new auto-id reference;
 *  - updateDoc(ref, "field", value, ...) as well as updateDoc(ref, {...}).
 */
const { admin, db } = require("../firebaseadminvar");

const FieldValue = admin.firestore.FieldValue;

/* ---------------------------------------------------------------- snapshots */

function wrapDoc(snap) {
  return {
    id: snap.id,
    ref: snap.ref,
    metadata: {},
    exists: () => snap.exists,
    data: () => (snap.exists ? snap.data() : undefined),
    get: (field) => snap.get(field),
    _admin: snap,
  };
}

function wrapQuery(qs) {
  const docs = qs.docs.map(wrapDoc);
  return {
    docs,
    empty: qs.empty,
    size: qs.size,
    forEach: (fn) => docs.forEach(fn),
    docChanges: () => [],
  };
}

/* --------------------------------------------------------------- references */

const getFirestore = () => db;

const join = (path, segments) => [path, ...segments].filter((s) => s !== undefined && s !== null).join("/");

/** doc(db, "a/b"), doc(db, "a", "b"), doc(collectionRef), doc(collectionRef, id), doc(docRef, "sub/id"). */
function doc(parent, path, ...segments) {
  if (parent === db || parent === undefined || parent === null) return db.doc(join(path, segments));
  if (parent instanceof admin.firestore.CollectionReference) {
    return path === undefined ? parent.doc() : parent.doc(join(path, segments));
  }
  if (parent instanceof admin.firestore.DocumentReference) return parent.collection(path).doc(join(segments[0], segments.slice(1)));
  throw new Error("doc(): unsupported parent");
}

/** collection(db, "a"), collection(db, "a", id, "b"), collection(docRef, "sub"). */
function collection(parent, path, ...segments) {
  if (parent === db || parent === undefined || parent === null) return db.collection(join(path, segments));
  if (parent instanceof admin.firestore.DocumentReference) return parent.collection(join(path, segments));
  throw new Error("collection(): unsupported parent");
}

/* ------------------------------------------------------------------ queries */

const where = (field, op, value) => (q) => q.where(field, op, value);
const orderBy = (field, dir = "asc") => (q) => q.orderBy(field, dir);
const limit = (n) => (q) => q.limit(n);
const startAfter = (...values) => (q) =>
  q.startAfter(...values.map((v) => (v && v._admin ? v._admin : v)));

function query(base, ...constraints) {
  return constraints.reduce((q, c) => (typeof c === "function" ? c(q) : q), base);
}

/* --------------------------------------------------------------- operations */

const getDoc = async (ref) => wrapDoc(await ref.get());
const getDocs = async (q) => wrapQuery(await q.get());

async function setDoc(ref, data, options) {
  await (options ? ref.set(data, options) : ref.set(data));
}

async function updateDoc(ref, fieldOrData, ...rest) {
  if (typeof fieldOrData === "string") {
    const data = { [fieldOrData]: rest[0] };
    for (let i = 1; i + 1 < rest.length; i += 2) data[rest[i]] = rest[i + 1];
    return void (await ref.update(data));
  }
  await ref.update(fieldOrData);
}

const deleteDoc = async (ref) => void (await ref.delete());
const addDoc = async (colRef, data) => colRef.add(data);

const arrayUnion = (...items) => FieldValue.arrayUnion(...items);
const arrayRemove = (...items) => FieldValue.arrayRemove(...items);
const increment = (n) => FieldValue.increment(n);
const serverTimestamp = () => FieldValue.serverTimestamp();
const deleteField = () => FieldValue.delete();
const Timestamp = admin.firestore.Timestamp;

module.exports = {
  getFirestore, doc, collection, query, where, orderBy, limit, startAfter,
  getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  arrayUnion, arrayRemove, increment, serverTimestamp, deleteField, Timestamp,
};
