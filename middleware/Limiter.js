const { rateLimit } = require("express-rate-limit");

/**
 * Baseline limit applied to the whole API.
 *
 * The previous setting - 4 requests per 20 seconds - throttled ordinary
 * browsing (a single course page fires several parallel calls), so it is
 * relaxed here and the strict limit is applied per-route to the endpoints that
 * actually warrant it: login, registration and payment.
 */
const Limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  message: { status: "fail", message: "Too many requests, please try again later" },
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

/** Strict limit for credential and payment endpoints. */
const StrictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { status: "fail", message: "Too many attempts, please try again later" },
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

module.exports = Limiter;
module.exports.Limiter = Limiter;
module.exports.StrictLimiter = StrictLimiter;
