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

module.exports.DeleteAnnouncement = catchAsync(async (req, res, next) => {
  let { uid, announcement_id } = req.query;

  if (!uid) {
    return next(new AppError("userid is required", 403));
  }
  if (!announcement_id) {
    return next(
      new AppError("announcement id is required to delete announcement", 403)
    );
  }

  const colRef = collection(firestore, "announcements");
  const querry = query(colRef, where("id", "==", announcement_id));

  const snapshot = await getDocs(querry);

  if (snapshot.empty) {
    console.log(`announcement not found`);
    return next(
      new AppError(`Document with ID ${announcement_id} not found`, 404)
    );
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

  deleteDocumentById("announcements", announcement_id);
});

module.exports.AddAnnouncementOld = catchAsync(async (req, res, next) => {
  let { type, description, uid, title } = req.body;

  if (!uid) {
    return next(new AppError("userid is required", 403));
  }

  if (!type || !description || !title) {
    return next(new AppError("All fields are required", 403));
  }

  if (!req.file) {
    const userRef = doc(collection(firestore, "announcements"));

    await setDoc(userRef, {
      datecreated: new Date().toUTCString(),
      date: new Date().toUTCString(),
      thumbnail: null,
      type: type,
      description: description ?? "",
      image: null,
      type: type,
      title: title,
      userid: uid,
      id: userRef.id,
    }).catch((error) => {
      console.error(error);
      return next(new AppError("Failed to add program"));
    });

    // userCredential.user.upda

    res.status(200).json({
      status: "ok",
      message: "Announcements added Successfully",
      data: {},
    });
  } else {
    const imageBuffer = req.file.buffer;

    // const storage = getStorage(admin.app());
    const storageRef = ref(storage, `announcement/${req.file.originalname}`);

    // Create a reference to the uploaded file in Firebase Storage
    const uploadTask = uploadBytesResumable(storageRef, imageBuffer);

    // Handle upload progress (optional)
    uploadTask.on(
      "state_changed",
      (snapshot) => {
        // Observe state change events such as progress, pause, and resume
        const progress =
          (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        console.log("Upload is " + progress + "% done");
        switch (snapshot.state) {
          case "paused":
            console.log("Upload is paused");
            break;
          case "running":
            console.log("Upload is in progress");
            break;
        }
      },
      (error) => {
        // Handle upload errors
        console.error("Error uploading image:", error);
        return next(new AppError(error.message));
      },
      async () => {
        // Successfully uploaded the image
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        console.log("Image uploaded successfully! Download URL:", downloadURL);
        console.log("Storing download URL in Firestore...");
        // ... your Firestore logic to store the downloadURL ...

        const userRef = doc(collection(firestore, "announcements"));

        await setDoc(userRef, {
          datecreated: new Date().toUTCString(),
          date: new Date().toUTCString(),
          thumbnail: downloadURL,
          type: type,
          description: description ?? "",
          image: downloadURL,
          type: type,
          title: title,
          userid: uid,
          id: userRef.id,
        }).catch((error) => {
          console.error(error);
          return next(new AppError("Failed to add program"));
        });

        // userCredential.user.upda

        res.status(200).json({
          status: "ok",
          message: "Announcements added Successfully",
          data: {},
        });
      }
    );
  }
});

module.exports.AddAnnouncement = catchAsync(async (req, res, next) => {
  const { type, description = "", user_id, title } = req.body;

  if (!user_id || !type || !description || !title) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const userRef = doc(collection(firestore, "announcements"));
  const data = {
    dateCreated: new Date().toUTCString(),
    date: new Date().toUTCString(),
    thumbnail: null,
    type,
    description,
    image: null,
    title,
    userId: user_id,
    status: "draft",
    id: userRef.id,
  };

  if (req.file) {
    const storage = getStorage();
    const storageRef = ref(storage, `announcement/${req.file.originalname}`);
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
        data.image = downloadURL;

        await setDoc(userRef, data).catch((error) => {
          console.error(error);
          return next(new AppError("Failed to add announcement"));
        });

        res.status(200).json({
          status: "ok",
          message: "Announcement added successfully",
          data: {},
        });
      }
    );
  } else {
    await setDoc(userRef, data).catch((error) => {
      console.error(error);
      return next(new AppError("Failed to add announcement"));
    });

    res.status(200).json({
      status: "ok",
      message: "Announcement added successfully",
      data: {},
    });
  }
});
module.exports.EditAnnouncement = catchAsync(async (req, res, next) => {
  const { id, type, description = "", uid, title } = req.body;

  if (!id || !uid || !type || !description || !title) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const announcementRef = doc(firestore, "announcements", id);

  // Check if the document exists
  const docSnapshot = await getDoc(announcementRef);
  if (!docSnapshot.exists()) {
    return next(new AppError("Announcement not found", 404));
  }

  const updateData = {
    type,
    description,
    title,
    userId: uid,
    dateUpdated: new Date().toUTCString(),
  };

  if (req.file) {
    const storage = getStorage();
    const storageRef = ref(storage, `announcement/${req.file.originalname}`);
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
        updateData.image = downloadURL;

        await updateDoc(announcementRef, updateData).catch((error) => {
          console.error(error);
          return next(new AppError("Failed to update announcement"));
        });

        res.status(200).json({
          status: "ok",
          message: "Announcement updated successfully",
          data: {},
        });
      }
    );
  } else {
    await updateDoc(announcementRef, updateData).catch((error) => {
      console.error(error);
      return next(new AppError("Failed to update announcement"));
    });

    res.status(200).json({
      status: "ok",
      message: "Announcement updated successfully",
      data: {},
    });
  }
});
module.exports.PublishAnnouncement = catchAsync(async (req, res, next) => {
  const { id, user_id } = req.body;

  if (!id || !user_id) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const announcementRef = doc(firestore, "announcements", id);

  // Check if the document exists
  const docSnapshot = await getDoc(announcementRef);
  if (!docSnapshot.exists()) {
    return next(new AppError("Announcement not found", 404));
  }

  const updateData = {
    status: "Publish",
    userId: user_id,
    dateUpdated: new Date().toUTCString(),
  };

  await updateDoc(announcementRef, updateData).catch((error) => {
    console.error(error);
    return next(new AppError("Failed to publish announcement"));
  });

  res.status(200).json({
    status: "ok",
    message: "Announcement published successfully",
    data: {},
  });
});

module.exports.GetAnnouncements = catchAsync(async (req, res, next) => {
  const { user_id, status } = req.query;

  // Check for required parameters
  if (!user_id) {
    return next(new AppError("User ID is required", 403));
  }
  if (!status) {
    return next(new AppError("Status is required", 403));
  }

  const colRef = collection(firestore, "announcements");
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
    console.log(`No announcements found`);
    return next(new AppError("No announcements found", 404));
  }

  // Extract the document data
  const documents = snapshot.docs.map((doc) => doc.data());

  // Respond with the data
  res.status(200).json({
    status: "ok",
    message: "Announcements retrieved successfully",
    data: documents,
  });
});
