const {
  uploadCert,
  SendCertificate,
  getAllCertificates,
  ResendCertificate,
} = require("../controllers/cert.controller");
const upload = require("../utils/multer");
const { requireAdmin } = require("../middleware/auth");
const router = require("express").Router();
require("dotenv").config();

// Issuing and re-sending certificates is an administrative act end to end.
router.post("/uploadcertificate", ...requireAdmin, upload.single("image"), uploadCert);
router.post("/issueCertificates", ...requireAdmin, SendCertificate);
router.post("/resendCertificate", ...requireAdmin, ResendCertificate);
router.get("/getAllCertificates", ...requireAdmin, getAllCertificates);

module.exports = router;
