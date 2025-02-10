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
// import { single } from "../utils/multer";

const router = require("express").Router();
require("dotenv").config();

router.post(
  "/createCommunityPost",
  upload.single("image"),
  CreateCommunityPost
);
router.post("/editCommunityPost", upload.single("image"), EditCommunityPost);
router.post("/publishCommunityPost", PublishCommunityPost);
router.post("/addStudentToRemovedList", addStudentToRemovedList);
router.post("/removeStudentFromRemovedList", removeStudentFromRemovedList);
// router.post("/postComment", PostComment);
router.post("/postComment", upload.array("media"), PostComment);
router.post("/deleteComment", DeleteComment);
router.post("/editComment", EditComment);
router.get("/getCommunity", GetCommunityPost);
router.get("/fetchAllComments", FetchAllComments);
router.delete("/deleteCommunityPost", DeleteCommunityPost);

module.exports = router;
