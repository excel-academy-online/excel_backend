const upload = require("../utils/multer");
const {
  AddAdvertisement,
  EditAdvertisementPost,
  PublishAdvertisementPost,
  GetAdvertisementPost,
  DeleteAdvertisementPost,
} = require("../controllers/advertisement.controller");
// import { single } from "../utils/multer";

const router = require("express").Router();
require("dotenv").config();

router.post("/addAdvertisement", upload.single("image"), AddAdvertisement);
router.post(
  "/editAdvertisementPost",
  upload.single("image"),
  EditAdvertisementPost
);
router.post("/publishAdvertisementPost", PublishAdvertisementPost);
router.get("/getAdvertisementPost", GetAdvertisementPost);
router.delete("/deleteAdvertisementPost", DeleteAdvertisementPost);

module.exports = router;
