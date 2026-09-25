const q = require("../controllers/quiz.controller");
const { requireAuth } = require("../middleware/auth");
const router = require("express").Router();

// Everything here needs a signed-in student. Answers never leave the server:
// each choice is locked in and checked by the answer endpoints.
router.get("/questions", requireAuth, q.GetQuestions);
router.post("/session", requireAuth, q.StartSession);
router.post("/session/:id/answer", requireAuth, q.AnswerSession);
router.post("/results", requireAuth, q.SubmitResult);
router.get("/leaderboard", requireAuth, q.Leaderboard);
router.get("/me", requireAuth, q.MyStats);

// Live matches between two students. The controller checks the caller is a
// player in the match.
router.post("/match", requireAuth, q.FindMatch);
router.get("/match/:id", requireAuth, q.GetMatch);
router.post("/match/:id/answer", requireAuth, q.AnswerMatch);
router.delete("/match/:id", requireAuth, q.CancelMatch);

module.exports = router;
