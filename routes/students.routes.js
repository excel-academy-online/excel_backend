const {
  enrollCourse,
  getStudents,
  GetAllStudents,
  getStudentDetail,
} = require("../controllers/student.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { CheckRecovery, ClaimRecovery } = require("../controllers/recovery.controller");
const { MyCourses } = require("../controllers/myCourses.controller");
const router = require("express").Router();
require("dotenv").config();

router.post("/enroll", requireAuth, enrollCourse);

// Restoring pre-migration purchases. The email comes from the verified token,
// so a student can only ever claim their own.
router.get("/recovery", requireAuth, CheckRecovery);
router.post("/recovery/claim", requireAuth, ClaimRecovery);

// The signed-in student's own enrolled courses, with playable lessons.
router.get("/my-courses", requireAuth, MyCourses);

// Student rosters and individual records are staff-only.
router.get("/getStudents", ...requireAdmin, getStudents);
router.get("/getAllStudents", ...requireAdmin, GetAllStudents);
router.get("/getStudentDetail", ...requireAdmin, getStudentDetail);

module.exports = router;
