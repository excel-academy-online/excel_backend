const c = require("../controllers/adminChat.controller");
const { requireAuth } = require("../middleware/auth");
const router = require("express").Router();

// Direct messages between a student and one specific admin (group "Message2Admin").
// Signed-in users only; the controller checks each person is in the thread.
router.get("/admins", requireAuth, c.ListAdmins);
router.get("/threads", requireAuth, c.ListThreads);
router.get("/threads/:withUid/messages", requireAuth, c.ListMessages);
router.post("/threads/:withUid/messages", requireAuth, c.Send);
router.patch("/threads/:withUid/read", requireAuth, c.MarkRead);

module.exports = router;
