/**
 * GET /api/course-sections - which courses go in the home screen's Trending,
 * New and Recommended rows. Returns ids only; the app already has the
 * catalogue from /all-courses.
 *
 *   trending     most enrolments in the last 30 days (all time as tie-break)
 *   newest       most recently created
 *   recommended  signed in: courses in the programmes the student already
 *                studies that they don't own yet; otherwise most enrolled
 */
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");

const TTL_MS = 10 * 60 * 1000;
const LIMIT = 10;
const DAY = 24 * 60 * 60 * 1000;
let cache = null;

const when = (c) => {
  for (const v of [c.createdAt, c.datecreated, c.date, c.dateCreated, c.importedAt]) {
    const t = v && typeof v.toMillis === "function" ? v.toMillis() : Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return 0;
};

async function load() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const [courseSnap, enrolSnap] = await Promise.all([
    db.collection("courses").get(),
    db.collection("enrollments").get(),
  ]);
  const courses = courseSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => Number(c.status) === 1);
  const live = new Set(courses.map((c) => c.id));

  const recent = {};
  const total = {};
  const since = Date.now() - 30 * DAY;
  const enrolments = enrolSnap.docs.map((d) => d.data());
  for (const e of enrolments) {
    if (!live.has(e.course_id)) continue;
    total[e.course_id] = (total[e.course_id] || 0) + 1;
    if (Date.parse(e.enrollment_date) >= since) recent[e.course_id] = (recent[e.course_id] || 0) + 1;
  }

  const byPopularity = [...courses]
    .sort((a, b) => (recent[b.id] || 0) - (recent[a.id] || 0) || (total[b.id] || 0) - (total[a.id] || 0))
    .map((c) => c.id);
  const newest = [...courses].sort((a, b) => when(b) - when(a)).map((c) => c.id);

  cache = { at: Date.now(), courses, enrolments, byPopularity, newest, total };
  return cache;
}

exports.CourseSections = catchAsync(async (req, res) => {
  const data = await load();
  let recommended = data.byPopularity;

  if (req.uid) {
    const owned = new Set(data.enrolments.filter((e) => e.student_id === req.uid).map((e) => e.course_id));
    const programs = new Set(
      data.courses.filter((c) => owned.has(c.id)).map((c) => c.programId || c.program_id || c.level).filter(Boolean)
    );
    const related = data.byPopularity.filter((id) => {
      if (owned.has(id)) return false;
      const c = data.courses.find((x) => x.id === id);
      return programs.has(c.programId || c.program_id || c.level);
    });
    recommended = [...related, ...data.byPopularity.filter((id) => !owned.has(id) && !related.includes(id))];
  }

  res.status(200).json({
    status: "ok",
    message: "Course sections fetched",
    data: {
      trending: data.byPopularity.slice(0, LIMIT),
      newest: data.newest.slice(0, LIMIT),
      recommended: recommended.slice(0, LIMIT),
    },
  });
});

exports._resetCache = () => { cache = null; };
