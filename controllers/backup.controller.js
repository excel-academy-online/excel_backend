/**
 * POST /api/ops/backup - nightly copy of the whole Firestore database.
 *
 * Called by a cron job on the VPS with the X-Backup-Key header (the same
 * MEDIA_SERVER_KEY the media service and this backend already share). Every
 * collection and sub-collection is written to one gzipped JSON file and sent
 * to the media service, which keeps it outside the website for 30 days.
 *
 * Restoring: each document is stored as { path, data }, with Firestore
 * timestamps as { _ts: ISO string } - see scripts/restoreBackup.js.
 */
const crypto = require("crypto");
const zlib = require("zlib");
const { db } = require("../firebaseadminvar");

const MEDIA_URL = (process.env.MEDIA_URL || "https://courses.excelacademyonline.com/media-api").replace(/\/$/, "");
const KEY = process.env.MEDIA_SERVER_KEY || "";

const plain = (v) => {
  if (v && typeof v.toDate === "function") return { _ts: v.toDate().toISOString() };
  if (v && v.constructor && v.constructor.name === "DocumentReference") return { _ref: v.path };
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object" && !(v instanceof Buffer)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  }
  return v;
};

async function dumpCollection(col, out) {
  const snap = await col.get();
  for (const d of snap.docs) {
    out.push({ path: d.ref.path, data: plain(d.data()) });
    for (const sub of await d.ref.listCollections()) await dumpCollection(sub, out);
  }
}

exports.Backup = async (req, res) => {
  const given = String(req.headers["x-backup-key"] || "");
  const ok = KEY.length >= 32 && given.length === KEY.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(KEY));
  if (!ok) return res.status(401).json({ status: "fail", message: "Not allowed" });

  try {
    const started = Date.now();
    const docs = [];
    for (const col of await db.listCollections()) await dumpCollection(col, docs);
    const gz = zlib.gzipSync(JSON.stringify({ createdAt: new Date().toISOString(), count: docs.length, docs }));

    const r = await fetch(`${MEDIA_URL}/backups`, {
      method: "PUT",
      body: gz,
      headers: { "X-Media-Key": KEY, "Content-Type": "application/gzip", "Content-Length": String(gz.length) },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.message || `media service ${r.status}`);

    console.log(`Backup: ${docs.length} documents, ${gz.length} bytes, ${Date.now() - started} ms`);
    res.status(200).json({ status: "ok", message: "Backup saved", data: { documents: docs.length, bytes: gz.length, file: body.data && body.data.file } });
  } catch (err) {
    console.error("Backup failed:", err.message);
    res.status(500).json({ status: "error", message: `Backup failed: ${err.message}` });
  }
};
