/**
 * Drop-in replacement for the parts of the "firebase/storage" client SDK the
 * controllers use (getStorage, ref, uploadBytes, uploadBytesResumable,
 * getDownloadURL), backed by the Admin SDK.
 *
 * The client SDK uploaded as an anonymous user, so Storage rules had to allow
 * anyone on the internet to write to courses/, programs/, announcement/ ...
 * With the Admin SDK the server isn't subject to the rules, so they can allow
 * writes to staff only.
 *
 * getDownloadURL returns the same token URL the client SDK produced
 * (https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>?alt=media&token=...),
 * so existing links and the app keep working unchanged.
 */
const crypto = require("crypto");
const path = require("path");
const { bucket } = require("../firebaseadminvar");

const TYPES = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4v": "video/x-m4v",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".mp3": "audio/mpeg",
};

const getStorage = () => ({ admin: true });

/** ref(storage, "folder/name") or ref(storage, <an existing download URL>). */
function ref(_storage, location) {
  let fullPath = String(location || "");
  const m = fullPath.match(/\/o\/([^?]+)/);
  if (/^https?:\/\//.test(fullPath) && m) fullPath = decodeURIComponent(m[1]);
  return { fullPath, name: path.basename(fullPath), bucket: bucket.name };
}

function downloadUrl(fullPath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fullPath)}?alt=media&token=${token}`;
}

async function save(storageRef, data, metadata = {}) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  const token = crypto.randomUUID();
  await bucket.file(storageRef.fullPath).save(buf, {
    resumable: buf.length > 10 * 1024 * 1024,
    contentType: metadata.contentType || TYPES[path.extname(storageRef.fullPath).toLowerCase()] || "application/octet-stream",
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return { ref: storageRef, metadata: { fullPath: storageRef.fullPath, size: buf.length }, bytesTransferred: buf.length, totalBytes: buf.length };
}

/** Promise<{ ref, metadata }> like the client SDK. */
async function uploadBytes(storageRef, data, metadata) {
  const snap = await save(storageRef, data, metadata);
  return { ref: snap.ref, metadata: snap.metadata };
}

/**
 * Returns a task with .on("state_changed", next, error, complete) and
 * .snapshot.ref, and is also awaitable, as the callers use it both ways.
 */
function uploadBytesResumable(storageRef, data, metadata) {
  const size = Buffer.isBuffer(data) ? data.length : (data && data.byteLength) || 0;
  const task = {
    snapshot: { ref: storageRef, bytesTransferred: 0, totalBytes: size },
    _done: null,
  };
  task._done = save(storageRef, data, metadata).then((snap) => {
    task.snapshot = { ...task.snapshot, bytesTransferred: size };
    return snap;
  });
  task.on = (_event, next, error, complete) => {
    task._done.then(
      () => {
        if (typeof next === "function") next(task.snapshot);
        if (typeof complete === "function") complete();
      },
      (err) => { if (typeof error === "function") error(err); }
    );
    return () => {};
  };
  task.then = (a, b) => task._done.then(() => task.snapshot).then(a, b);
  task.catch = (b) => task._done.catch(b);
  return task;
}

/** The token download URL; adds a token to files uploaded without one. */
async function getDownloadURL(storageRef) {
  const file = bucket.file(storageRef.fullPath);
  const [meta] = await file.getMetadata();
  let token = ((meta.metadata || {}).firebaseStorageDownloadTokens || "").split(",")[0];
  if (!token) {
    token = crypto.randomUUID();
    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
  }
  return downloadUrl(storageRef.fullPath, token);
}

async function deleteObject(storageRef) {
  await bucket.file(storageRef.fullPath).delete({ ignoreNotFound: true });
}

/** A unique path in a folder, so two uploads with the same file name can't overwrite each other. */
function uniquePath(folder, originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  const base = path.basename(originalName || "file", ext).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60) || "file";
  return `${folder}/${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}-${base}${ext}`;
}

module.exports = { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject, uniquePath };
