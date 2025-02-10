const upload = require("../utils/multer");
const { GetAnnouncements, AddAnnouncement, DeleteAnnouncement, EditAnnouncement, PublishAnnouncement } = require ("../controllers/announcement.controller");
// import { single } from "../utils/multer";

const router = require("express").Router();
require("dotenv").config();


router.get("/getAnnouncements", GetAnnouncements);
router.delete("/announcements", DeleteAnnouncement);
router.post("/addAnnouncement", upload.single("image"), AddAnnouncement);
router.post("/editAnnouncement", upload.single("image"), EditAnnouncement);
router.post("/publishAnnouncement", PublishAnnouncement);

module.exports = router;

