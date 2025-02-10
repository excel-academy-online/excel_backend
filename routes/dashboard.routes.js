const upload = require("../utils/multer");
const { getDashboardData, uploadCourses, getCourses, uploadProgram, getPrograms, enrollCourse } = require("../controllers/dashboard.conttroller");
const router = require("express").Router();
require("dotenv").config();

router.post("/uploadcourse", upload.single("image"), uploadCourses);
router.post("/addprogram", upload.single("image"), uploadProgram);

router.get('/getdashboarddata', getDashboardData);
router.get('/getcourses', getCourses);
router.get('/getPrograms', getPrograms);

module.exports = router;
