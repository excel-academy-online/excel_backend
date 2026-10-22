/**
 *   POST   /api/students/session/claim     { deviceId, deviceName, platform }  (app, after sign-in)
 *   POST   /api/students/session/release   { deviceId }                        (app, on log out)
 *   GET    /api/students/:uid/device        staff: which phone holds the account
 *   DELETE /api/students/:uid/device        staff: sign it out (lost phone)
 * See utils/deviceSessions.js.
 */
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");
const sessions = require("../utils/deviceSessions");
const { ADMIN_ROLES } = require("../middleware/auth");

exports.Claim = catchAsync(async (req, res, next) => {
  if (ADMIN_ROLES.includes(req.role)) {
    return res.status(200).json({ status: "ok", message: "Staff accounts can use several devices", data: { exempt: true } });
  }
  const { deviceId, deviceName, platform } = req.body || {};
  if (!deviceId) return next(new AppError("deviceId is required", 400));
  const r = await sessions.claim(req.uid, deviceId, deviceName, platform);
  if (!r.ok) {
    return res.status(409).json({
      status: "fail",
      code: "device_in_use",
      message: `This account is already signed in on ${r.deviceName}. Log out there first, or ask Excel Academy to sign that device out.`,
      data: { deviceName: r.deviceName, lastSeen: r.lastSeen },
    });
  }
  res.status(200).json({ status: "ok", message: "Signed in on this device", data: { releasedAfterDays: sessions.RELEASE_AFTER_DAYS } });
});

exports.Release = catchAsync(async (req, res) => {
  await sessions.release(req.uid, (req.body || {}).deviceId);
  res.status(200).json({ status: "ok", message: "Signed out on this device", data: {} });
});

exports.GetDevice = catchAsync(async (req, res) => {
  res.status(200).json({ status: "ok", message: "Device", data: await sessions.describe(req.params.uid) });
});

exports.ForceRelease = catchAsync(async (req, res) => {
  await sessions.forceRelease(req.params.uid);
  res.status(200).json({ status: "ok", message: "Signed out - the student can now log in on another device", data: {} });
});
