const {
  InitializePayment,
  VerifyPayment,
} = require("../controllers/purchaseCourse.controller");
const { StrictLimiter } = require("../middleware/Limiter");
const { optionalAuth } = require("../middleware/auth");

const router = require("express").Router();
require("dotenv").config();

// NOTE: the shipped ExcelGroup app calls both of these without an
// Authorization header, so they cannot require auth yet without breaking the
// released client. Until that client is updated they are guarded by:
//   - the server recomputing the price from the database (the client-supplied
//     amount is never trusted), and
//   - the Paystack reference being verified against Paystack directly.
// TODO: once ExcelGroup ships a build that attaches the Firebase ID token,
// swap `optionalAuth` for `requireAuth` and drop the email/user_id matching in
// favour of req.uid.
router.post("/initialize-payment", StrictLimiter, optionalAuth, InitializePayment);
router.get("/verify-payment/:reference", StrictLimiter, optionalAuth, VerifyPayment);

module.exports = router;
