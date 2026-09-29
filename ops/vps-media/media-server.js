/**
 * Excel Academy media service - runs on the VPS as the restricted "media" user.
 *
 * Lets dashboard admins list, upload and delete lesson videos in the courses
 * site's uploads folder, which the app streams from. Nothing else.
 *
 *  - Listens on 127.0.0.1 only; Apache forwards https://courses.excelacademyonline.com/media-api/.
 *  - Every request needs a Firebase ID token of an admin (role "admin" or
 *    "superadmin"), checked against Google's public keys - the same login the
 *    dashboard uses. No other secrets live here.
 *  - Deleting moves the file to a trash folder outside the website; it is
 *    removed for good after TRASH_DAYS and can be restored until then.
 *  - Uploads arrive in chunks, so a dropped connection resumes.
 *
 * Node built-ins only - no npm packages on a server that was breached before.
 */
"use strict";
const http = require("http");
const https = require("https");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const PORT = Number(process.env.PORT || 8787);
const PROJECT = process.env.FIREBASE_PROJECT || "excel-academy-online";
const UPLOADS = process.env.UPLOADS || "/home/exceuapm/courses.excelacademyonline.com/wp-content/uploads";
const PUBLIC_BASE = process.env.PUBLIC_BASE || "https://courses.excelacademyonline.com/wp-content/uploads";
const TRASH = process.env.TRASH || "/home/media-trash";
const TMP = process.env.TMP_DIR || "/home/media-trash/.incoming";
const TRASH_DAYS = Number(process.env.TRASH_DAYS || 30);
const ORIGINS = (process.env.ALLOWED_ORIGINS ||
  "https://excel-academy-dashboard.vercel.app,http://localhost:5173,http://localhost:4173").split(",");
const VIDEO = /\.(mp4|m4v|mov|webm)$/i;
const MAX_UPLOAD = 6 * 1024 * 1024 * 1024; // 6 GB per file
const MAX_CHUNK = 16 * 1024 * 1024;

const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ------------------------------------------------------------ auth */

let certs = { at: 0, keys: {} };
function fetchCerts() {
  return new Promise((resolve, reject) => {
    https
      .get("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com", (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const age = /max-age=(\d+)/.exec(res.headers["cache-control"] || "");
            certs = { at: Date.now(), ttl: (age ? Number(age[1]) : 3600) * 1000, keys: JSON.parse(body) };
            resolve(certs.keys);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

const b64 = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Verifies a Firebase ID token; returns its claims or throws. */
async function verifyToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("bad token");
  const header = JSON.parse(b64(parts[0]).toString());
  const claims = JSON.parse(b64(parts[1]).toString());
  if (header.alg !== "RS256") throw new Error("bad alg");
  if (!certs.at || Date.now() - certs.at > (certs.ttl || 3600000) || !certs.keys[header.kid]) await fetchCerts();
  const pem = certs.keys[header.kid];
  if (!pem) throw new Error("unknown key");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), pem, b64(parts[2]));
  if (!ok) throw new Error("bad signature");
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== PROJECT || claims.iss !== `https://securetoken.google.com/${PROJECT}`) throw new Error("wrong project");
  if (!(claims.exp > now) || !(claims.iat <= now + 60)) throw new Error("expired");
  if (!["admin", "superadmin"].includes(claims.role)) throw new Error("not an admin");
  return claims;
}

/* ------------------------------------------------------------ helpers */

function send(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
const fail = (res, code, message) => send(res, code, { status: "error", message });

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/** A relative path inside UPLOADS, or throws. Blocks "..", absolute paths and non-videos. */
function safeRel(rel, { video = true } = {}) {
  const clean = path.posix.normalize(String(rel || "").replace(/\\/g, "/")).replace(/^\/+/, "");
  if (!clean || clean.startsWith("..") || clean.includes("/../") || clean.includes("\0")) throw new Error("bad path");
  if (video && !VIDEO.test(clean)) throw new Error("only video files");
  const abs = path.join(UPLOADS, clean);
  if (!abs.startsWith(UPLOADS + path.sep)) throw new Error("outside uploads");
  return { rel: clean, abs };
}

const slug = (name) =>
  String(name || "video")
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "video";

/* ------------------------------------------------------------ listing */

let listCache = { at: 0, files: [] };
async function walk(dir, out) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await walk(abs, out);
    else if (e.isFile() && VIDEO.test(e.name)) {
      const st = await fsp.stat(abs);
      const rel = path.relative(UPLOADS, abs).split(path.sep).join("/");
      out.push({ path: rel, url: `${PUBLIC_BASE}/${rel.split("/").map(encodeURIComponent).join("/")}`, size: st.size, modified: st.mtime.toISOString() });
    }
  }
}
async function listVideos(force) {
  if (!force && Date.now() - listCache.at < 60 * 1000) return listCache.files;
  const out = [];
  await walk(UPLOADS, out);
  listCache = { at: Date.now(), files: out.sort((a, b) => b.size - a.size) };
  return listCache.files;
}

