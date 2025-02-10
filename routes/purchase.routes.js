const { InitializePayment, VerifyPayment } = require("../controllers/purchaseCourse.controller");

const router = require("express").Router();
require("dotenv").config();

router.post("/initialize-payment", InitializePayment);
router.get('/verify-payment/:reference', VerifyPayment);


module.exports = router;