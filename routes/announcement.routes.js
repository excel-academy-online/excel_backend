const upload = require("../utils/multer");
const {
  GetAnnouncements,
  AddAnnouncement,
  DeleteAnnouncement,
  EditAnnouncement,
  PublishAnnouncement,
} = require("../controllers/announcement.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = require("express").Router();
require("dotenv").config();

router.post("/addAnnouncement", ...requireAdmin, upload.single("image"), AddAnnouncement);
router.post("/editAnnouncement", ...requireAdmin, upload.single("image"), EditAnnouncement);
router.post("/publishAnnouncement", ...requireAdmin, PublishAnnouncement);
router.delete("/announcements", ...requireAdmin, DeleteAnnouncement);

router.get("/getAnnouncements", requireAuth, GetAnnouncements);

router.delete("/announcements", ...requireAdmin, require("../controllers/adminTools.controller").DeleteAnnouncement);

module.exports = router;
