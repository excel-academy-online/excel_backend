const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const xss = require("xss-clean");
const cookieParser = require("cookie-parser");
const mongoSanitize = require("express-mongo-sanitize");
const morgan = require("morgan");
require("dotenv").config();

const globalErrorHandler = require("./utils/errors/errorController");
const AppError = require("./utils/errors/AppError");
const videoRouter = require("./routes/videos");
const userRouter = require("./routes/user.routes");
const adminRouter = require("./routes/admin.routes");
const dashboardRouter = require("./routes/dashboard.routes");
const courseRouter = require("./routes/course.routes");
const gamification = require("./routes/gamification.routes");
const roles = require("./routes/roles_modules.routes");
const community = require("./routes/community.routes");
const advertisement = require("./routes/advertisement.routes");
const studentsRouter = require("./routes/students.routes");
const paymentRouter = require("./routes/purchase.routes");
const announcementRouter = require("./routes/announcement.routes");
const certRouter = require("./routes/cert.routes");
const chatRouter = require("./routes/chat.routes");
const Connect = require("./utils/Db.config");
const Limiter = require("./middleware/Limiter");

// Initialises the Firebase Admin SDK as a side effect of being required.
require("./firebaseadminvar");

const app = express();

// An uncaught exception leaves the process in an unknown state, so we log and
// let the supervisor restart us.
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception, shutting down:", err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});

// Behind Render's proxy, so req.ip (and therefore rate limiting) needs the
// X-Forwarded-For header to be trusted.
app.set("trust proxy", 1);

app.use(helmet());

// An allowlist rather than a wildcard: credentials cannot be sent to `*`, and
// cookie-based sessions would otherwise be readable by any origin.
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Mobile apps and server-to-server calls send no Origin header.
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);

// Cap request bodies; the default is unbounded enough to be a cheap DoS.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(xss());
app.use(mongoSanitize());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(cookieParser());

// Baseline rate limit across the whole API. Auth and payment routes add their
// own stricter limiter on top.
app.use(Limiter);

app.get("/health", (req, res) =>
  res.status(200).json({ status: "ok", uptime: process.uptime() })
);

app.use("/api", videoRouter);
app.use("/api/auth", userRouter);
app.use("/api/admin", adminRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/course", courseRouter);
app.use("/api/gamification", gamification);
app.use("/api/roles", roles);
app.use("/api/community", community);
app.use("/api/advertisement", advertisement);
app.use("/api/students", studentsRouter);
app.use("/api/announcements", announcementRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/certificates", certRouter);
app.use("/api/chat", chatRouter);

app.all("*", (req, res, next) => {
  next(
    new AppError(
      `Can not find ${req.originalUrl} with ${req.method} on this server`,
      404
    )
  );
});
app.use(globalErrorHandler);

const Port = process.env.PORT || 7070;

let server;
const start = () =>
  (server = app.listen(Port, () => console.log(`Server running on port ${Port}`)));

// With DATA_SOURCE=firestore the course and payment reads come from Firestore,
// so MongoDB is no longer needed to serve traffic. A few legacy Mongoose routes
// remain (the unused bcrypt login, the Admin model), so we still try to connect
// and warn loudly rather than pretend the database is there.
const firestoreMode = (process.env.DATA_SOURCE || "mongo").toLowerCase() === "firestore";

Connect()
  .then(start)
  .catch((err) => {
    if (firestoreMode) {
      console.warn(
        `MongoDB unavailable (${err.message}). Continuing on Firestore; any ` +
          "remaining Mongoose-backed route will fail until it is migrated."
      );
      return start();
    }
    // Without a database every request 500s, so refuse to come up at all
    // rather than serving a process that looks healthy and is not.
    console.error("Could not connect to MongoDB, aborting startup:", err.message);
    process.exit(1);
  });

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection, shutting down:", err.name, err.message);
  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

module.exports = app;
