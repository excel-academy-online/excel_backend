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
const router = require("express").Router();

router.post("/register",upload.single("image"), Register);
router.post("/updateUserDP",upload.single("image"), UpdateUserDP);
router.post("/toggleUserStatus", toggleUserStatus);

router.patch("/login", Login);
router.get("/all-users", FetchAllUsers);
router.get("/fetch-by-gender", FetchUsersByGender);
router.get("/fetch-user/:id", FetchUserDetails)
module.exports = router;
