/**
 * Admin dashboard endpoints rebuilt on Firestore (Admin SDK).
 *
 * The originals either queried the retired MongoDB (so they hung for 10s and
 * failed), or looked students up by an `id` field that accounts created in
 * the new app don't have. Response shapes match what the dashboard reads.
 */
const { db, admin } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

/** GET /api/students/getStudentDetail?uid= - profile + login info. */
exports.StudentDetail = catchAsync(async (req, res, next) => {
  const uid = String(req.query.uid || "");
  if (!uid) return next(new AppError("User ID is required.", 400));

  let snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) {
    // Older records are keyed by an auto id with the uid stored in `id`.
    const q = await db.collection("users").where("id", "==", uid).limit(1).get();
    snap = q.empty ? null : q.docs[0];
  }
  const auth = await admin.auth().getUser(uid).catch(() => null);
  if (!snap && !auth) return next(new AppError("User not found", 404));

  const d = snap ? snap.data() : {};
  res.status(200).json({
    status: "success",
    message: "User details retrieved successfully",
    data: {
      ...d,
      id: uid,
      uid,
      name: d.name || (auth && auth.displayName) || "",
      email: d.email || (auth && auth.email) || "",
      dp: d.dp || d.photoUrl || (auth && auth.photoURL) || null,
      datecreated: d.datecreated || d.createdAt || (auth && auth.metadata.creationTime) || null,
      lastSignIn: (auth && auth.metadata.lastSignInTime) || null,
      disabled: auth ? auth.disabled : false,
    },
  });
});

/** GET /api/auth/fetch-by-gender?requiredGender=male - how many students. */
exports.UsersByGender = catchAsync(async (req, res) => {
  const wanted = String(req.query.requiredGender || "").trim().toLowerCase();
  const snap = await db.collection("users").get();
  const studentNumber = snap.docs.filter((d) => String(d.data().gender || "").trim().toLowerCase() === wanted).length;
  res.status(200).json({ status: "ok", message: "Students counted", studentNumber });
});

/** GET /api/admin/search?searchTerm= - courses (plus programmes and students). */
exports.SearchEverything = catchAsync(async (req, res) => {
  const term = String(req.query.searchTerm || req.query.query || "").trim().toLowerCase();
  if (!term) return res.status(200).json({ success: true, status: "ok", resultFromCourses: [], resultFromPrograms: [], resultFromStudents: [] });
  const has = (...vals) => vals.some((v) => String(v || "").toLowerCase().includes(term));
  const [courses, programs, users] = await Promise.all([
    db.collection("courses").get(),
    db.collection("programs").get(),
    db.collection("users").get(),
  ]);
  res.status(200).json({
    success: true,
    status: "ok",
    resultFromCourses: courses.docs
      .map((d) => ({ ...d.data(), id: d.id, lesson: undefined }))
      .filter((c) => Number(c.status) === 1 && has(c.title, c.description, c.level, c.creator))
      .slice(0, 50),
    resultFromPrograms: programs.docs.map((d) => ({ ...d.data(), id: d.id })).filter((p) => has(p.program_name, p.description)).slice(0, 20),
    resultFromStudents: users.docs.map((d) => ({ ...d.data(), id: d.data().id || d.id })).filter((u) => has(u.name, u.username, u.email)).slice(0, 20),
  });
});

/** DELETE /api/announcements/announcements?announcement_id= */
exports.DeleteAnnouncement = catchAsync(async (req, res, next) => {
  const id = String(req.query.announcement_id || "");
  if (!id) return next(new AppError("announcement_id is required", 400));
  const ref = db.collection("announcements").doc(id);
  if (!(await ref.get()).exists) return next(new AppError("Announcement not found", 404));
  await ref.delete();
  res.status(200).json({ status: "ok", message: "Announcement deleted", data: { id } });
});
