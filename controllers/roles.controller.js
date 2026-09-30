/**
 * Staff roles from the dashboard ("Make admin" on the Students page).
 *
 * Roles live in Firebase custom claims (see middleware/auth.js). Only a
 * superadmin can grant or remove the admin role, so an ordinary admin can't
 * hand out admin rights. Nobody can change their own role, and the last
 * superadmin can't be demoted. The new role applies on the person's next sign
 * in (or within the hour, when their token refreshes).
 */
const { auth } = require("../firebaseadminvar");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");

const ASSIGNABLE = ["student", "admin"];

/** GET /api/roles/staff - everyone with a staff role. */
exports.ListStaff = catchAsync(async (req, res) => {
  const staff = [];
  let page;
  do {
    page = await auth.listUsers(1000, page && page.pageToken);
    for (const u of page.users) {
      const role = (u.customClaims || {}).role;
      if (role && role !== "student") {
        staff.push({ uid: u.uid, email: u.email || "", name: u.displayName || "", role, disabled: u.disabled });
      }
    }
  } while (page.pageToken);
  res.status(200).json({ status: "ok", message: "Staff", data: { staff, canManage: req.role === "superadmin", me: req.uid } });
});

/** POST /api/roles/:uid { role: "admin" | "student" } - superadmin only. */
exports.SetRole = catchAsync(async (req, res) => {
  if (req.role !== "superadmin") throw new AppError("Only a super-admin can change admin rights", 403);
  const role = String((req.body || {}).role || "");
  if (!ASSIGNABLE.includes(role)) throw new AppError(`Role must be one of: ${ASSIGNABLE.join(", ")}`, 400);
  const uid = String(req.params.uid);
  if (uid === req.uid) throw new AppError("You can't change your own role", 400);

  const user = await auth.getUser(uid).catch(() => null);
  if (!user) throw new AppError("User not found", 404);
  const current = (user.customClaims || {}).role || "student";
  if (current === "superadmin") throw new AppError("Super-admins can only be changed by the developer", 403);

  await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), role });
  res.status(200).json({
    status: "ok",
    message: role === "admin" ? `${user.email || "User"} is now an admin` : `${user.email || "User"} is no longer an admin`,
    data: { uid, role, previous: current },
  });
});
