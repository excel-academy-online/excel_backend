const r = require("../controllers/roles.controller");
const { requireAdmin } = require("../middleware/auth");
const router = require("express").Router();

// Staff roles. Listing is for any admin; changing needs superadmin (checked in the controller).
router.get("/staff", ...requireAdmin, r.ListStaff);
router.post("/:uid", ...requireAdmin, r.SetRole);

module.exports = router;
