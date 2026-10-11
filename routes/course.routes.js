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

// --- Old enrolled-student surface (dashboard only now) ------------------
// These take any course/student id and return the paid product (lessons,
// answers) or other students' data, so they are staff only. The app uses
// /get-course-details, /students/* and /mock-exams instead.
router.get("/getCoursesLessons", ...requireAdmin, getCoursesLessons);
router.get("/getAllQuiz", ...requireAdmin, getQuiz);
router.get("/getExams", ...requireAdmin, getExams);
router.get("/getExamsByType", ...requireAdmin, getExamsByType);
// Enrols without payment - staff only.
router.post("/enrollCourse", ...requireAdmin, enrollCourse);
router.post("/updateCourseProgress", ...requireAdmin, updateCourseProgress);
router.get("/getEnrolledCourses", ...requireAdmin, getEnrolledCourses);
router.get("/getEnrolledCoursesByStudentId", ...requireAdmin, getEnrolledCoursesByStudentId);
router.get("/getEnrolledCoursesWithProgress", ...requireAdmin, getEnrolledCoursesWithProgress);

// Roster of everyone on a course - staff information.
router.get("/getEnrolledStudentsByCourseId", ...requireAdmin, getEnrolledStudentsByCourseId);

// Programmes as the app shows them, and editing a course's listing.
const courseAdmin = require("../controllers/courseAdmin.controller");
router.get("/programmes", ...requireAdmin, courseAdmin.ListProgrammes);
router.patch("/:courseId/edit", ...requireAdmin, courseAdmin.UpdateCourse);

// Course reviews: anyone reads, enrolled students write their own.
const reviews = require("../controllers/review.controller");
router.get("/:courseId/reviews", optionalAuth, reviews.ListReviews);
router.post("/:courseId/reviews", requireAuth, reviews.SaveReview);
router.delete("/:courseId/reviews/:uid", requireAuth, reviews.DeleteReview);

module.exports = router;
