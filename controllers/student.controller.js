const catchAsync = require("../utils/errors/catchAsync");

const {
  admin,
  serviceAccount,
  firebaseConfig,
} = require("../firebaseadminvar");

const {
  getFirestore,
  collection,
  getDoc,
  doc,
  setDoc,
  getDocs,
  where,
  query,
  updateDoc,
  addDoc,
} = require("firebase/firestore");
const {
  getStorage,
  ref,
  getDownloadURL,
  uploadBytesResumable,
} = require("firebase/storage");

const storage = getStorage();

const AppError = require("../utils/errors/AppError");
// const { query } = require("express");
const firestore = getFirestore();

//This endpoint assumes that payment has been made
module.exports.enrollCourse = catchAsync(async (req, res, next) => {
  let { uid, courseid } = req.body;

  if (!uid) {
    return next(new AppError("userid is required", 403));
  }

  if (!courseid) {
    return next(new AppError("courseid is required", 403));
  }

  let userData = {};

  //Get the user first
  await getDoc(doc(firestore, "users", uid))
    .then((docSnapshot) => {
      if (docSnapshot.exists) {
        const data = docSnapshot.data();

        userData = data;
      } else {
        console.log("User not found!");
        return next(new AppError("User not found", 404));
      }
    })
    .catch((error) => {
      console.error("Error reading document:", error);
      return next(new AppError(error, 403));
    });

  //get the course
  const documentRef = doc(firestore, "courses", courseid);

  //add the course to the user under the users collection
  await getDoc(documentRef)
    .then((sourceDocSnapshot) => {
      if (sourceDocSnapshot.exists) {
        const sourceData = sourceDocSnapshot.data();

        const nestedCollectionRef = collection(
          doc(firestore, "users", uid),
          "courses"
        );

        return addDoc(nestedCollectionRef, sourceData)
          .then((docRef) => {
            console.log(
              "Document copied to users courses successfully:",
              docRef.id
            );
          })
          .catch((error) => {
            console.error("Error copying document to users courses:", error);
          });
      } else {
        // Document not found
        console.log("Source document not found!");
        return next(new AppError("Source document not found!", 404));
      }
    })
    .then(() => {
      console.log("Document copied successfully!");
    })
    .catch((error) => {
      console.error("Error copying document:", error);
      return next(new AppError(error, 403));
    });

  await getDoc(documentRef)
    .then((docSnapshot) => {
      if (docSnapshot.exists) {
        const data = docSnapshot.data();

        // Check if the students field exists
        const existingStudents = data.students || []; // Initialize as empty array if null

        const updatedStudents = [
          ...existingStudents,
          {
            id: uid,
            ...userData,
          },
        ]; // Add "yyyy" to the existing students

        // Update the document with the modified students field
        updateDoc(documentRef, { students: updatedStudents });

        res.status(200).json({
          status: "ok",
          message: "Erollement Successful",
          data: {},
        });
      } else {
        console.log("Document not found!");
        return next(new AppError("Course not found", 404));
      }
    })
    .catch((error) => {
      console.error("Error reading document:", error);
      return next(new AppError(error, 403));
    });
});

module.exports.getStudents = catchAsync(async (req, res, next) => {
  let { uid } = req.query;

  if (!uid) {
    return next(new AppError("userid is required", 403));
  }

  const colRef = collection(firestore, "courses");
  const querry = query(colRef, where("instructor id", "==", uid));

  const snapshot = await getDocs(querry);

  if (snapshot.empty) {
    console.log(`You havent uploaded any course`);
    res.status(200).json({
      status: "ok",
      message: "You havent uploaded any course",
      data: {},
    });
    return null; // Or handle the case where no document is found
  }

  const documents = [];
  snapshot.forEach((doc) => {
    documents.push(...doc.data()["students"]);
  });

  res.status(200).json({
    status: "ok",
    message: "Students gotten successfully",
    data: documents,
  });
});

module.exports.getStudentDetailOld = catchAsync(async (req, res, next) => {
  let { uid } = req.query;

  if (!uid) {
    return next(new AppError("userid is required", 403));
  }

  const colRef = collection(firestore, "users");
  const querry = query(colRef, where("id", "==", uid));

  const snapshot = await getDocs(querry);

  if (snapshot.empty) {
    console.log(`You havent uploaded any course`);
    res.status(200).json({
      status: "ok",
      message: "You haven't uploaded this student",
      data: {},
    });
    return null; // Or handle the case where no document is found
  }
  // if (snapshot.empty) {
  //   console.log(`You havent uploaded any course`);
  //   res.status(200).json({
  //     status: "ok",
  //     message: "You havent uploaded any course",
  //     data: {},
  //   });
  //   return null; // Or handle the case where no document is found
  // }

  // const documents = [];
  // snapshot.forEach((doc) => {
  //   documents.push(...doc.data()["students"]);
  // });

  res.status(200).json({
    status: "ok",
    message: "Students gotten successfully",
    data: snapshot,
  });
});

module.exports.getStudentDetail = catchAsync(async (req, res, next) => {
  const { uid } = req.query;

  // Validate if uid is provided
  if (!uid) {
    return next(new AppError("User ID is required.", 403));
  }

  try {
    // Initialize Firestore and query for the student by their user ID
    const colRef = collection(firestore, "users");
    const userQuery = query(colRef, where("id", "==", uid));
    const snapshot = await getDocs(userQuery);

    // Handle case where no matching user is found
    if (snapshot.empty) {
      return res.status(404).json({
        status: "fail",
        message: "User not found",
        data: {},
      });
    }

    // Extract and return the user's data
    const userData = snapshot.docs[0].data();

    res.status(200).json({
      status: "success",
      message: "User details retrieved successfully",
      data: userData,
    });
  } catch (error) {
    // Catch and handle any errors during the process
    console.error("Error fetching user details:", error);
    return next(new AppError("Error fetching user details.", 500));
  }
});


// Only 7 of the 57 students had type "student" (accounts made in the new app
// have none), so the list showed a fraction of them. A student is anyone who
// isn't staff. Admin SDK, cached briefly: the dashboard asks several times.
let studentsCache = null;
module.exports.GetAllStudents = catchAsync(async (req, res) => {
  const { db } = require("../firebaseadminvar");
  if (!studentsCache || Date.now() - studentsCache.at > 30 * 1000) {
    const [snap, enrolSnap] = await Promise.all([db.collection("users").get(), db.collection("enrollments").get()]);
    // Enrolments live in their own collection; the old per-user
    // `enrolledCourses` field is empty for everyone who enrolled since.
    const byStudent = {};
    enrolSnap.docs.forEach((d) => {
      const e = d.data();
      (byStudent[e.student_id] = byStudent[e.student_id] || []).push(e.course_id);
    });
    studentsCache = {
      at: Date.now(),
      docs: snap.docs.map((d) => {
        const u = d.data();
        const uid = u.id || d.id;
        return {
          ...u,
          id: uid,
          name: u.name || u.username || u.displayName || (u.email || "").split("@")[0] || "",
          enrolledCourses: byStudent[uid] || byStudent[d.id] || u.enrolledCourses || [],
        };
      }),
    };
  }
  const allUsers = studentsCache.docs.filter((u) => u.type !== "admin" && u.admin !== true);
  const since = Date.now() - 48 * 60 * 60 * 1000;
  const mostRecentUsers = allUsers.filter((u) => {
    const t = Date.parse(u.dateCreated || u.datecreated || u.createdAt);
    return Number.isFinite(t) && t >= since;
  });
  res.status(200).json({
    status: "success",
    message: "Students fetched successfully!",
    data: { allUsers, mostRecentUsers },
  });
});