function disk() {
  return new Promise((resolve) => {
    execFile("df", ["-B1", "--output=size,used,avail", UPLOADS], (err, stdout) => {
      if (err) return resolve(null);
      const [size, used, avail] = stdout.trim().split("\n").pop().trim().split(/\s+/).map(Number);
      resolve({ size, used, available: avail });
    });
  });
}

/* ------------------------------------------------------------ trash */

const trashMeta = path.join(TRASH, "index.json");
async function readTrash() {
  try {
    return JSON.parse(await fsp.readFile(trashMeta, "utf8"));
  } catch {
    return [];
  }
}
const writeTrash = (items) => fsp.writeFile(trashMeta, JSON.stringify(items, null, 1));

async function moveToTrash(rel, by) {
  const { abs } = safeRel(rel);
  const st = await fsp.stat(abs);
  const id = crypto.randomBytes(8).toString("hex");
  const dest = path.join(TRASH, id + path.extname(abs));
  await fsp.rename(abs, dest);
  const items = await readTrash();
  items.push({ id, path: rel, file: path.basename(dest), size: st.size, deletedAt: new Date().toISOString(), deletedBy: by });
  await writeTrash(items);
  listCache.at = 0;
  log("trashed", rel, "by", by);
  return id;
}

async function restore(id) {
  const items = await readTrash();
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error("not in trash");
  const { abs } = safeRel(item.path);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  try {
    await fsp.access(abs);
    throw new Error("a file with that name exists again");
  } catch (e) {
    if (e.message.startsWith("a file")) throw e;
  }
  await fsp.rename(path.join(TRASH, item.file), abs);
  await writeTrash(items.filter((i) => i.id !== id));
  listCache.at = 0;
  log("restored", item.path);
  return item.path;
}

async function purgeOld() {
  const items = await readTrash();
  const cutoff = Date.now() - TRASH_DAYS * 24 * 3600 * 1000;
  const keep = [];
  for (const i of items) {
    if (Date.parse(i.deletedAt) < cutoff) {
      await fsp.rm(path.join(TRASH, i.file), { force: true });
      log("purged", i.path);
    } else keep.push(i);
  }
  if (keep.length !== items.length) await writeTrash(keep);
  // Unfinished uploads older than a day.
  for (const f of await fsp.readdir(TMP).catch(() => [])) {
    const p = path.join(TMP, f);
    const st = await fsp.stat(p).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 24 * 3600 * 1000) await fsp.rm(p, { force: true });
  }
}

/* ------------------------------------------------------------ uploads */
// POST /uploads {name, size}      -> {id, received: 0}
// GET  /uploads/:id               -> {received}  (to resume)
// PUT  /uploads/:id?offset=N      body = next chunk (<= 16 MB)
// POST /uploads/:id/finish        -> {path, url}

const uploads = new Map(); // id -> {name, size, received, by}

async function uploadStatus(id) {
  const u = uploads.get(id);
  if (!u) throw new Error("unknown upload");
  const st = await fsp.stat(path.join(TMP, id)).catch(() => null);
  u.received = st ? st.size : 0;
  return u;
}

