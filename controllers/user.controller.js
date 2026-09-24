const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { initializeApp } = require("firebase/app");
const {
  getStorage,
  ref,
  getDownloadURL,
  uploadBytesResumable,
} = require("firebase/storage");

const {
  getAuth,
} = require("firebase/auth");

const {
  getFirestore,
  collection,
  where,
  query,
  updateDoc,
  getDoc,
  getDocs,
  doc,
  setDoc,
} = require("firebase/firestore");
const firebaseConfig = require("../utils/firebase.config");
const User = require("../models/user.model");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");
require("dotenv").config();

module.exports.Register = catchAsync(async (req, res, next) => {
  const { first_name, last_name, email, gender, password } = req.body;
  const file = req.file;
  const findUser = await User.findOne({ email });

  if (findUser) {
    return next(new AppError("User already exist", 403));
  }
  const filename =
    crypto.randomBytes(16).toString("hex") + path.extname(file.originalname);
  //Initialize a firebase application
  initializeApp(firebaseConfig);
  // Initialize Cloud Storage and get a reference to the service
  const storage = getStorage();
  // Create file metadata including the content type
  const metadata = {
    contentType: req.file.mimetype,
  };
  const storageRef = ref(storage, filename);
  // Upload the file in the bucket storage
  const snapshot = await uploadBytesResumable(storageRef, file, metadata);
  // Grab the public url
  const downloadURL = await getDownloadURL(snapshot.ref);
  const hashedPassword = await bcrypt.hash(password, 10);

  const createUser = await User.create({
    first_name,
    last_name,
    email,
    profile_picture: downloadURL,
    gender,
    password: hashedPassword,
  });
  // const {password, ...userDetails} = createUser

  // await createUser.save();
  return res.status(202).json({
    status: "ok",
    message: "User account created succesfully",
    createUser,
  });
});
module.exports.UpdateUserDPold = catchAsync(async (req, res, next) => {
  const { user_id } = req.body;

  // Validate input
  if (!user_id) {
    return next(new AppError("User ID is required.", 400));
  }
  if (!req.file) {
    return next(new AppError("Error: No File uploaded", 400));
  }

  try {
    const firestore = getFirestore();
    const userRef = doc(firestore, "users", user_id);
    const userSnapshot = await getDoc(userRef);

    // Check if the user exists
    if (!userSnapshot.exists()) {
      return next(new AppError("User not found.", 404));
    }

    const filename = `users/${req.file.originalname}`;
    const storage = getStorage();
    const storageRef = ref(storage, filename);

    // Upload the file to Firebase Storage
    const uploadTask = uploadBytesResumable(storageRef, req.file.buffer, {
      contentType: req.file.mimetype,
    });

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        console.log(`Upload is ${progress}% done`);
      },
      (error) => {
        console.error("Error uploading image:", error);
        return next(new AppError(`Error uploading image: ${error.message}`, 500));
      },
      async () => {
        // Get the download URL after successful upload
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

        // Update user profile picture in Firestore
        await updateDoc(userRef, { dp: downloadURL });

        res.status(200).json({
          status: "success",
          message: "User display picture updated successfully!",
          data: { dp: downloadURL },
        });
      }
    );
  } catch (error) {
    console.error("Error updating user details:", error);
    return next(new AppError(error.message || "Error updating user details.", 500));
  }
});

module.exports.UpdateUserDP = catchAsync(async (req, res, next) => {
  const { user_id } = req.body;

  // Validate input
  if (!user_id) {
    return next(new AppError("User ID is required.", 400));
  }
  if (!req.file) {
    return next(new AppError("Error: No File uploaded", 400));
  }

  try {
    const firestore = getFirestore();
    const userRef = doc(firestore, "users", user_id);
    const userSnapshot = await getDoc(userRef);

    // Check if the user exists
    if (!userSnapshot.exists()) {
      return next(new AppError("User not found.", 404));
    }

    // req.uid is set by middleware/auth.js after verifying the Firebase ID
    // token. The client SDK's getAuth().currentUser is always null in a server
    // process, so the previous check could never pass.
    if (!req.uid) {
      return next(
        new AppError("User must be authenticated to update profile picture.", 401)
      );
    }

    const isAdmin = ["admin", "superadmin"].includes(req.role);
    if (!isAdmin && user_id !== req.uid) {
      return next(
        new AppError("You can only update your own profile picture.", 403)
      );
    }

    const filename = `users/${user_id}/${req.file.originalname}`;
    const storage = getStorage();
    const storageRef = ref(storage, filename);

    // Upload the file to Firebase Storage
    const uploadTask = uploadBytesResumable(storageRef, req.file.buffer, {
      contentType: req.file.mimetype,
    });

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        console.log(`Upload is ${progress}% done`);
      },
      (error) => {
        console.error("Error uploading image:", error);
        return next(new AppError(`Error uploading image: ${error.message}`, 500));
      },
      async () => {
        // Get the download URL after successful upload
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

        // Update user profile picture in Firestore
        await updateDoc(userRef, { dp: downloadURL });

        res.status(200).json({
          status: "success",
          message: "User display picture updated successfully!",
          data: { dp: downloadURL },
        });
      }
    );
  } catch (error) {
    console.error("Error updating user details:", error);
    return next(new AppError(error.message || "Error updating user details.", 500));
  }
});



