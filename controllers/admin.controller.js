const jwt = require("jsonwebtoken");
const catchAsync = require("../utils/errors/catchAsync");
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
const firebase = require("firebase/app");

require("dotenv").config();
const Admin = require("../models/admin.model");
const Courses = require("../models/courses.model");
const AppError = require("../utils/errors/AppError");
const GenerateStudentId = require("../utils/studentIDGenerator");

const {
  admin,
  serviceAccount,
  firebaseConfig,
} = require("../firebaseadminvar");

firebase.initializeApp(firebaseConfig);
const {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
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
const { log } = require("console");
const firestore = getFirestore();

const auth = getAuth();

/**
 * Helper function to check if a student_ID already exists in the database
 * @param {string} studentID - The student_ID to check
 * @returns {Promise<boolean>} - Returns true if exists, false otherwise
 */
const checkStudentIdExists = async (studentID) => {
  const studentQuery = query(
    collection(firestore, "users"),
    where("student_ID", "==", studentID)
  );
  const studentSnapshot = await getDocs(studentQuery);
  return !studentSnapshot.empty;
};

const generateUniqueStudentId = async () => {
  let isUnique = false;
  let newStudentID;
  while (!isUnique) {
    newStudentID = GenerateStudentId();
    const exists = await checkStudentIdExists(newStudentID);
    if (!exists) {
      isUnique = true;
    }
  }
  return newStudentID;
};

module.exports.AdminRegister = catchAsync(async (req, res, next) => {
  const {
    first_name,
    last_name,
    email,
    password,
    gender = "male",
    type,
  } = req.body;

  if (!email || !password) {
    return next(new AppError("Email and password are required.", 403));
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    const { user } = userCredential;

    await sendEmailVerification(user);

    const userRef = doc(collection(firestore, "users"), user.uid);
    const name = `${first_name} ${last_name}`;
    const username = `${first_name}${last_name}`;
    const dateCreated = new Date().toUTCString();
    const baseUserData = {
      name,
      username,
      id: userRef.id,
      datecreated: dateCreated,
      dp: null,
      email,
      gender,
      type,
      enrolledCourses: [],
      status: 1,
    };

    let student_ID;
    if (type === "student") {
      let isUnique = false;
      while (!isUnique) {
        student_ID = GenerateStudentId();
        const studentQuery = query(
          collection(firestore, "users"),
          where("student_ID", "==", student_ID)
        );
        const studentSnapshot = await getDocs(studentQuery);
        if (studentSnapshot.empty) {
          isUnique = true;
        }
      }
    }

    const userData =
      type === "student"
        ? { ...baseUserData, admin: false, student_ID }
        : { ...baseUserData, admin: true };
        log(userData);

    await setDoc(userRef, userData);

    res.status(201).json({
      status: "ok",
      message: "Verification email sent! User created successfully!",
      data: user?.stsTokenManager,
    });
  } catch (error) {
    console.error("Error during user registration:", error);
    const errorMessage =
      error.code === "auth/email-already-in-use"
        ? "Email is already in use."
        : error.message;

    return next(new AppError(errorMessage, 500));
  }
});

module.exports.EditProfile = catchAsync(async (req, res, next) => {
  const {
    user_id,
    first_name,
    last_name,
    email,
    gender,
    type,
    city,
    address,
    country,
    student_ID,
  } = req.body;

  if (!user_id) {
    return next(new AppError("User ID is required.", 400));
  }

  try {
    const userRef = doc(firestore, "users", user_id);
    const userSnapshot = await getDoc(userRef);

    if (!userSnapshot.exists()) {
      return next(new AppError("User not found.", 404));
    }

    const userData = userSnapshot.data();

    let finalStudentID = userData.student_ID || null;

    if (type === "student") {
      if (student_ID && student_ID !== userData.student_ID) {
        const isExisting = await checkStudentIdExists(student_ID);
        finalStudentID = isExisting
          ? student_ID
          : await generateUniqueStudentId();
      } else if (!userData.student_ID) {
        finalStudentID = await generateUniqueStudentId();
      }
    }

    const updatedData = {
      name:
        first_name && last_name ? `${first_name} ${last_name}` : userData.name,
      username:
        first_name && last_name
          ? `${first_name}${last_name}`
          : userData.username,
      email: email || userData.email,
      gender: gender || userData.gender,
      type: type || userData.type,
      city: city || userData.city,
      address: address || userData.address,
      country: country || userData.country,
      ...(finalStudentID && { student_ID: finalStudentID }),
    };

    await updateDoc(userRef, updatedData);

    res.status(200).json({
      status: "success",
      message: "User details updated successfully!",
      data: updatedData,
    });
  } catch (error) {
    console.error("Error updating user details:", error);
    return next(
      new AppError(error?.message, 500)
    );
  }
});

module.exports.AdminLoginOld = catchAsync(async (req, res, next) => {
  const { email, password, rememberMe } = req.body;

  if (!email || !password) {
    return next(new AppError("email or password can't be empty", 403));
  }

  signInWithEmailAndPassword(auth, email, password)
    .then((userCredential) => {
      const idToken = userCredential._tokenResponse.idToken;
      if (idToken) {
        res.cookie("access_token", idToken, {
          httpOnly: true,
        });
        res.status(200).json({
          status: "ok",
          message: "Admin logged in successfully",
          data: userCredential,
        });
      } else {
        return next(new AppError("Internal Server Error", 500));
      }
    })
    .catch((error) => {
      console.error(error);
      const errorMessage =
        error.message || "An error occurred while logging in";
      return next(new AppError(errorMessage, 401));
    });
});


module.exports.AdminLogin = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new AppError("Email or password can't be empty", 403));
  }

  signInWithEmailAndPassword(auth, email, password)
    .then(async (userCredential) => {
      const idToken = userCredential._tokenResponse.idToken;
      const uid = userCredential?.user?.uid; // Get the logged-in user's UID

      if (idToken) {
        // Set access token as cookie
        res.cookie("access_token", idToken, {
          httpOnly: true,
        });

        // Query the users collection to find the user by ID
        const colRef = collection(firestore, "users");
        const q = query(colRef, where("id", "==", uid));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          return next(new AppError("User not found", 404));
        }

        // If we get results, extract the first document (assuming IDs are unique)
        let userData;
        querySnapshot.forEach((doc) => {
          userData = doc.data(); // Get user data from the document
        });

        // Set default values for fields that may not exist
        const userProfile = {
          type: userData?.type || null, // Default to null if field doesn't exist
          enrolledCourses: userData?.enrolledCourses || [],
          student_ID: userData?.student_ID || null,
          datecreated: userData?.datecreated || null,
          admin: userData?.admin || false,
          email: userData?.email || null,
          id: userData?.id || null,
          gender: userData?.gender || null,
          username: userData?.username || null,
          name: userData?.name || null,
          dp: userData?.dp || null,
          status: userData?.status || null,
        };

        // Send the response with the user profile
        res.status(200).json({
          status: "ok",
          message: "Admin logged in successfully",
          data: {
            userCredential: {
              uid,
              email: userCredential?.user?.email,
              token: idToken,
            },
            userProfile,
          },
        });
      } else {
        return next(new AppError("Internal Server Error", 500));
      }
    })
    .catch((error) => {
      console.error(error);
      const errorMessage =
        error.message || "An error occurred while logging in";
      return next(new AppError(errorMessage, 401));
    });
});


