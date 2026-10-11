const router = require("express").Router();
const { Backup } = require("../controllers/backup.controller");

// Called by the VPS cron with the shared X-Backup-Key, not a user token.
router.post("/backup", Backup);

module.exports = router;
