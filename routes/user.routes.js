const {
  Register,
  Login,
  FetchAllUsers,
  FetchUsersByGender,
  FetchUserDetails,
  UpdateUserDP,
  toggleUserStatus,
} = require("../controllers/user.controller");
const upload = require("../utils/multer");
const { StrictLimiter } = require("../middleware/Limiter");
const {
  requireAuth,
  requireAdmin,
  requireSelfOrAdmin,
} = require("../middleware/auth");
const router = require("express").Router();

// Public: account creation and sign-in. Rate limited - these are the two
// endpoints worth brute-forcing.
router.post("/register", StrictLimiter, upload.single("image"), Register);
router.patch("/login", StrictLimiter, Login);

// A user may change their own picture; an admin may change anyone's.
router.post(
  "/updateUserDP",
  requireAuth,
  requireSelfOrAdmin("user_id"),
  upload.single("image"),
  UpdateUserDP
);

// Admin-only: enumerating users and enabling/disabling accounts.
router.post("/toggleUserStatus", ...requireAdmin, toggleUserStatus);
router.get("/all-users", ...requireAdmin, FetchAllUsers);
router.get("/fetch-by-gender", ...requireAdmin, FetchUsersByGender);

router.get("/fetch-user/:id", requireAuth, requireSelfOrAdmin("id"), FetchUserDetails);

module.exports = router;
