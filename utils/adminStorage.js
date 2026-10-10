/**
 * Drop-in replacement for the parts of the "firebase/storage" client SDK the
 * controllers use (getStorage, ref, uploadBytes, uploadBytesResumable,
 * getDownloadURL, deleteObject).
 *
 * New files go to the media service on the VPS (Firebase Storage needs a paid
 * plan we don't have). They are served from
 * https://courses.excelacademyonline.com/wp-content/uploads/app-files/...
 * Old Firebase Storage links are left as they are.
 *
 * Needs MEDIA_SERVER_KEY (same value as on the VPS) and optionally MEDIA_URL.
 */
const path = require("path");

const MEDIA_URL = (process.env.MEDIA_URL || "https://courses.excelacademyonline.com/media-api").replace(/\/$/, "");
const KEY = process.env.MEDIA_SERVER_KEY || "";
const FILES_PREFIX = "/wp-content/uploads/";

const TYPES = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".pdf": "application/pdf", ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".mp3": "audio/mpeg",
};

const getStorage = () => ({ vps: true });

/** ref(storage, "folder/name") or ref(storage, <an existing URL>). */
function ref(_storage, location) {
  const fullPath = String(location || "");
  const r = { fullPath, name: path.basename(fullPath.split("?")[0]) };
  if (/^https?:\/\//.test(fullPath)) r.url = fullPath;
  return r;
}

async function media(method, route, body, headers = {}) {
  if (!KEY) throw new Error("File uploads are not set up (MEDIA_SERVER_KEY missing)");
  const res = await fetch(MEDIA_URL + route, { method, body, headers: { "X-Media-Key": KEY, ...headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `File server error ${res.status}`);
  return json.data;
}

async function save(storageRef, data, metadata = {}) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  const folder = storageRef.fullPath.split("/")[0] || "misc";
  let name = storageRef.name || "file";
  if (!path.extname(name)) {
    const ext = Object.keys(TYPES).find((e) => TYPES[e] === metadata.contentType);
    name += ext || ".jpg";
  }
  const out = await media("PUT", `/files?folder=${encodeURIComponent(folder)}`, buf, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(buf.length),
    "X-File-Name": encodeURIComponent(name),
  });
  storageRef.url = out.url;
  storageRef.fullPath = out.path;
  return { ref: storageRef, metadata: { fullPath: out.path, size: buf.length }, bytesTransferred: buf.length, totalBytes: buf.length };
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
  task._done.catch(() => {}); // reported through .on / await, not as an unhandled rejection
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

/** The public URL of an uploaded file. */
async function getDownloadURL(storageRef) {
  if (storageRef.url) return storageRef.url;
  throw new Error(`No URL for ${storageRef.fullPath} - upload it first`);
}

/** Deletes our own VPS files; old Firebase links are left alone. */
async function deleteObject(storageRef) {
  const url = storageRef.url || "";
  const i = url.indexOf(FILES_PREFIX + "app-files/");
  if (i === -1) return;
  await media("DELETE", "/files", JSON.stringify({ path: url.slice(i + FILES_PREFIX.length).split("?")[0] }), {
    "Content-Type": "application/json",
  }).catch(() => {});
}

/** A unique path in a folder (the VPS also makes the final name unique). */
function uniquePath(folder, originalName) {
  return `${folder}/${path.basename(originalName || "file")}`;
}

module.exports = { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject, uniquePath };
