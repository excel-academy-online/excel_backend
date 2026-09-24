const upload = require("../utils/multer");
const {
  CreateModules,
  EditModule,
  ActivateDeactivateModule,
  GetModule,
  CreateRows,
  GetRoles,
  AssignRoles,
} = require("../controllers/roles_modules_privileges.routes");
const { requireAdmin } = require("../middleware/auth");

const router = require("express").Router();
require("dotenv").config();

// This router defines who can do what in the product. Every endpoint on it,
// reads included, is a privilege-escalation vector and stays admin-only.
router.post("/createModules", ...requireAdmin, upload.single("image"), CreateModules);
router.post("/editCommunityPost", ...requireAdmin, upload.single("image"), EditModule);
router.post("/activateDeactivateModule", ...requireAdmin, ActivateDeactivateModule);
router.get("/getModule", ...requireAdmin, GetModule);
router.post("/createRows", ...requireAdmin, upload.single("image"), CreateRows);
router.get("/getRoles", ...requireAdmin, GetRoles);
router.post("/assignRoles", ...requireAdmin, upload.single("image"), AssignRoles);

module.exports = router;
