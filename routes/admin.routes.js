const upload = require("../utils/multer");
const { AdminRegister, AdminLogin, AdminLogOut, AdminChangePassword, AdminSearchEverything, EditProfile } = require("../controllers/admin.controller");
const router = require("express").Router();
require("dotenv").config();

router.post("/register", upload.single("picture"), AdminRegister);
router.post("/login", AdminLogin);
router.post("/resetpassword", AdminChangePassword);
router.post("/updateProfile", EditProfile);
router.patch("/logout", AdminLogOut);
router.get('/search', AdminSearchEverything);

module.exports = router;
