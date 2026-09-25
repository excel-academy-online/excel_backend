const q = require("../controllers/quiz.controller");
const { requireAuth } = require("../middleware/auth");
const router = require("express").Router();

// Questions carry their answers, so everything here needs a signed-in student.
router.get("/questions", requireAuth, q.GetQuestions);
router.post("/results", requireAuth, q.SubmitResult);
router.get("/leaderboard", requireAuth, q.Leaderboard);
router.get("/me", requireAuth, q.MyStats);

// Live matches between two students. The controller checks the caller is a
// player in the match.
router.post("/match", requireAuth, q.FindMatch);
router.get("/match/:id", requireAuth, q.GetMatch);
router.post("/match/:id/score", requireAuth, q.UpdateScore);
router.delete("/match/:id", requireAuth, q.CancelMatch);

module.exports = router;