function putChunk(req, id, offset) {
  return new Promise(async (resolve, reject) => {
    try {
      const u = await uploadStatus(id);
      if (offset !== u.received) return reject(new Error(`expected offset ${u.received}`));
      const len = Number(req.headers["content-length"] || 0);
      if (!len || len > MAX_CHUNK) return reject(new Error("chunk must be 1 byte to 16 MB"));
      if (u.received + len > u.size) return reject(new Error("more data than the file size"));
      const out = fs.createWriteStream(path.join(TMP, id), { flags: "a" });
      let got = 0;
      req.on("data", (c) => (got += c.length));
      req.pipe(out);
      out.on("finish", () => (got === len ? resolve(u.received + got) : reject(new Error("chunk cut short"))));
      out.on("error", reject);
      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

async function finishUpload(id) {
  const u = await uploadStatus(id);
  if (u.received !== u.size) throw new Error(`only ${u.received} of ${u.size} bytes received`);
  const head = Buffer.alloc(12);
  const fd = await fsp.open(path.join(TMP, id), "r");
  await fd.read(head, 0, 12, 0);
  await fd.close();
  const isVideo = head.toString("latin1", 4, 8) === "ftyp" || head.readUInt32BE(0) === 0x1a45dfa3; // mp4/mov or webm
  if (!isVideo) {
    await fsp.rm(path.join(TMP, id), { force: true });
    uploads.delete(id);
    throw new Error("that file is not a video");
  }
  const ext = (path.extname(u.name) || ".mp4").toLowerCase();
  const now = new Date();
  const rel = `lessons/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${slug(u.name)}-${crypto
    .randomBytes(3)
    .toString("hex")}${VIDEO.test(ext) ? ext : ".mp4"}`;
  const { abs } = safeRel(rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.rename(path.join(TMP, id), abs);
  await fsp.chmod(abs, 0o644);
  uploads.delete(id);
  listCache.at = 0;
  log("uploaded", rel, u.size, "by", u.by);
  return { path: rel, url: `${PUBLIC_BASE}/${rel}` };
}

/* ------------------------------------------------------------ server */

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  if (ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const url = new URL(req.url, "http://x");
  const route = url.pathname.replace(/^\/media-api/, "").replace(/\/+$/, "") || "/";
  if (route === "/health") return send(res, 200, { status: "ok" });

  let user;
  try {
    user = await verifyToken((req.headers.authorization || "").replace(/^Bearer /, ""));
  } catch (e) {
    return fail(res, 401, "Admin sign-in required");
  }
  const who = user.email || user.user_id;

  try {
    if (req.method === "GET" && route === "/videos") {
      const [files, d] = await Promise.all([listVideos(url.searchParams.get("refresh") === "1"), disk()]);
      return send(res, 200, { status: "ok", data: { files, disk: d, totalBytes: files.reduce((s, f) => s + f.size, 0) } });
    }
    if (req.method === "DELETE" && route === "/videos") {
      const body = await readJson(req);
      const paths = Array.isArray(body.paths) ? body.paths.slice(0, 500) : [body.path];
      const done = [];
      const errors = [];
      for (const p of paths) {
        try {
          await moveToTrash(p, who);
          done.push(p);
        } catch (e) {
          errors.push({ path: p, error: e.message });
        }
      }
      return send(res, 200, { status: "ok", data: { trashed: done, errors } });
    }
    if (req.method === "GET" && route === "/trash") {
      const items = await readTrash();
      return send(res, 200, { status: "ok", data: { items, days: TRASH_DAYS } });
    }
    const restoreMatch = route.match(/^\/trash\/([a-f0-9]{16})\/restore$/);
    if (req.method === "POST" && restoreMatch) {
      return send(res, 200, { status: "ok", data: { path: await restore(restoreMatch[1]) } });
    }
    if (req.method === "POST" && route === "/uploads") {
      const { name, size } = await readJson(req);
      if (!VIDEO.test(String(name || ""))) return fail(res, 400, "Upload an .mp4, .mov, .m4v or .webm video");
      if (!(size > 0 && size <= MAX_UPLOAD)) return fail(res, 400, "Videos can be up to 6 GB");
      const d = await disk();
      if (d && d.available - size < 2 * 1024 ** 3) return fail(res, 507, "Not enough space on the server - delete unused videos first");
      const id = crypto.randomBytes(12).toString("hex");
      uploads.set(id, { name: String(name), size: Number(size), received: 0, by: who });
      await fsp.writeFile(path.join(TMP, id), "");
      return send(res, 201, { status: "ok", data: { id, received: 0, chunkSize: 8 * 1024 * 1024 } });
    }
    const up = route.match(/^\/uploads\/([a-f0-9]{24})(\/finish)?$/);
    if (up && req.method === "GET") return send(res, 200, { status: "ok", data: { received: (await uploadStatus(up[1])).received } });
    if (up && req.method === "PUT") {
      const received = await putChunk(req, up[1], Number(url.searchParams.get("offset")));
      return send(res, 200, { status: "ok", data: { received } });
    }
    if (up && up[2] && req.method === "POST") return send(res, 200, { status: "ok", data: await finishUpload(up[1]) });

    return fail(res, 404, "Not found");
  } catch (e) {
    log("error", req.method, route, e.message);
    return fail(res, 400, e.message);
  }
});

(async () => {
  await fsp.mkdir(TRASH, { recursive: true });
  await fsp.mkdir(TMP, { recursive: true });
  setInterval(() => purgeOld().catch((e) => log("purge failed", e.message)), 6 * 3600 * 1000);
  purgeOld().catch(() => {});
  server.requestTimeout = 10 * 60 * 1000;
  server.listen(PORT, "127.0.0.1", () => log(`media service on 127.0.0.1:${PORT}, uploads ${UPLOADS}`));
})();
