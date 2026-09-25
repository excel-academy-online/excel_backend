const upload = require("../utils/multer");
const {
  AdminRegister,
  AdminLogin,
  AdminLogOut,
  AdminChangePassword,
  AdminSearchEverything,
  EditProfile,
} = require("../controllers/admin.controller");
const { StrictLimiter } = require("../middleware/Limiter");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const router = require("express").Router();
require("dotenv").config();

// Creating an admin is itself an admin action - otherwise anyone who can reach
// the server can mint themselves an administrator. Bootstrap the first admin
// with `node scripts/setRole.js <email> admin`.
router.post("/register", ...requireAdmin, upload.single("picture"), AdminRegister);

router.post("/login", StrictLimiter, AdminLogin);

router.post("/resetpassword", StrictLimiter, requireAuth, AdminChangePassword);
router.post("/updateProfile", requireAuth, EditProfile);
router.patch("/logout", requireAuth, AdminLogOut);
router.get("/search", ...requireAdmin, require("../controllers/adminTools.controller").SearchEverything);

module.exports = router;
