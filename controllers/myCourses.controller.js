/**
 * GET /api/students/my-courses - the signed-in student's enrolled courses.
 *
 * Returned in the same legacy shape as /api/all-courses so the app parses both
 * with one model. Because the caller owns these courses, lesson video URLs are
 * included. Enrolment progress is attached per course.
 */
const { db } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const { legacyCourse } = require("../utils/legacyCourseShape");

module.exports.MyCourses = catchAsync(async (req, res) => {
  const snap = await db.collection("enrollments").where("student_id", "==", req.uid).get();
  const enrolments = snap.docs
    .map((d) => d.data())
    .filter((e) => (e.status || "active") === "active");

  const byCourse = new Map(enrolments.map((e) => [String(e.course_id), e]));
  const ids = [...byCourse.keys()];

  const docs = ids.length
    ? await db.getAll(...ids.map((id) => db.collection("courses").doc(id)))
    : [];

  const courses = docs
    .filter((d) => d.exists)
    .map((d) => {
      const e = byCourse.get(d.id);
      return {
        ...legacyCourse({ _id: d.id, ...d.data() }, { owned: true, withLessons: false }),
        enrolledAt: e.enrollment_date || null,
        progress: e.progress || null,
      };
    });

  // Same status code and key the app already expects from the course list.
  res.status(202).json({
    status: "ok",
    message: "Enrolled courses fetched successfully",
    AllCourses: courses,
  });
});
