const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  collection,
  getDoc,
  doc,
  setDoc,
  getDocs,
  where,
  query,
  deleteDoc,
  updateDoc,
} = require("firebase/firestore");
const {
  getStorage,
  ref,
  getDownloadURL,
  uploadBytesResumable,
} = require("firebase/storage");
const firebaseConfig = require("../utils/firebase.config");
const User = require("../models/user.model");
const catchAsync = require("../utils/errors/catchAsync");
const AppError = require("../utils/errors/AppError");
require("dotenv").config();
const firestore = getFirestore();
const storage = getStorage();

module.exports.CreateModules = catchAsync(async (req, res, next) => {
  const { user_id, title, alias, description = "" } = req.body;

  if (!user_id || !alias || !title || !description) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const moduleRef = doc(collection(firestore, "modules"));

  // const q = query(programsRef, where("title", "==", title));
  const q = query(
    collection(firestore, "modules"),
    where("title", "==", title)
  );
  const querySnapshot = await getDocs(q);

  if (!querySnapshot.empty) {
    return next(new AppError("Modules with this name already exists", 403));
  }

  const data = {
    id: moduleRef.id,
    userId: user_id,
    title,
    description,
    thumbnail: null,
    alias,
    dateCreated: new Date().toUTCString(),
    dateUpdated: new Date().toUTCString(),
    status: 1,
  };

  if (req.file) {
    const storage = getStorage();
    const storageRef = ref(storage, `assets/${req.file.originalname}`);
    const uploadTask = uploadBytesResumable(storageRef, req.file.buffer);

    uploadTask.on(
      "state_changed",
      null,
      (error) => {
        console.error("Error uploading image:", error);
        return next(new AppError(error.message));
      },
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        data.thumbnail = downloadURL;

        await setDoc(moduleRef, data).catch((error) => {
          console.error(error);
          return next(new AppError("Failed to add module"));
        });

        res.status(200).json({
          status: "ok",
          message: "Module added successfully",
          data: {},
        });
      }
    );
  } else {
    await setDoc(moduleRef, data).catch((error) => {
      console.error(error);
      return next(new AppError(error.message));
    });

    res.status(200).json({
      status: "ok",
      message: "Module added successfully",
      data: {},
    });
  }
});
module.exports.EditModule = catchAsync(async (req, res, next) => {
  const { module_id, description = "", user_id, title, alias } = req.body;

  if (!module_id || !user_id) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const moduleRef = doc(firestore, "modules", module_id);

  // Check if the document exists
  const docSnapshot = await getDoc(moduleRef);
  if (!docSnapshot.exists()) {
    return next(new AppError("Module not found", 404));
  }

  const updateData = {
    description,
    title,
    userId: user_id,
    alias,
    dateUpdated: new Date().toUTCString(),
  };

  if (req.file) {
    const storage = getStorage();
    const storageRef = ref(storage, `assets/${req.file.originalname}`);
    const uploadTask = uploadBytesResumable(storageRef, req.file.buffer);

    uploadTask.on(
      "state_changed",
      null,
      (error) => {
        console.error("Error uploading image:", error);
        return next(new AppError(error.message));
      },
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        updateData.thumbnail = downloadURL;

        await updateDoc(moduleRef, updateData).catch((error) => {
          console.error(error);
          return next(new AppError(error?.message));
        });

        res.status(200).json({
          status: "ok",
          message: "Modules updated successfully",
          data: {},
        });
      }
    );
  } else {
    await updateDoc(moduleRef, updateData).catch((error) => {
      console.error(error);
      return next(new AppError(error?.message));
    });

    res.status(200).json({
      status: "ok",
      message: "Modules updated successfully",
      data: {},
    });
  }
});
module.exports.ActivateDeactivateModule = catchAsync(async (req, res, next) => {
  const { id, user_id, status } = req.body;

  if (!id || !user_id || status) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const moduleRef = doc(firestore, "modules", id);

  // Check if the document exists
  const docSnapshot = await getDoc(moduleRef);
  if (!docSnapshot.exists()) {
    return next(new AppError("Modules not found", 404));
  }
  const statusUpdate = status === "activate" ? 1 : 0;

  const updateData = {
    status: statusUpdate,
    userId: user_id,
    dateUpdated: new Date().toUTCString(),
  };

  await updateDoc(moduleRef, updateData).catch((error) => {
    console.error(error);
    return next(new AppError("Failed to Update"));
  });

  res.status(200).json({
    status: "ok",
    message: `Modules ${status} successfully`,
    data: {},
  });
});
module.exports.GetModule = catchAsync(async (req, res, next) => {
  const { user_id, status } = req.query;

  // Check for required parameters
  if (!user_id) {
    return next(new AppError("User ID is required", 403));
  }
  if (!status) {
    return next(new AppError("Status is required", 403));
  }

  const colRef = collection(firestore, "modules");
  let queryData;

  // If status is "All", get all documents, otherwise filter by status
  if (status === "All") {
    queryData = colRef;
  } else {
    queryData = query(colRef, where("status", "==", status));
  }

  // Fetch the documents
  const snapshot = await getDocs(queryData);

  // Check if the snapshot is empty
  if (snapshot.empty) {
    console.log(`No module found`);
    return next(new AppError("No module found", 404));
  }

  // Extract the document data
  const documents = snapshot.docs.map((doc) => doc.data());

  // Respond with the data
  res.status(200).json({
    status: "ok",
    message: "Module(s) retrieved successfully",
    data: documents,
  });
});
module.exports.CreateRows = catchAsync(async (req, res, next) => {
  const { user_id, title, privilege, description = "" } = req.body;

  const privilegeList = JSON.parse(privilege);
  // Check if options is an array and if it is in the correct format
  if (!Array.isArray(privilegeList)) {
    console.log("privilege is not an array:", privilegeList);
    return next(new AppError("Privilege must be an array", 400));
  }

  if (!user_id || !title || !description) {
    return next(new AppError("All fields are required", 403));
  }
 
  const firestore = getFirestore();
  const moduleRef = doc(collection(firestore, "roles"));

  // const q = query(programsRef, where("title", "==", title));
  const q = query(collection(firestore, "roles"), where("title", "==", title));
  const querySnapshot = await getDocs(q);

  if (!querySnapshot.empty) {
    return next(new AppError("Role with this name already exists", 403));
  }

  const data = {
    id: moduleRef.id,
    userId: user_id,
    title,
    description,
    thumbnail: null,
    privilegeList,
    dateCreated: new Date().toUTCString(),
    dateUpdated: new Date().toUTCString(),
    status: 1,
  };

  if (req.file) {
    const storage = getStorage();
    const storageRef = ref(storage, `assets/${req.file.originalname}`);
    const uploadTask = uploadBytesResumable(storageRef, req.file.buffer);

    uploadTask.on(
      "state_changed",
      null,
      (error) => {
        console.error("Error uploading image:", error);
        return next(new AppError(error.message));
      },
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        data.thumbnail = downloadURL;

        await setDoc(moduleRef, data).catch((error) => {
          console.error(error);
          return next(new AppError("Failed to add role"));
        });

        res.status(200).json({
          status: "ok",
          message: "Role added successfully",
          data: {},
        });
      }
    );
  } else {
    await setDoc(moduleRef, data).catch((error) => {
      console.error(error);
      return next(new AppError(error.message));
    });

    res.status(200).json({
      status: "ok",
      message: "Role added successfully",
      data: {},
    });
  }
});
module.exports.GetRoles = catchAsync(async (req, res, next) => {
  const { user_id, status } = req.query;

  // Check for required parameters
  if (!user_id) {
    return next(new AppError("User ID is required", 403));
  }
  if (!status) {
    return next(new AppError("Status is required", 403));
  }

  const colRef = collection(firestore, "roles");
  let queryData;

  // If status is "All", get all documents, otherwise filter by status
  if (status === "All") {
    queryData = colRef;
  } else {
    queryData = query(colRef, where("status", "==", status));
  }

  // Fetch the documents
  const snapshot = await getDocs(queryData);

  // Check if the snapshot is empty
  if (snapshot.empty) {
    console.log(`No roles found`);
    return next(new AppError("No roles found", 404));
  }

  // Extract the document data
  const documents = snapshot.docs.map((doc) => doc.data());

  // Respond with the data
  res.status(200).json({
    status: "ok",
    message: "Role(s) retrieved successfully",
    data: documents,
  });
});
module.exports.AssignRoles = catchAsync(async (req, res, next) => {
  const { role_id, user_id, userToAssignRole_id } = req.body;

  if (!role_id || !user_id || !userToAssignRole_id) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const roleAssignRef = doc(firestore, "users", userToAssignRole_id);

  // Check if the document exists
  const docSnapshot = await getDoc(roleAssignRef);
  if (!docSnapshot.exists()) {
    return next(new AppError("users not found", 404));
  }

  const updateData = {
    role_id,
    dateUpdated: new Date().toUTCString(),
  };

  await updateDoc(roleAssignRef, updateData).catch((error) => {
    return next(new AppError(error?.message));
  });

  res.status(200).json({
    status: "ok",
    message: "Role updated successfully",
    data: {},
  });
});
