const upload = require("../utils/multer");
const {
  getDashboardData,
  uploadCourses,
  getCourses,
  uploadProgram,
  getPrograms,
} = require("../controllers/dashboard.conttroller");
const { requireAdmin } = require("../middleware/auth");
const router = require("express").Router();
require("dotenv").config();

// The admin dashboard: aggregate business figures and course authoring.
router.post("/uploadcourse", ...requireAdmin, upload.single("image"), uploadCourses);
router.post("/addprogram", ...requireAdmin, upload.single("image"), uploadProgram);
router.get("/getdashboarddata", ...requireAdmin, getDashboardData);
router.get("/getcourses", ...requireAdmin, getCourses);
router.get("/getPrograms", ...requireAdmin, getPrograms);

module.exports = router;