module.exports.Login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  const findUser = await User.findOne({ email });
  if (!findUser) {
    return next(new AppError("User does not exist", 404));
  }
  const passwordMatch = await bcrypt.compare(password, findUser.password);

  if (!passwordMatch) {
    return next(new AppError("Incorrect login details", 401));
  }
  findUser.lastLogin = new Date();
  await findUser.save();

  const user_auth = jwt.sign({ id: findUser._id }, process.env.Jwt_Secret_Key, {
    expiresIn: "7d",
  });
  res.cookie("user_auth", user_auth, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  // Never hand the password hash back to the client.
  const { password: _omit, ...safeUser } = findUser.toObject();

  res
    .status(202)
    .json({ status: "ok", message: "User succesfully logged in", user: safeUser });
});

module.exports.FetchAllUsers = catchAsync(async (req, res, next) => {
  //Get Number of all registered students
  const fetchAllUsers = await User.find().select("-password");
  if (fetchAllUsers.length <= 0) {
    return next(new AppError("No users found", 404));
  }
  const numOfStudent = fetchAllUsers.length;
  //Check that users passwords is not returned
  res.status(200).json({
    status: "ok",
    message: "All users fetched succesfully.",
    studentNumber: numOfStudent,
    fetchAllUsers,
  });

  //Get the total number of courses
});

module.exports.FetchUsersByGender = catchAsync(async (req, res, next) => {
  //Get Number of all registered students
  const { requiredGender } = req.query;
  const gender = requiredGender == undefined ? "male" : requiredGender;
  // date ==undefined ? 7 : date;
  const fetchUsersGender = await User.find({ gender }).select("-password");
  if (fetchUsersGender.length <= 0) {
    return next(new AppError("No users found", 404));
  }

  res.status(200).json({
    status: "ok",
    message: "All users fetched successfully.",
    studentNumber: fetchUsersGender.length,
    users: fetchUsersGender,
  });

  //Get the total number of courses
});

module.exports.FetchUserDetails = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const user = await User.findById(id).select("-password");
  console.log(user);
  if (!user) {
    return next(new AppError("User not found, invalid ID", 404));
  }

  res.status(200).json({
    status: "ok",
    message: "User details fetched succesfully.",
    user,
  });
});

module.exports.toggleUserStatus = catchAsync(async (req, res, next) => {
  const { user_id, status } = req.body;

  // Validate required fields
  // Note: a plain falsy check would reject status=false, which is a valid way
  // to say "deactivate".
  if (!user_id || status === undefined || status === null || status === "") {
    return next(new AppError("User ID and status are required", 400));
  }

  // Accept what callers naturally send - "activate"/"deactivate", the resulting
  // state ("active"/"inactive"), a boolean, or 1/0 - and store 1/0 as before so
  // existing records keep working.
  const truthy = ["activate", "active", "enable", "enabled", "1", "true"];
  const falsy = ["deactivate", "inactive", "disable", "disabled", "0", "false"];
  const given = typeof status === "boolean" ? String(status) : String(status).trim().toLowerCase();

  if (![...truthy, ...falsy].includes(given)) {
    return next(
      new AppError(
        `Invalid status "${status}". Use activate/deactivate, active/inactive, or a boolean.`,
        400
      )
    );
  }

  const newStatus = truthy.includes(given) ? 1 : 0;
const id  = user_id
  // Get the gamification question
  const firestore = getFirestore();
  const questionRef = doc(firestore, "users", id);
  const questionDoc = await getDoc(questionRef);

  if (!questionDoc.exists()) {
    return next(new AppError("User not found", 404));
  }

  // Update the status
  try {
    await updateDoc(questionRef, {
      status: newStatus,
      dateModify: new Date().toUTCString(),
    });

    res.status(200).json({
      status: "ok",
      message: `User ${status}d successfully`,
    });
  } catch (error) {
    return next(new AppError("Failed to update user status", 500));
  }
});
