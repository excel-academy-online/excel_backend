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
const router = require("express").Router();
require("dotenv").config();

router.post(
  "/createGamificationQst",
  upload.array("media"),
  createGamificationQst
);
router.post(
  "/editGamificationQst",
  upload.array("media"),
  editGamificationQst
);
router.post("/toggleGamificationStatus", toggleGamificationStatus);

router.post(
  "/createMultipleGamificationQst",
  upload.array("media"),
  createMultipleGamificationQst
);
// router.post(
//   "/createGamificationNewMultipleQst",
//   upload.fields([{ name: 'media', maxCount: 5 }]), // Adjust maxCount if needed
//   createGamificationNewMultipleQst
// );
router.get("/getAllActiveGames", GetAllActiveGames);
router.get("/getAllNonActiveGames", GetAllNonActiveGames);
router.get("/getGamesByProgramId", GetGamesByProgramId);
router.get("/getAllActiveGamesPaginated", GetPaginatedGames);
router.get("/searchGamification", searchGamification);

// router.post(
//   "/createGamificationNewMultipleQst",
//   (req, res, next) => {
//     console.log("Received Request Body:", req.body); // Log the request body

//     try {
//       const questions = req.body.questions ? JSON.parse(req.body.questions) : null; // Parse the incoming questions JSON array
//       if (!questions || !Array.isArray(questions)) {
//         return res.status(400).json({ message: "Invalid questions format" });
//       }

//       const fields = [];

//       // Create dynamic field names based on the number of questions
//       for (let i = 0; i < questions.length; i++) {
//         fields.push({ name: `media_${i}`, maxCount: 5 }); // Allow up to 5 files per question
//       }

//       // Use multer's fields method with the dynamic fields
//       const uploadHandler = upload.fields(fields);
//       uploadHandler(req, res, (err) => {
//         if (err) {
//           console.error("Multer error:", err);
//           return res.status(400).json({ message: "File upload error" });
//         }
//         console.log("Files received:", req.files); // Log the files received
//         console.log("Body after upload:", req.body); // Log the body after multer processes it
//         next();
//       });
//     } catch (error) {
//       console.error("Parsing Error:", error.message);
//       return res.status(400).json({ message: "Invalid input format" });
//     }
//   },
//   createGamificationNewMultipleQst
// );

router.post(
  "/createGamificationNewMultipleQst",
  upload.array("media"),
  createGamificationNewMultipleQst
);

// router.post(
//   "/createGamificationNewMultipleQst",
//   (req, res) => {
//     console.log("Received Request Body:", req.body);

//     if (!req.body.questions) {
//       return res.status(400).json({ message: "No questions received" });
//     }

//     // If successful, return the questions received
//     res.status(200).json({
//       message: "Questions received successfully",
//       data: JSON.parse(req.body.questions),
//     });
//   }
// );



module.exports = router;
