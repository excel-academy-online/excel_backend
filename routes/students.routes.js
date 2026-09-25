const {
  enrollCourse,
  getStudents,
  GetAllStudents,
  getStudentDetail,
} = require("../controllers/student.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { CheckRecovery, ClaimRecovery } = require("../controllers/recovery.controller");
const { MyCourses } = require("../controllers/myCourses.controller");
const sd = require("../controllers/studentData.controller");
const router = require("express").Router();
require("dotenv").config();

router.post("/enroll", requireAuth, enrollCourse);

// Restoring pre-migration purchases. The email comes from the verified token,
// so a student can only ever claim their own.
router.get("/recovery", requireAuth, CheckRecovery);
router.post("/recovery/claim", requireAuth, ClaimRecovery);

// The signed-in student's own enrolled courses, with playable lessons.
router.get("/my-courses", requireAuth, MyCourses);

// The student's own notes, bookmarks, progress, receipts and achievements.
router.get("/notes", requireAuth, sd.ListNotes);
router.post("/notes", requireAuth, sd.CreateNote);
router.patch("/notes/:id", requireAuth, sd.UpdateNote);
router.delete("/notes/:id", requireAuth, sd.DeleteNote);
router.get("/bookmarks", requireAuth, sd.GetBookmarks);
router.put("/bookmarks", requireAuth, sd.SetBookmarks);
router.post("/progress", requireAuth, sd.MarkLessonComplete);
router.get("/orders", requireAuth, sd.MyOrders);
router.get("/orders/:reference/receipt", requireAuth, sd.Receipt);
router.get("/achievements", requireAuth, sd.Achievements);

// Student rosters and individual records are staff-only.
router.get("/getStudents", ...requireAdmin, getStudents);
router.get("/getAllStudents", ...requireAdmin, GetAllStudents);
router.get("/getStudentDetail", ...requireAdmin, getStudentDetail);

module.exports = router;
