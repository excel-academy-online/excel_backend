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
// import { single } from "../utils/multer";

const router = require("express").Router();
require("dotenv").config();

router.post("/createModules", upload.single("image"), CreateModules);
router.post("/editCommunityPost", upload.single("image"), EditModule);
router.post("/activateDeactivateModule", ActivateDeactivateModule);
router.get("/getModule", GetModule);
router.post("/createRows", upload.single("image"), CreateRows);
router.get("/getRoles", GetRoles);
router.post("/assignRoles", upload.single("image"), AssignRoles);

module.exports = router;
