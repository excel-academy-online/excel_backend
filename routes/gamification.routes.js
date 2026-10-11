const upload = require("../utils/multer");
const {
  createGamificationQst,
  GetAllActiveGames,
  GetAllNonActiveGames,
  GetGamesByProgramId,
  GetPaginatedGames,
  searchGamification,
  createGamificationNewMultipleQst,
  createMultipleGamificationQst,
  editGamificationQst,
  toggleGamificationStatus,
} = require("../controllers/gamification.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const router = require("express").Router();
require("dotenv").config();

// --- Authoring questions: admin only -----------------------------------
router.post("/createGamificationQst", ...requireAdmin, upload.array("media"), createGamificationQst);
router.post("/editGamificationQst", ...requireAdmin, upload.array("media"), editGamificationQst);
router.post("/toggleGamificationStatus", ...requireAdmin, toggleGamificationStatus);
router.post("/createMultipleGamificationQst", ...requireAdmin, upload.array("media"), createMultipleGamificationQst);
router.post("/createGamificationNewMultipleQst", ...requireAdmin, upload.array("media"), createGamificationNewMultipleQst);

// --- Playing: any signed-in student ------------------------------------
// Questions carry answers, so these are not public.
router.get("/getAllActiveGames", ...requireAdmin, GetAllActiveGames);
router.get("/getGamesByProgramId", ...requireAdmin, GetGamesByProgramId);
router.get("/getAllActiveGamesPaginated", ...requireAdmin, GetPaginatedGames);
router.get("/searchGamification", ...requireAdmin, searchGamification);

// Unpublished/draft questions are staff-only.
router.get("/getAllNonActiveGames", ...requireAdmin, GetAllNonActiveGames);

module.exports = router;
