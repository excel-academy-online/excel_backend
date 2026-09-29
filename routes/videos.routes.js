const v = require("../controllers/videos.controller");
const { requireAdmin } = require("../middleware/auth");
const router = require("express").Router();

// Staff: which lessons use each VPS video (for the dashboard's Videos page).
router.get("/usage", ...requireAdmin, v.Usage);

module.exports = router;
