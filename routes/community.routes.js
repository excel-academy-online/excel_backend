const upload = require("../utils/multer");
const {
  CreateCommunityPost,
  EditCommunityPost,
  PublishCommunityPost,
  GetCommunityPost,
  DeleteCommunityPost,
  addStudentToRemovedList,
  removeStudentFromRemovedList,
  PostComment,
  DeleteComment,
  EditComment,
  FetchAllComments,
} = require("../controllers/community.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = require("express").Router();
require("dotenv").config();

// --- Moderation: admin only --------------------------------------------
router.post("/createCommunityPost", ...requireAdmin, upload.single("image"), CreateCommunityPost);
router.post("/editCommunityPost", ...requireAdmin, upload.single("image"), EditCommunityPost);
router.post("/publishCommunityPost", ...requireAdmin, PublishCommunityPost);
router.post("/addStudentToRemovedList", ...requireAdmin, addStudentToRemovedList);
router.post("/removeStudentFromRemovedList", ...requireAdmin, removeStudentFromRemovedList);
router.delete("/deleteCommunityPost", ...requireAdmin, DeleteCommunityPost);

// --- Participation: signed-in members ----------------------------------
// NOTE: DeleteComment/EditComment must additionally check that the caller owns
// the comment - that ownership test belongs in the controller, which currently
// takes the author id from the request body. Flagged in AUDIT.md.
router.post("/postComment", requireAuth, upload.array("media"), PostComment);
router.post("/deleteComment", requireAuth, DeleteComment);
router.post("/editComment", requireAuth, EditComment);
router.get("/getCommunity", requireAuth, GetCommunityPost);
router.get("/fetchAllComments", requireAuth, FetchAllComments);

// Students: the dashboard's published groups; the author is the signed-in user.
const sc = require("../controllers/studentCommunity.controller");
router.get("/groups", requireAuth, sc.ListGroups);
router.get("/groups/:id/messages", requireAuth, sc.ListMessages);
router.post("/groups/:id/messages", requireAuth, sc.PostMessage);
router.delete("/groups/:id/messages/:messageId", requireAuth, sc.DeleteMessage);

module.exports = router;
