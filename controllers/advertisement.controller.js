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



module.exports.AddAdvertisement = catchAsync(async (req, res, next) => {
  const {
    description = "",
    user_id,
    title,
    banner_link,
    category,
    start_date,
    end_date,
  } = req.body;

  if (
    !user_id ||
    !description ||
    !title ||
    !banner_link ||
    !category||
    !start_date||
    !end_date
  ) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const userRef = doc(collection(firestore, "advertisements"));
  const data = {
    id: userRef.id,
    userId: user_id,
    title,
    description,
    thumbnail: null,
    banner_link,
    category,
    start_date,
    end_date,
    dateCreated: new Date().toUTCString(),
    dateUpdated: new Date().toUTCString(),
    status: "draft",
  };

  if (req.file) {
    const storage = getStorage();
    const storageRef = ref(storage, `advertisement/${req.file.originalname}`);
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

        await setDoc(userRef, data).catch((error) => {
          console.error(error);
          return next(new AppError("Failed to add advertisement post"));
        });

        res.status(200).json({
          status: "ok",
          message: "Advertisement post added successfully",
          data: {},
        });
      }
    );
  } else {
    await setDoc(userRef, data).catch((error) => {
      console.error(error);
      return next(new AppError(error.message));
    });

    res.status(200).json({
      status: "ok",
      message: "Advertisement post added successfully",
      data: {},
    });
  }
});
module.exports.EditAdvertisementPost = catchAsync(async (req, res, next) => {
  const {
    id,
    description = "",
    user_id,
    title,
    banner_link,
    category,
    start_date,
    end_date,
  } = req.body;

  if (!id || !user_id) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const advertisementRef = doc(firestore, "advertisements", id);

  // Check if the document exists
  const docSnapshot = await getDoc(advertisementRef);
  if (!docSnapshot.exists()) {
    return next(new AppError("Advertisement post not found", 404));
  }

  const updateData = {
    description,
    title,
    userId: user_id,
    banner_link,
    category,
    start_date,
    end_date,
    dateUpdated: new Date().toUTCString(),
  };

  if (req.file) {
    const storage = getStorage();
    const storageRef = ref(storage, `advertisement/${req.file.originalname}`);
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

        await updateDoc(advertisementRef, updateData).catch((error) => {
          console.error(error);
          return next(new AppError("Failed to update advertisement post"));
        });

        res.status(200).json({
          status: "ok",
          message: "Advertisement post updated successfully",
          data: {},
        });
      }
    );
  } else {
    await updateDoc(advertisementRef, updateData).catch((error) => {
      console.error(error);
      return next(new AppError("Failed to update advertisement post"));
    });

    res.status(200).json({
      status: "ok",
      message: "Advertisement post updated successfully",
      data: {},
    });
  }
});
module.exports.PublishAdvertisementPost = catchAsync(async (req, res, next) => {
  const { id, user_id } = req.body;

  if (!id || !user_id) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const advertisementRef = doc(firestore, "advertisements", id);

  // Check if the document exists
  const docSnapshot = await getDoc(advertisementRef);
  if (!docSnapshot.exists()) {
    return next(new AppError("Advertisement post not found", 404));
  }

  const updateData = {
    status: "Publish",
    userId: user_id,
    dateUpdated: new Date().toUTCString(),
  };

  await updateDoc(advertisementRef, updateData).catch((error) => {
    console.error(error);
    return next(new AppError("Failed to publish advertisement post"));
  });

  res.status(200).json({
    status: "ok",
    message: "Advertisement post published successfully",
    data: {},
  });
});
module.exports.GetAdvertisementPost = catchAsync(async (req, res, next) => {
  const { user_id, status } = req.query;

  // Check for required parameters
  if (!user_id) {
    return next(new AppError("User ID is required", 403));
  }
  if (!status) {
    return next(new AppError("Status is required", 403));
  }

  const colRef = collection(firestore, "advertisements");
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
    console.log(`No advertisement post found`);
    return next(new AppError("No advertisement post found", 404));
  }

  // Extract the document data
  const documents = snapshot.docs.map((doc) => doc.data());

  // Respond with the data
  res.status(200).json({
    status: "ok",
    message: "Advertisement post retrieved successfully",
    data: documents,
  });
});
module.exports.DeleteAdvertisementPost = catchAsync(async (req, res, next) => {
  let { user_id, id } = req.query;

  if (!user_id) {
    return next(new AppError("user id is required", 403));
  }
  if (!id) {
    return next(
      new AppError("Advertisement post id is required to delete post", 403)
    );
  }

  const colRef = collection(firestore, "advertisements");
  const querry = query(colRef, where("id", "==", id));

  const snapshot = await getDocs(querry);

  if (snapshot.empty) {
    console.log(`Advertisement post not found`);
    return next(new AppError(`Advertisement post with ID ${id} not found`, 404));
  }

  async function deleteDocumentById(collectionName, documentId) {
    try {
      // Create a reference to the document
      const docRef = doc(firestore, collectionName, documentId);
  
      // Delete the document
      await deleteDoc(docRef).catch((error) => {
        console.error(error);
        return next(new AppError("Error deleting document", 404));
      });
      console.log(`Document with ID ${documentId} deleted successfully!`);
      res.status(200).json({
        status: "ok",
        message: `Document with ID ${documentId} deleted successfully!`,
      });
    } catch (error) {
      console.error("Error deleting document:", error);
      return next(new AppError("Error deleting document", 404));
    }
  }

  deleteDocumentById("advertisements", id);
});
