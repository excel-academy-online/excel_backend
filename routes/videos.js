const upload = require("../utils/multer");
const {
  UploadVideo,
  CreateCourses,
  GetCourseDetails,
  GetAllCourses,
  PlayDecryptVideo,
  SearchCourse,
} = require("../controllers/course.controller");
const router = require("express").Router();
require("dotenv").config();

router.post("/course-upload", upload.single("video"), UploadVideo);
router.post("/create-course",upload.single("image"), CreateCourses);
router.get("/get-course-details/:courseId", GetCourseDetails);
router.get("/all-courses", GetAllCourses);
router.get('/search', SearchCourse);

router.get("/decrypt", PlayDecryptVideo);

module.exports = router;
