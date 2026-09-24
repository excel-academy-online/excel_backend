const {
  ListConversations,
  GetConversation,
  ListMessages,
  SendMessage,
  MarkRead,
  SetStatus,
} = require("../controllers/chat.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const router = require("express").Router();

// The inbox lists every student, so it is staff-only.
router.get("/conversations", ...requireAdmin, ListConversations);

// A student may read and write only their own thread; the controller enforces
// that, which is why these are requireAuth rather than requireAdmin.
router.get("/conversations/:studentUid", requireAuth, GetConversation);
router.get("/conversations/:studentUid/messages", requireAuth, ListMessages);
router.post("/conversations/:studentUid/messages", requireAuth, SendMessage);
router.patch("/conversations/:studentUid/read", requireAuth, MarkRead);

// Closing or reopening a thread is a moderation action.
router.patch("/conversations/:studentUid/status", ...requireAdmin, SetStatus);

module.exports = router;
