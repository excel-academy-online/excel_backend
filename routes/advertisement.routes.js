const upload = require("../utils/multer");
const {
  AddAdvertisement,
  EditAdvertisementPost,
  PublishAdvertisementPost,
  GetAdvertisementPost,
  DeleteAdvertisementPost,
} = require("../controllers/advertisement.controller");
const { requireAdmin, optionalAuth } = require("../middleware/auth");

const router = require("express").Router();
require("dotenv").config();

router.post("/addAdvertisement", ...requireAdmin, upload.single("image"), AddAdvertisement);
router.post("/editAdvertisementPost", ...requireAdmin, upload.single("image"), EditAdvertisementPost);
router.post("/publishAdvertisementPost", ...requireAdmin, PublishAdvertisementPost);
router.delete("/deleteAdvertisementPost", ...requireAdmin, DeleteAdvertisementPost);

// Adverts are promotional banners shown in-app; readable without an account.
router.get("/getAdvertisementPost", optionalAuth, GetAdvertisementPost);

module.exports = router;
