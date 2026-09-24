/**
 * Does this user have an active enrolment in this course?
 *
 * Enrolments written by purchase recovery and by the payment flow use the
 * deterministic id `<uid>_<courseId>`, so the common case is one document
 * read. Older enrolments created through the dashboard have random ids, so
 * a query is the fallback.
 */
const { db } = require("../firebaseadminvar");

async function ownsCourse(uid, courseId) {
  if (!uid || !courseId) return false;
  const direct = await db.collection("enrollments").doc(`${uid}_${courseId}`).get();
  if (direct.exists) return (direct.data().status || "active") === "active";

  const snap = await db
    .collection("enrollments")
    .where("student_id", "==", uid)
    .where("course_id", "==", String(courseId))
    .limit(1)
    .get();
  return !snap.empty && (snap.docs[0].data().status || "active") === "active";
}

/** Every course id this user is actively enrolled in. */
async function ownedCourseIds(uid) {
  if (!uid) return [];
  const snap = await db.collection("enrollments").where("student_id", "==", uid).get();
  return snap.docs
    .map((d) => d.data())
    .filter((e) => (e.status || "active") === "active")
    .map((e) => String(e.course_id));
}

module.exports = { ownsCourse, ownedCourseIds };
