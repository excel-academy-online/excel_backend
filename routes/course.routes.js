const upload = require("../utils/multer");
const {
  createProgram,
  deleteProgram,
  addLevelsToProgram,
  removeLevelsFromProgram,
  getAllPrograms,
  createProgramCourse,
  deleteCourse,
  getAllProgramsCourses,
  getAllCoursesViaLevel,
  getAllCourses,
  createLessonSession,
  editLessonSession,
  uploadSessionContent,
  createFaq,
  getAllFaq,
  createQuiz,
  getQuiz,
  createExams,
  createMultipleExams,
  getExams,
  getExamsByType,
  getCoursesLessons,
  searchCourses,
  enrollCourse,
  updateCourseProgress,
  getEnrolledCourses,
  getEnrolledCoursesByStudentId,
  getEnrolledCoursesWithProgress,
  getEnrolledStudentsByCourseId,
  multipleCreateFaq,
} = require("../controllers/course.controller");
const { requireAuth, requireAdmin, optionalAuth } = require("../middleware/auth");
const router = require("express").Router();
require("dotenv").config();

// --- Authoring: admin only ---------------------------------------------
router.post("/createProgram", ...requireAdmin, upload.single("image"), createProgram);
router.post("/createProgramCourse", ...requireAdmin, upload.single("image"), createProgramCourse);
router.patch("/deletePrograms/:program_id", ...requireAdmin, deleteProgram);
router.patch("/addLevelsToPrograms/:program_id", ...requireAdmin, addLevelsToProgram);
router.patch("/removeLevelsFromProgram/:program_id", ...requireAdmin, removeLevelsFromProgram);
router.patch("/deleteCourse/:course_id", ...requireAdmin, deleteCourse);
router.patch("/editLessonSession/:course_id/lessons/:session_id", ...requireAdmin, editLessonSession);
router.post("/createLessonSession", ...requireAdmin, createLessonSession);
router.post("/uploadSessionContent", ...requireAdmin, upload.array("media"), uploadSessionContent);
router.post("/createFaq", ...requireAdmin, createFaq);
router.post("/multipleCreateFaq", ...requireAdmin, multipleCreateFaq);
router.post("/createQuiz", ...requireAdmin, upload.array("media"), createQuiz);
router.post("/createExams", ...requireAdmin, upload.array("media"), createExams);
router.post("/createMultipleExams", ...requireAdmin, upload.array("media"), createMultipleExams);

// --- Public catalogue ---------------------------------------------------
// Programme and course listings are marketing surface: they must render for a
// signed-out visitor browsing the store.
router.get("/getAllPrograms", optionalAuth, getAllPrograms);
router.get("/getAllProgramsCourses", optionalAuth, getAllProgramsCourses);
router.get("/getAllCoursesViaLevel", optionalAuth, getAllCoursesViaLevel);
router.get("/getAllCourses", optionalAuth, getAllCourses);
router.get("/searchCourses", optionalAuth, searchCourses);
router.get("/getAllFaq", optionalAuth, getAllFaq);

// --- Enrolled-student surface ------------------------------------------
// Lesson bodies, quizzes and exams are the paid product; never anonymous.
router.get("/getCoursesLessons", requireAuth, getCoursesLessons);
router.get("/getAllQuiz", requireAuth, getQuiz);
router.get("/getExams", requireAuth, getExams);
router.get("/getExamsByType", requireAuth, getExamsByType);
router.post("/enrollCourse", requireAuth, enrollCourse);
router.post("/updateCourseProgress", requireAuth, updateCourseProgress);
router.get("/getEnrolledCourses", requireAuth, getEnrolledCourses);
router.get("/getEnrolledCoursesByStudentId", requireAuth, getEnrolledCoursesByStudentId);
router.get("/getEnrolledCoursesWithProgress", requireAuth, getEnrolledCoursesWithProgress);

// Roster of everyone on a course - staff information.
router.get("/getEnrolledStudentsByCourseId", ...requireAdmin, getEnrolledStudentsByCourseId);

module.exports = router;
