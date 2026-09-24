const upload = require("../utils/multer");
const {
  UploadVideo,
  CreateCourses,
  GetCourseDetails,
  GetAllCourses,
  PlayDecryptVideo,
  SearchCourse,
} = require("../controllers/course.controller");
const { requireAuth, requireAdmin, optionalAuth } = require("../middleware/auth");
const router = require("express").Router();
require("dotenv").config();

// --- Admin: course authoring -------------------------------------------
router.post("/course-upload", ...requireAdmin, upload.single("video"), UploadVideo);
router.post("/create-course", ...requireAdmin, upload.single("image"), CreateCourses);

// --- Public catalogue ---------------------------------------------------
// NOTE: the shipped ExcelGroup app (v1) calls these three with no
// Authorization header, so they must stay reachable anonymously. They only
// expose catalogue data, not lesson content. `optionalAuth` populates req.user
// when a token IS supplied, so handlers can tailor the response once the
// client is updated to send one.
router.get("/get-course-details/:courseId", optionalAuth, GetCourseDetails);
router.get("/all-courses", optionalAuth, GetAllCourses);
router.get("/search", optionalAuth, SearchCourse);

// --- Paid content -------------------------------------------------------
// Decrypting a video hands over purchased material; this one is never public.
router.get("/decrypt", requireAuth, PlayDecryptVideo);

module.exports = router;
