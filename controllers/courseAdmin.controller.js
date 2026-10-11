/**
 * Staff tools for the catalogue the app shows:
 *
 *   GET   /api/course/programmes        the app's programmes, with their levels
 *                                       and how many courses each has
 *   PATCH /api/course/:courseId/edit    change a course's title, price,
 *                                       programme, level, package or status
 *
 * The app lists a course under a programme by its `program` code and under a
 * level by its `level` text (see utils/programmes.js), so the dashboard edits
 * exactly those fields.
 */
const { db } = require("../firebaseadminvar");
const AppError = require("../utils/errors/AppError");
const catchAsync = require("../utils/errors/catchAsync");
const { PROGRAMMES, CODES, programmeOf } = require("../utils/programmes");

const norm = (s) => String(s || "").trim().toUpperCase();

/** GET /api/course/programmes */
exports.ListProgrammes = catchAsync(async (req, res) => {
  const snap = await db.collection("courses").get();
  const stats = Object.fromEntries(PROGRAMMES.map((p) => [p.code, { courses: 0, live: 0, levels: {} }]));
  const courseProgramme = {};
  let unassigned = 0;
  for (const d of snap.docs) {
    const c = { id: d.id, ...d.data() };
    const code = programmeOf(c);
    courseProgramme[d.id] = code;
    if (!code) { unassigned++; continue; }
    const s = stats[code];
    s.courses++;
    if (Number(c.status) === 1) s.live++;
    const lvl = norm(c.level);
    if (lvl) s.levels[lvl] = (s.levels[lvl] || 0) + 1;
  }
  res.status(200).json({
    status: "ok",
    message: "Programmes",
    data: {
      programmes: PROGRAMMES.map((p) => ({
        ...p,
        courses: stats[p.code].courses,
        live: stats[p.code].live,
        levelCounts: p.levels.map((l) => ({ level: l, courses: stats[p.code].levels[norm(l)] || 0 })),
      })),
      courseProgramme,
      unassigned,
    },
  });
});

/** PATCH /api/course/:courseId/edit  { title?, description?, price?, cancelPrice?, program?, level?, package?, status?, isFree? } */
exports.UpdateCourse = catchAsync(async (req, res, next) => {
  const ref = db.collection("courses").doc(String(req.params.courseId));
  const snap = await ref.get();
  if (!snap.exists) return next(new AppError("Course not found", 404));

  const b = req.body || {};
  const patch = {};
  if (b.title !== undefined) {
    const t = String(b.title).trim();
    if (!t) return next(new AppError("The title can't be empty", 400));
    patch.title = t.slice(0, 200);
  }
  if (b.description !== undefined) patch.description = String(b.description).slice(0, 5000);
  for (const k of ["price", "cancelPrice"]) {
    if (b[k] === undefined) continue;
    const n = Number(String(b[k]).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 10000000) return next(new AppError(`Invalid ${k}`, 400));
    patch[k] = Math.round(n);
  }
  if (b.program !== undefined) {
    const code = norm(b.program);
    if (code && !CODES.has(code)) return next(new AppError(`Unknown programme "${b.program}"`, 400));
    patch.program = code;
  }
  if (b.level !== undefined) {
    const code = patch.program !== undefined ? patch.program : programmeOf({ id: snap.id, ...snap.data() });
    const levels = (PROGRAMMES.find((p) => p.code === code) || { levels: [] }).levels;
    const lvl = norm(b.level);
    // The app files a course under a level only when it matches the programme's list.
    if (lvl && levels.length && !levels.includes(lvl)) {
      return next(new AppError(`"${b.level}" is not a ${code} level. Use one of: ${levels.join(", ")}`, 400));
    }
    patch.level = lvl;
  }
  if (b.package !== undefined) patch.package = String(b.package).trim().slice(0, 80);
  if (b.status !== undefined) {
    const s = Number(b.status);
    if (![0, 1].includes(s)) return next(new AppError("Status must be 1 (published) or 0 (hidden)", 400));
    patch.status = s;
  }
  if (b.isFree !== undefined) patch.isFree = b.isFree === true || b.isFree === "true";
  if (!Object.keys(patch).length) return next(new AppError("Nothing to change", 400));

  const after = { ...snap.data(), ...patch };
  const touchesSale = ["status", "price", "isFree"].some((k) => k in patch);
  if (touchesSale && Number(after.status) === 1 && !after.isFree && !(Number(after.price) > 0)) {
    return next(new AppError("Set a price (or mark it free) before publishing - students can't buy a course with no price", 400));
  }

  patch.dateUpdated = new Date().toISOString();
  await ref.set(patch, { merge: true });
  // The app's catalogue is cached for a minute; show the change straight away.
  require("./course.controller")._resetCatalogueCache();

  res.status(200).json({ status: "ok", message: "Course updated", data: { id: snap.id, ...patch } });
});
