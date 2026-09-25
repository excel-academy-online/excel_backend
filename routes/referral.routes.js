const r = require("../controllers/referral.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { StrictLimiter } = require("../middleware/Limiter");
const router = require("express").Router();

router.post("/claim", requireAuth, StrictLimiter, r.ClaimReferral);
router.get("/stats", requireAuth, r.Stats);
router.get("/bank", requireAuth, r.GetBank);
router.put("/bank", requireAuth, r.SetBank);
router.post("/payout", requireAuth, StrictLimiter, r.RequestPayout);

// Paying students out is done by staff.
router.get("/admin/payouts", ...requireAdmin, r.AdminListPayouts);
router.patch("/admin/payouts/:id", ...requireAdmin, r.AdminDecidePayout);

module.exports = router;
