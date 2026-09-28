const m = require("../controllers/mockExam.controller");
const { requireAuth } = require("../middleware/auth");
const router = require("express").Router();

// Students' mock exams. Answers stay on the server until an attempt is submitted.
router.get("/", requireAuth, m.ListMine);
router.get("/:courseId", requireAuth, m.GetOne);
router.post("/:courseId/start", requireAuth, m.Start);
router.post("/:courseId/save", requireAuth, m.Save);
router.post("/:courseId/submit", requireAuth, m.Submit);
router.get("/:courseId/result", requireAuth, m.LastResult);
router.delete("/:courseId/attempt", requireAuth, m.Discard);

module.exports = router;
