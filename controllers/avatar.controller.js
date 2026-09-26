/**
 * Profile photos, stored by the API instead of Firebase Storage.
 *
 * Firebase Storage refuses uploads until the project's billing is sorted out,
 * which left students unable to set a photo. Avatars are small once the app
 * shrinks them (~400px, well under 300 KB), so they live in Firestore and are
 * served from a normal URL the app, leaderboard and dashboard can all load.
 *
 *   avatars/{uid}   { data: base64, type: "image/jpeg" | "image/png" | "image/webp", updatedAt }
 *   users/{uid}.dp  -> https://<api>/api/students/photo/{uid}?v=<time>
 */
const { db, admin } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const MAX_BYTES = 300 * 1024;

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

const baseUrl = (req) =>
  (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

/** POST /api/students/photo { image: base64 } - set your own profile photo. */
exports.UploadPhoto = catchAsync(async (req, res) => {
  const raw = String((req.body || {}).image || "").replace(/^data:[^,]+,/, "");
  if (!raw) throw new AppError("image is required", 400);
  const buf = Buffer.from(raw, "base64");
  if (!buf.length) throw new AppError("That image couldn't be read", 400);
  if (buf.length > MAX_BYTES) throw new AppError("That photo is too large - pick a smaller one", 413);
  const type = sniff(buf);
  if (!type) throw new AppError("Use a JPEG, PNG or WebP photo", 400);

  const updatedAt = new Date().toISOString();
  await db.collection("avatars").doc(req.uid).set({ data: buf.toString("base64"), type, updatedAt });
  // The version in the URL makes phones and browsers fetch the new photo.
  const url = `${baseUrl(req)}/api/students/photo/${encodeURIComponent(req.uid)}?v=${Date.parse(updatedAt)}`;
  await db.collection("users").doc(req.uid).set({ dp: url, updatedAt }, { merge: true });
  try {
    await admin.auth().updateUser(req.uid, { photoURL: url });
  } catch (e) {
    // The profile photo is set either way; the login record is a nice-to-have.
  }
  res.status(200).json({ status: "ok", message: "Photo updated", data: { url } });
});

/** GET /api/students/photo/:uid - the image itself (public, like any avatar). */
exports.GetPhoto = catchAsync(async (req, res, next) => {
  const snap = await db.collection("avatars").doc(String(req.params.uid)).get();
  if (!snap.exists) return next(new AppError("No photo", 404));
  const { data, type } = snap.data();
  res.set("Content-Type", type || "image/jpeg");
  res.set("Cache-Control", "public, max-age=86400");
  // Helmet's default blocks cross-origin image loads (the dashboard is on
  // another domain).
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  res.status(200).send(Buffer.from(data, "base64"));
});