module.exports.AdminChangePassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    return next(new AppError("Email is required", 422));
  }
  sendPasswordResetEmail(auth, email)
    .then(() => {
      res.status(200).json({
        status: "ok",
        message: "Password reset email sent successfully!",
      });
    })
    .catch((error) => {
      console.error(error);
      return next(new AppError(error.message, 500));
    });
});

module.exports.AdminLogOut = catchAsync(async (req, res, next) => {
  signOut(auth)
    .then(() => {
      res.clearCookie("access_token");
      res
        .status(200)
        .json({ status: "ok", message: "User logged out successfully" });
    })
    .catch((error) => {
      console.error(error);
      return next(new AppError("Internal Server Error", 500));
    });
});

module.exports.AdminSearchEverything = catchAsync(async (req, res, next) => {
  const { searchTerm } = req.query;
  if (searchTerm == "" || undefined) {
    return next(
      new AppError(
        "Search query not found. Please enter a course you want to search for",
        404
      )
    );
  }
  const resultFromCourses = await Courses.find({
    title: { $regex: searchTerm, $options: "i" },
  });
  if (resultFromCourses.length == 0) {
    return next(
      new AppError(`Could not find anything with value ${searchTerm}`, 404)
    );
  }
  res.status(200).json({ success: true, status: "ok", resultFromCourses });
});
