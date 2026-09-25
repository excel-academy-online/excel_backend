const n = require("../controllers/notification.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const router = require("express").Router();

// A student's own notifications and devices.
router.get("/", requireAuth, n.ListNotifications);
router.patch("/read", requireAuth, n.MarkAllRead);
router.post("/token", requireAuth, n.RegisterToken);
router.delete("/token", requireAuth, n.RemoveToken);

// Sending is staff-only.
router.post("/broadcast", ...requireAdmin, n.AdminBroadcast);
router.post("/send", ...requireAdmin, n.AdminSend);

module.exports = router;
