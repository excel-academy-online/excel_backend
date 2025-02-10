const upload = require("../utils/multer");
// const { getDashboardData, uploadCourses, getCourses, uploadProgram, getPrograms, enrollCourse } = require("../controllers/dashboard.conttroller");
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
const router = require("express").Router();
require("dotenv").config();

router.post("/createProgram", upload.single("image"), createProgram);
router.post(
  "/createProgramCourse",
  upload.single("image"),
  createProgramCourse
);
router.patch("/deletePrograms/:program_id", deleteProgram);
router.patch("/addLevelsToPrograms/:program_id", addLevelsToProgram);
router.patch("/removeLevelsFromProgram/:program_id", removeLevelsFromProgram);
router.patch("/deleteCourse/:course_id", deleteCourse);
router.patch("/editLessonSession/:course_id/lessons/:session_id", editLessonSession);
router.get("/getAllPrograms", getAllPrograms);
router.get("/getAllProgramsCourses", getAllProgramsCourses);
router.get("/getAllCoursesViaLevel", getAllCoursesViaLevel);
router.get("/getAllCourses", getAllCourses);
router.post("/createLessonSession", createLessonSession);
router.post(
  "/uploadSessionContent",
  upload.array("media"),
  uploadSessionContent
);
router.get("/getCoursesLessons", getCoursesLessons);
router.post("/createFaq", createFaq);
router.post("/multipleCreateFaq", multipleCreateFaq);
router.post("/enrollCourse", enrollCourse);
router.get("/getAllFaq", getAllFaq);
router.post("/createQuiz", upload.array("media"), createQuiz);
router.get("/getAllQuiz", getQuiz);
router.post("/createExams", upload.array("media"), createExams);
router.post("/createMultipleExams", upload.array("media"), createMultipleExams);
router.get("/getExams", getExams);
router.get("/getExamsByType", getExamsByType);
router.get("/searchCourses", searchCourses);
router.post("/updateCourseProgress", updateCourseProgress);
router.get("/getEnrolledCourses", getEnrolledCourses);
router.get("/getEnrolledCoursesByStudentId", getEnrolledCoursesByStudentId);
router.get("/getEnrolledStudentsByCourseId", getEnrolledStudentsByCourseId);
router.get("/getEnrolledCoursesWithProgress", getEnrolledCoursesWithProgress);


// router.post("/createCourseAssignment", upload.single("image"), createCourseAssignment);
// router.post("/createCourseExams", upload.single("image"), createCourseExams);

// router.post("/createCourse", upload.single("image"), uploadCourses);
// router.get('/getcourses', getCourses);
// router.get('/getPrograms', getPrograms);

module.exports = router;
