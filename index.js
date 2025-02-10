const express = require("express");
const cors = require("cors");
// const helmet = require("helmet");
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
const paymentRouter = require('./routes/purchase.routes');
const announcementRouter = require("./routes/announcement.routes");
const certRouter = require('./routes/cert.routes');
const Connect = require("./utils/Db.config");
const Limiter = require("./middleware/Limiter");
const functions = require("firebase-functions");



const firebase = require("firebase/app");
const { admin, serviceAccount, firebaseConfig } = require('./firebaseadminvar');


firebase.initializeApp(firebaseConfig);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://excel-academy-online-default-rtdb.firebaseio.com"
});


const app = express();

// Handling uncaught exception
process.on("uncaughtException", (err) => {
  console.log(err.name, err.message);
  console.log("Unhandled Exception, shutting down");
  process.exit(1);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(xss());
app.use(mongoSanitize());
app.use(morgan("dev"));
app.use(cookieParser());
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


app.all("*", (req, res, next) => {
  next(
    new AppError(
      `Can not find ${req.originalUrl} with ${req.method} on this server`,
      501
    )
  );
});
app.use(globalErrorHandler);

const Port = process.env.PORT || 7070;
const server = Connect().then(() =>
  app.listen(Port, () => console.log(`Server running on localhost ${Port}`))
);

//Handling unHandled Rejections
process.on("unhandledRejection", (err) => {
  console.log(err.name, err.message);
  console.log("Unhandled Rejection, shutting down");
  server.close(() => {
    process.exit(1);
  });
});

exports.app = functions.https.onRequest(app);


