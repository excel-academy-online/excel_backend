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

    // Make sure the user is authenticated
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
      return next(new AppError("User must be authenticated to update profile picture.", 403));
    }

    // Ensure the user ID matches the authenticated user's ID
    if (user_id !== user.uid) {
      return next(new AppError("You can only update your own profile picture.", 403));
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

  const user_auth = jwt.sign({ id: findUser._id }, process.env.Jwt_Secret_Key);
  res.cookie("user_auth", user_auth, {
    httpOnly: true,
  });
  res
    .status(202)
    .json({ status: "ok", message: "User succesfully logged in", findUser });
});

module.exports.FetchAllUsers = catchAsync(async (req, res, next) => {
  //Get Number of all registered students
  const fetchAllUsers = await User.find();
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
  const fetchUsersGender = await User.find({ gender });
  if (fetchUsersGender.length <= 0) {
    return next(new AppError("No users found", 404));
  }

  res.status(200).json({
    status: "ok",
    message: "All users fetched successfully.",
    studentNumber: numOfStudent,
    fetchAllUsers,
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
  if (!user_id || !status) {
    return next(new AppError("User ID and status are required", 400));
  }

  // Validate status (either 'activate' or 'deactivate')
  const validStatuses = ['activate', 'deactivate'];
  if (!validStatuses.includes(status)) {
    return next(new AppError("Invalid status value", 400));
  }

  const newStatus = status === 'activate' ? 1 : 0;
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
