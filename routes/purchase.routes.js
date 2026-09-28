const {
  InitializePayment,
  VerifyPayment,
  PaystackWebhook,
  PaymentCallback,
} = require("../controllers/payment.controller");
const { StrictLimiter } = require("../middleware/Limiter");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { AdminListPayments, AdminVerifyPayment } = require("../controllers/payment.controller");

const router = require("express").Router();

// The buyer is taken from the verified token, so both calls now require a
// signed-in student. (The old version accepted anonymous calls and trusted an
// email in the body - the app sent the same hardcoded test email every time.)
router.post("/initialize-payment", StrictLimiter, requireAuth, InitializePayment);
router.get("/verify-payment/:reference", StrictLimiter, requireAuth, VerifyPayment);

// Paystack's server calls this; it proves itself with an HMAC signature
// instead of a user token.
router.post("/webhook", PaystackWebhook);

// The page Paystack redirects the browser to; the app closes its web view on it.
router.get("/callback", PaymentCallback);

// Staff: see payments and re-check stuck ones with Paystack.
router.get("/admin/payments", ...requireAdmin, AdminListPayments);
router.post("/admin/payments/:reference/verify", ...requireAdmin, AdminVerifyPayment);

module.exports = router;
