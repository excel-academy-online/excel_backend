/**
 * Who changed what, and when: one entry per create/edit/delete made by staff.
 *
 * adminLog/{auto} = { at, uid, email, role, method, path, status, ok, target, summary, ip }
 *
 * Request bodies are summarised (field names and short values only) - never
 * passwords, tokens or file contents. Kept 180 days.
 */
const { db } = require("../firebaseadminvar");

const SECRET = /pass|token|secret|key|card|pin|otp/i;
const KEEP_DAYS = 180;

function summarise(body) {
  if (!body || typeof body !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(body).slice(0, 15)) {
    if (SECRET.test(k)) out[k] = "[hidden]";
    else if (v === null || ["number", "boolean"].includes(typeof v)) out[k] = v;
    else if (typeof v === "string") out[k] = v.length > 80 ? v.slice(0, 77) + "..." : v;
    else if (Array.isArray(v)) out[k] = `[${v.length} items]`;
    else out[k] = "{...}";
  }
  return out;
}

async function record(req, status) {
  const path = (req.originalUrl || "").split("?")[0];
  await db.collection("adminLog").add({
    at: new Date().toISOString(),
    uid: req.uid || "",
    email: (req.user && req.user.email) || "",
    role: req.role || "",
    method: req.method,
    path,
    status,
    ok: status < 400,
    // The record the change was about, when the URL names one.
    target: Object.values(req.params || {}).join("/") || (req.body && (req.body.id || req.body.course_id || req.body.user_id || req.body.uid)) || "",
    summary: summarise(req.body),
    ip: String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim(),
    expiresAt: new Date(Date.now() + KEEP_DAYS * 86400000).toISOString(),
  });
}

/** GET /api/admin/activity?limit=200 - newest first (staff). */
async function list(req, res) {
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const snap = await db.collection("adminLog").orderBy("at", "desc").limit(limit).get();
  res.status(200).json({ status: "ok", message: "Activity", data: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
}

module.exports = { record, list, summarise };
