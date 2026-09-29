const m = require("../controllers/mockExam.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const router = require("express").Router();

// Staff: manage every course's mock exam. (Before /:courseId so "admin" is not read as a course id.)
router.get("/admin/all", ...requireAdmin, m.AdminList);
router.get("/admin/:courseId", ...requireAdmin, m.AdminGet);
router.put("/admin/:courseId", ...requireAdmin, m.AdminSave);
router.post("/admin/:courseId/status", ...requireAdmin, m.AdminSetStatus);

// Students' mock exams. Answers stay on the server until an attempt is submitted.
router.get("/", requireAuth, m.ListMine);
router.get("/:courseId", requireAuth, m.GetOne);
router.post("/:courseId/start", requireAuth, m.Start);
router.post("/:courseId/save", requireAuth, m.Save);
router.post("/:courseId/submit", requireAuth, m.Submit);
router.get("/:courseId/result", requireAuth, m.LastResult);
router.delete("/:courseId/attempt", requireAuth, m.Discard);

module.exports = router;
