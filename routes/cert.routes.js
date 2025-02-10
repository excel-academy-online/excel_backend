const { uploadCert, SendCertificate, getAllCertificates, ResendCertificate } = require("../controllers/cert.controller");
const upload = require("../utils/multer");
const router = require("express").Router();
require("dotenv").config();

router.post("/uploadcertificate", upload.single("image"), uploadCert);
router.post("/issueCertificates",  SendCertificate);
router.post("/resendCertificate",  ResendCertificate);
router.get("/getAllCertificates",  getAllCertificates);


module.exports = router;