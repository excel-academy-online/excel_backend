
const { get } = require("mongoose");
const { enrollCourse, getStudents, GetAllStudents, getStudentDetail } = require("../controllers/student.controller");
const router = require("express").Router();
require("dotenv").config();



router.post('/enroll', enrollCourse);

router.get('/getStudents', getStudents);
router.get('/getAllStudents', GetAllStudents);
router.get('/getStudentDetail', getStudentDetail);

module.exports = router;
