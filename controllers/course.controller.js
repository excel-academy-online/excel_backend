const catchAsync = require("../utils/errors/catchAsync");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const encryptVideo = require("../utils/encryptVideo");
const path = require("path");
const { initializeApp } = require("firebase/app");
const {
  getStorage,
  ref,
  getDownloadURL,
  uploadBytesResumable,
} = require("firebase/storage");
const {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  where,
  query,
  updateDoc,
} = require("firebase/firestore");
const upload = require("../utils/multer");

const Modules = require("../models/modules.schema");
const AppError = require("../utils/errors/AppError");
const Courses = require("../models/courses.model");
const firebaseConfig = require("../utils/firebase.config");
const axios = require("axios");
const decryptVideo = require("../utils/decryptVideo");
// const fs = require("fs");
// const getVideoDurationInSeconds = require("get-video-duration");
const key = Buffer.from(process.env.key, "hex");
const iv = Buffer.from(process.env.iv, "hex");

async function getProgramsFunction(next) {
  const firestore = getFirestore();
  try {
    const colRef = collection(firestore, "programs");
    const querry = query(colRef, where("status", "==", 1));

    const snapshot = await getDocs(querry);

    if (snapshot.empty) {
      console.log(`You havent uploaded any program`);
      res.status(200).json({
        status: "ok",
        message: "Programs not uploaded yet",
        data: {},
      });
      return null; // Or handle the case where no document is found
    }

    const documents = [];
    snapshot.forEach((doc) => {
      documents.push(doc.data());
    });

    return documents;
  } catch (error) {
    console.error(error.message, error);
    return next(new AppError(error.message));
  }
}

async function getProgramsCourseFunction(id, next, res) {
  const firestore = getFirestore();
  try {
    const colRef = collection(firestore, "courses");
    const querry = query(colRef, where("programId", "==", id));

    const snapshot = await getDocs(querry);

    if (snapshot.empty) {
      console.log(`You haven't uploaded any program`);
      res.status(200).json({
        status: "ok",
        message: "Course not uploaded yet",
        data: [],
      });
      return null; // Or handle the case where no document is found
    }

    const documents = [];
    snapshot.forEach((doc) => {
      documents.push(doc.data());
    });

    return documents;
  } catch (error) {
    console.error(error.message, error);
    return next(new AppError(error.message));
  }
}
async function getProgramsCourseViaLevelFunction(level, next, res) {
  const firestore = getFirestore();
  try {
    const colRef = collection(firestore, "courses");
    const querry = query(colRef, where("level", "==", level));

    const snapshot = await getDocs(querry);

    if (snapshot.empty) {
      console.log(`You havent uploaded any program`);
      res.status(200).json({
        status: "ok",
        message: "Course not uploaded yet",
        data: [],
      });
      return null; // Or handle the case where no document is found
    }

    const documents = [];
    snapshot.forEach((doc) => {
      documents.push(doc.data());
    });

    return documents;
  } catch (error) {
    console.error(error.message, error);
    return next(new AppError(error.message));
  }
}

async function getProgramsCourseLessonsFunction(id, next) {
  const firestore = getFirestore();
  try {
    const colRef = collection(firestore, "courses");
    const querySnapshot = await getDocs(query(colRef, where("id", "==", id)));

    if (querySnapshot.empty) {
      console.log(`You haven't uploaded any program`);
      return {
        status: "ok",
        message: "Lessons not uploaded yet",
        data: [],
      };
    }

    const documents = [];
    querySnapshot.forEach((doc) => {
      const courseData = doc.data();
      if (courseData.lesson && Array.isArray(courseData.lesson)) {
        courseData.lesson.forEach((lesson) => {
          documents.push(lesson);
        });
      }
    });

    return documents;
  } catch (error) {
    console.error(error.message, error);
    return next(new AppError(error.message));
  }
}

async function getCourseFunction(next) {
  const firestore = getFirestore();
  try {
    const colRef = collection(firestore, "courses");
    const querry = query(colRef, where("status", "==", 1));

    const snapshot = await getDocs(querry);

    if (snapshot.empty) {
      return false; // Return false if no documents are found
    }

    const documents = [];
    snapshot.forEach((doc) => {
      const data = doc.data();

      // Add count properties for arrays
      const processedCourse = {
        ...data,
        faqCount: data.faq?.length || 0,
        lessonCount: data.lesson?.length || 0,
        quizCount: data.quiz?.length || 0,
        assignmentCount: data.assignment?.length || 0,
        examsCount: data.exams?.length || 0,
      };

      documents.push(processedCourse);
    });

    return documents;
  } catch (error) {
    return next(new AppError(error.message));
  }
}

async function checkIfCourseExistWithId(course_id) {
  const firestore = getFirestore();

  const programsRef = collection(firestore, "courses");

  const q = query(programsRef, where("id", "==", course_id));
  const querySnapshot = await getDocs(q);
  // console.log(querySnapshot);

  return querySnapshot;
}

async function checkIfValueExist(passData, keyParam1, keyParam2, searchParams) {
  const filterCheck = passData[keyParam1].some(
    (lesson) => lesson[keyParam2] === searchParams
  );
  return filterCheck;
}

module.exports.createProgram = catchAsync(async (req, res, next) => {
  let { program_name, levels, user_id, description } = req.body;

  if (!user_id) {
    return next(new AppError("user_id is required", 403));
  }

  if (!program_name || !levels) {
    return next(new AppError("All fields are required", 403));
  }

  // Parse levels if it's a string
  if (typeof levels === "string") {
    try {
      levels = JSON.parse(levels);
    } catch (error) {
      return next(
        new AppError(
          "Invalid format for levels. It should be a valid JSON array.",
          403
        )
      );
    }
  }

  if (!Array.isArray(levels) || levels.length < 1) {
    return next(new AppError("Add at least one level", 403));
  }

  if (!req.file) {
    console.log("no file");
    return next(new AppError("Error: No image uploaded", 400));
  }

  const firestore = getFirestore();

  const programsRef = collection(firestore, "programs");
  const q = query(programsRef, where("program_name", "==", program_name));
  const querySnapshot = await getDocs(q);

  if (!querySnapshot.empty) {
    return next(new AppError("Program with this name already exists", 403));
  }

  const imageBuffer = req.file.buffer;
  const storage = getStorage();
  const storageRef = ref(storage, `programs/${req.file.originalname}`);

  const uploadTask = uploadBytesResumable(storageRef, imageBuffer);

  uploadTask.on(
    "state_changed",
    (snapshot) => {
      const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
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
      console.error("Error uploading image:", error);
      return next(new AppError(error.message));
    },
    async () => {
      const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
      console.log("Image uploaded successfully! Download URL:", downloadURL);
      console.log("Storing download URL in Firestore...");

      const userRef = doc(collection(firestore, "programs"));

      await setDoc(userRef, {
        datecreated: new Date().toUTCString(),
        date: new Date().toUTCString(),
        thumbnail: downloadURL,
        program_name: program_name,
        description: description ?? "",
        image: downloadURL,
        levels: levels, // levels should now be an array
        user_id: user_id,
        instructor: user_id,
        id: userRef.id,
        status: 1,
      }).catch((error) => {
        console.error(error);
        return next(new AppError("Failed to add program"));
      });

      res.status(200).json({
        status: "ok",
        message: "Program added Successfully",
        data: [],
      });
    }
  );
});

module.exports.deleteProgram = catchAsync(async (req, res, next) => {
  const { program_id } = req.params;

  if (!program_id) {
    return next(new AppError("Program ID is required", 403));
  }

  const firestore = getFirestore();

  const programRef = doc(collection(firestore, "programs"), program_id);
  const programSnapshot = await getDoc(programRef);

  if (!programSnapshot.exists()) {
    return next(new AppError("Program not found", 404));
  }

  await updateDoc(programRef, {
    status: 0,
    dateDeleted: new Date().toUTCString(),
  }).catch((error) => {
    console.error("Failed to delete program:", error);
    return next(new AppError("Failed to delete program"));
  });
  res.status(200).json({
    status: "ok",
    message: "Program deleted successfully",
  });
});

module.exports.addLevelsToProgram = catchAsync(async (req, res, next) => {
  const { program_id } = req.params;
  let { new_levels } = req.body;

  if (!Array.isArray(new_levels) || new_levels.length === 0) {
    return next(new AppError("new_levels should be a non-empty array", 403));
  }

  const firestore = getFirestore();
  const programRef = doc(collection(firestore, "programs"), program_id);
  const programSnapshot = await getDoc(programRef);

  if (!programSnapshot.exists()) {
    return next(new AppError("Program not found", 404));
  }

  const existingLevels = programSnapshot.data().levels || [];
  const levelsToAdd = new_levels.filter(level => !existingLevels.includes(level));

  if (levelsToAdd.length === 0) {
    return next(new AppError("No new levels to add", 403));
  }

  await updateDoc(programRef, {
    levels: [...existingLevels, ...levelsToAdd],
  }).catch((error) => {
    console.error("Failed to add levels:", error);
    return next(new AppError("Failed to add levels"));
  });

  res.status(200).json({
    status: "ok",
    message: "Levels added successfully",
    addedLevels: levelsToAdd,
  });
});

module.exports.removeLevelsFromProgram = catchAsync(async (req, res, next) => {
  const { program_id } = req.params;
  let { levels_to_remove } = req.body; // `levels_to_remove` should be an array of levels to remove

  if (!Array.isArray(levels_to_remove) || levels_to_remove.length === 0) {
    return next(new AppError("levels_to_remove should be a non-empty array", 403));
  }

  const firestore = getFirestore();
  const programRef = doc(collection(firestore, "programs"), program_id);
  const programSnapshot = await getDoc(programRef);

  if (!programSnapshot.exists()) {
    return next(new AppError("Program not found", 404));
  }

  const existingLevels = programSnapshot.data().levels || [];
  const updatedLevels = existingLevels.filter(level => !levels_to_remove.includes(level));

  if (updatedLevels.length === existingLevels.length) {
    return next(new AppError("No matching levels found to remove", 403));
  }

  await updateDoc(programRef, {
    levels: updatedLevels,
  }).catch((error) => {
    console.error("Failed to remove levels:", error);
    return next(new AppError("Failed to remove levels"));
  });

  res.status(200).json({
    status: "ok",
    message: "Levels removed successfully",
    removedLevels: levels_to_remove,
  });
});



module.exports.createLessonSession = catchAsync(async (req, res, next) => {
  let { user_id, session_name, course_id } = req.body;

  if (!user_id) {
    return next(new AppError("user_id is required", 403));
  }

  if ((!session_name, !course_id)) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();

  const programsRef = collection(firestore, "courses");
  console.log(programsRef);

  const q = query(programsRef, where("id", "==", course_id));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) {
    return next(new AppError("Course does not exists", 404));
  }
  const courseDoc = querySnapshot.docs[0];
  const courseData = courseDoc.data();

  // Check if session_name already exists in lesson array
  const sessionExists = courseData.lesson.some(
    (lesson) => lesson.session_name === session_name
  );

  if (sessionExists) {
    return next(new AppError("Session name already exists", 409)); // 409 Conflict
  }

  const sessionId = uuidv4();

  const newSession = {
    id: sessionId,
    session_name: session_name,
    creator: user_id,
    status: 1,
    content: [],
  };

  const updatedLessons = [...courseData.lesson, newSession];
  await updateDoc(courseDoc.ref, {
    lesson: updatedLessons,
  });
  res.status(200).json({
    status: "ok",
    message: "New session created successfully",
    data: {
      lesson: updatedLessons, // Returning the updated lesson array
    },
  });
});

module.exports.editLessonSession = catchAsync(async (req, res, next) => {
  const { course_id, session_id } = req.params;
  const { session_name, user_id, content } = req.body;

  if (!course_id || !session_id) {
    return next(new AppError("Course ID and Session ID are required", 403));
  }

  if (!user_id) {
    return next(new AppError("user_id is required", 403));
  }

  const firestore = getFirestore();

  const courseRef = doc(collection(firestore, "courses"), course_id);
  const courseSnapshot = await getDoc(courseRef);

  if (!courseSnapshot.exists()) {
    return next(new AppError("Course not found", 404));
  }

  const courseData = courseSnapshot.data();

  const sessionIndex = courseData.lesson.findIndex(
    (lesson) => lesson.id === session_id
  );

  if (sessionIndex === -1) {
    return next(new AppError("Session not found", 404));
  }

  const updatedSession = {
    ...courseData.lesson[sessionIndex],
    session_name: session_name || courseData.lesson[sessionIndex].session_name,
    creator: user_id,
    content: content || courseData.lesson[sessionIndex].content,
  };

  // Replace the session in the lesson array
  const updatedLessons = [...courseData.lesson];
  updatedLessons[sessionIndex] = updatedSession;

  // Update the document with the new lesson array
  await updateDoc(courseRef, {
    lesson: updatedLessons,
  }).catch((error) => {
    console.error("Failed to update lesson session:", error);
    return next(new AppError("Failed to update lesson session"));
  });

  res.status(200).json({
    status: "ok",
    message: "Session updated successfully",
    data: {
      lesson: updatedLessons, // Returning the updated lesson array
    },
  });
});


module.exports.createFaq = catchAsync(async (req, res, next) => {
  let { user_id, course_id, faq_qst, faq_ans } = req.body;

  if (!user_id) {
    return next(new AppError("user_id is required", 403));
  }

  if ((!course_id, !faq_qst, !faq_ans)) {
    return next(new AppError("All fields are required", 403));
  }
  const querySnapshot = await checkIfCourseExistWithId(course_id);

  if (querySnapshot.empty) {
    return next(new AppError("Course does not exists", 404));
  }
  const courseDoc = querySnapshot.docs[0];
  const courseData = courseDoc.data();
  const faqExists = await checkIfValueExist(
    courseData,
    "faq",
    "faq_qst",
    faq_qst
  );

  if (faqExists) {
    return next(new AppError("Question already exists", 409)); // 409 Conflict
  }

  const faqId = uuidv4();
  const newFaq = {
    id: faqId,
    faq_qst: faq_qst,
    faq_ans: faq_ans,
    creator: user_id,
    status: 1,
  };

  const updatedFaq = [...courseData.faq, newFaq];
  await updateDoc(courseDoc.ref, {
    faq: updatedFaq,
  });
  res.status(200).json({
    status: "ok",
    message: "New faq created successfully",
    data: {
      faq: updatedFaq, // Returning the updated lesson array
    },
  });
});

module.exports.multipleCreateFaq = catchAsync(async (req, res, next) => {
  let { user_id, course_id, faqs } = req.body;

  // Check if user_id, course_id, and faqs are provided
  if (!user_id) {
    return next(new AppError("user_id is required", 403));
  }

  if (!course_id || !faqs || !Array.isArray(faqs)) {
    return next(
      new AppError("course_id and an array of faqs are required", 403)
    );
  }

  const querySnapshot = await checkIfCourseExistWithId(course_id);

  // Check if the course exists
  if (querySnapshot.empty) {
    return next(new AppError("Course does not exist", 404));
  }

  const courseDoc = querySnapshot.docs[0];
  const courseData = courseDoc.data();

  // Validate each FAQ and check if it already exists
  const newFaqs = [];

  for (const faq of faqs) {
    const { faq_qst, faq_ans } = faq;

    if (!faq_qst || !faq_ans) {
      return next(
        new AppError("faq_qst and faq_ans are required for each FAQ", 403)
      );
    }

    // Check if the FAQ question already exists
    const faqExists = await checkIfValueExist(
      courseData,
      "faq",
      "faq_qst",
      faq_qst
    );

    if (faqExists) {
      return next(new AppError(`Question "${faq_qst}" already exists`, 409)); // Conflict for duplicate question
    }

    // Generate a new FAQ object
    const faqId = uuidv4();
    const newFaq = {
      id: faqId,
      faq_qst: faq_qst,
      faq_ans: faq_ans,
      creator: user_id,
      status: 1,
    };

    // Add the new FAQ to the list to be added
    newFaqs.push(newFaq);
  }

  // Update the course with the new FAQs
  const updatedFaq = [...courseData.faq, ...newFaqs];

  await updateDoc(courseDoc.ref, {
    faq: updatedFaq,
  });

  res.status(200).json({
    status: "ok",
    message: "FAQs created successfully",
    data: {
      faq: updatedFaq,
    },
  });
});

// Helper function to check if a value exists in an array of objects
async function checkIfValueExist(passData, keyParam1, keyParam2, searchParams) {
  const filterCheck = passData[keyParam1].some(
    (lesson) => lesson[keyParam2] === searchParams
  );
  return filterCheck;
}

module.exports.getAllFaq = catchAsync(async (req, res, next) => {
  let { user_id, course_id } = req.query;

  if (!user_id) {
    return next(new AppError("user id is required", 403));
  }
  if (!course_id) {
    return next(new AppError("course id is required", 403));
  }

  const querySnapshot = await checkIfCourseExistWithId(course_id);
  if (querySnapshot.empty) {
    return next(new AppError("Course does not exists", 404));
  }
  const courseDoc = querySnapshot.docs[0];
  const courseData = courseDoc.data();

  if (courseData) {
    res.status(200).json({
      status: "ok",
      message: "Faq gotten successfully",
      data: courseData?.faq,
    });
  } else {
    res.status(200).json({
      status: "ok",
      message: "No Faq Found",
      data: courseData?.faq,
    });
  }
});

module.exports.uploadSessionContentSingle = catchAsync(
  async (req, res, next) => {
    let { user_id, course_id, session_id, content_title } = req.body;

    // let { user_id, program_id, title, description, creator, package, price, cancelPrice, level, requirements, whoforcourse, about_group, category, certification, courseDateDuration, courseTimeDuration, } = req.body;

    if (!user_id) {
      return next(new AppError("userid is required", 403));
    }

    if (!session_id || !content_title || !course_id) {
      return next(new AppError("All fields are required", 403));
    }

    if (!req.file) {
      return next(new AppError("Error: No File uploaded", 400));
    }
    const firestore = getFirestore();

    const courseRef = collection(firestore, "courses");
    const q = query(courseRef, where("id", "==", course_id));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return next(new AppError("Course does not exists", 404));
    }
    const courseDoc = querySnapshot.docs[0];
    const courseData = courseDoc.data();

    const sessionContent = courseData.lesson.find(
      (lesson) => lesson.id === session_id
    );

    if (!sessionContent) {
      return next(new AppError("Session not found", 404));
    }

    const storage = getStorage();
    const imageBuffer = req.file.buffer;

    // const storage = getStorage(admin.app());
    const storageRef = ref(storage, `courses/${req.file.originalname}`);

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

        const mediaContent = {
          image: downloadURL,
          thumbnail: downloadURL,
          type: "img",
          status: 1,
        };
        const sessionId = uuidv4();
        const newSession = {
          id: sessionId,
          title: content_title,
          session_Id: user_id,
          status: 1,
          medias: [mediaContent],
        };
        const updatedLessons = [...sessionContent.content, newSession];
        await updateDoc(courseDoc.ref, {
          content: updatedLessons,
        }).catch((error) => {
          console.error(error);
          return next(new AppError("Failed to upload lesson Content"));
        });
        res.status(200).json({
          status: "ok",
          message: "New session created successfully",
          data: {
            content: updatedLessons, // Returning the updated lesson array
          },
        });
      }
    );
  }
);

module.exports.uploadSessionContent = catchAsync(async (req, res, next) => {
  let { user_id, course_id, session_id, content_title } = req.body;

  if (!user_id) {
    return next(new AppError("User ID is required", 403));
  }

  if (!session_id || !content_title || !course_id) {
    return next(new AppError("All fields are required", 403));
  }

  if (!req.files || req.files.length === 0) {
    return next(new AppError("Error: No files uploaded", 400));
  }

  const firestore = getFirestore();
  const courseRef = collection(firestore, "courses");
  const q = query(courseRef, where("id", "==", course_id));
  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) {
    return next(new AppError("Course does not exist", 404));
  }

  const courseDoc = querySnapshot.docs[0];
  const courseData = courseDoc.data();
  const session = courseData.lesson.find((lesson) => lesson.id === session_id);

  if (!session) {
    return next(new AppError("Session not found", 404));
  }

  const storage = getStorage();
  const mediaContents = [];

  for (const file of req.files) {
    const storageRef = ref(storage, `courses/${file.originalname}`);
    const uploadTask = uploadBytesResumable(storageRef, file.buffer);

    await new Promise((resolve, reject) => {
      uploadTask.on(
        "state_changed",
        (snapshot) => {
          const progress =
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          console.log("Upload is " + progress + "% done");
        },
        (error) => {
          console.error("Error uploading file:", error);
          reject(new AppError(error.message));
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          console.log("File uploaded successfully! Download URL:", downloadURL);

          let mediaType;
          if (file.mimetype.startsWith("image/")) {
            mediaType = "image";
          } else if (file.mimetype.startsWith("video/")) {
            mediaType = "video";
          } else if (file.mimetype === "application/pdf") {
            mediaType = "pdf";
          } else if (file.mimetype.includes("word")) {
            mediaType = "doc";
          } else {
            mediaType = "unknown";
          }

          mediaContents.push({
            image: downloadURL,
            thumbnail: downloadURL,
            type: mediaType,
            status: 1,
          });

          resolve();
        }
      );
    });
  }

  const newSession = {
    id: uuidv4(),
    title: content_title,
    session_Id: user_id,
    status: 1,
    medias: mediaContents,
  };

  session.content.push(newSession);

  await updateDoc(courseDoc.ref, {
    lesson: courseData.lesson,
  }).catch((error) => {
    console.error(error);
    return next(new AppError("Failed to upload lesson content", 500));
  });

  res.status(200).json({
    status: "ok",
    message: "New session created successfully",
    data: {
      content: session.content,
    },
  });
});

module.exports.createQuiz = catchAsync(async (req, res, next) => {
  const {
    user_id,
    course_id,
    session_id,
    question,
    questionAnswer,
    options,
    score,
  } = req.body;

  const options2 = JSON.parse(options);
  // Check if options is an array and if it is in the correct format
  if (!Array.isArray(options2)) {
    console.log("Options is not an array:", options2);
    return next(new AppError("Options must be an array", 400));
  }

  if (!user_id) {
    return next(new AppError("User ID is required", 400));
  }

  if (
    !session_id ||
    !question ||
    !course_id ||
    !questionAnswer ||
    !options2 ||
    !score
  ) {
    return next(new AppError("All fields are required", 400));
  }

  const querySnapshot = await checkIfCourseExistWithId(course_id);

  if (querySnapshot.empty) {
    return next(new AppError("Course does not exist", 404));
  }

  const courseDoc = querySnapshot.docs[0];
  const courseData = courseDoc.data();
  const session = courseData.lesson.find((lesson) => lesson.id === session_id);

  if (!session) {
    return next(new AppError("Session not found", 404));
  }

  const quizExists = courseData.quiz.some((quiz) => quiz.question === question);

  if (quizExists) {
    return next(new AppError("Quiz already exists", 403));
  }

  const storage = getStorage();
  const mediaContents = [];

  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      const storageRef = ref(storage, `courses/${file.originalname}`);
      const uploadTask = uploadBytesResumable(storageRef, file.buffer);

      try {
        await new Promise((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            (snapshot) => {
              const progress =
                (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              console.log(`Upload is ${progress}% done`);
            },
            (error) => {
              console.error("Error uploading file:", error);
              reject(new AppError(error.message));
            },
            async () => {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

              let mediaType;
              if (file.mimetype.startsWith("image/")) {
                mediaType = "image";
              } else if (file.mimetype.startsWith("video/")) {
                mediaType = "video";
              } else if (file.mimetype === "application/pdf") {
                mediaType = "pdf";
              } else if (file.mimetype.includes("word")) {
                mediaType = "doc";
              } else {
                mediaType = "unknown";
              }

              mediaContents.push({
                image: downloadURL,
                thumbnail: downloadURL,
                type: mediaType,
                status: 1,
              });

              resolve();
            }
          );
        });
      } catch (error) {
        return next(new AppError("Failed to upload media content", 500));
      }
    }
  }

  // Assuming options are already structured correctly as an array of objects
  const newQuiz = {
    id: uuidv4(),
    user_id: user_id,
    course_id: course_id,
    session_id: session_id,
    question: question,
    questionAnswerIndex: questionAnswer,
    options: options2, // Save options directly as an array of objects
    media: mediaContents, // Save mediaContents as an array
    score: score,
    status: 1,
  };

  courseData.quiz.push(newQuiz);

  try {
    await updateDoc(courseDoc.ref, {
      quiz: courseData.quiz,
    });
    res.status(200).json({
      status: "ok",
      message: "Quiz created successfully",
      data: {
        content: courseData.quiz,
      },
    });
  } catch (error) {
    console.error(error);
    return next(new AppError("Failed to save course quiz", 500));
  }
});

module.exports.createExams = catchAsync(async (req, res, next) => {
  const {
    user_id,
    course_id,
    time,
    type,
    question,
    questionAnswer,
    score,
  } = req.body;

  if (!time || !question || !course_id || !questionAnswer || !type || !score) {
    return next(new AppError("All fields are required", 400));
  }
  let options2 = [];
  if (type === "Objective") {
    const { options } = req.body;
    options2 = JSON.parse(options);
    if (!Array.isArray(options2)) {
      console.log("Options is not an array:", options2);
      return next(new AppError("Options must be an array", 400));
    }
  }

  let correctAns = null;
  if (type === "FillInTheGap") {
    correctAns = JSON.parse(questionAnswer);
    if (!Array.isArray(correctAns)) {
      console.log("Answer is not an array:", correctAns);
      return next(new AppError("Answer must be an array", 400));
    }
  } else {
    correctAns = questionAnswer;
  }

  if (!user_id) {
    return next(new AppError("User ID is required", 400));
  }

  const querySnapshot = await checkIfCourseExistWithId(course_id);

  if (querySnapshot.empty) {
    return next(new AppError("Course does not exist", 404));
  }

  const courseDoc = querySnapshot.docs[0];
  const courseData = courseDoc.data();

  const quizExists = courseData.quiz.some((quiz) => quiz.question === question);

  if (quizExists) {
    return next(new AppError("Quiz already exists", 403));
  }

  const storage = getStorage();
  const mediaContents = [];

  if (req.files && req.files.length > 0) {
    for (const file of req.files) {
      const storageRef = ref(storage, `courses/${file.originalname}`);
      const uploadTask = uploadBytesResumable(storageRef, file.buffer);

      try {
        await new Promise((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            (snapshot) => {
              const progress =
                (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              console.log(`Upload is ${progress}% done`);
            },
            (error) => {
              console.error("Error uploading file:", error);
              reject(new AppError(error.message));
            },
            async () => {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

              let mediaType;
              if (file.mimetype.startsWith("image/")) {
                mediaType = "image";
              } else if (file.mimetype.startsWith("video/")) {
                mediaType = "video";
              } else if (file.mimetype === "application/pdf") {
                mediaType = "pdf";
              } else if (file.mimetype.includes("word")) {
                mediaType = "doc";
              } else {
                mediaType = "unknown";
              }

              mediaContents.push({
                image: downloadURL,
                thumbnail: downloadURL,
                type: mediaType,
                status: 1,
              });

              resolve();
            }
          );
        });
      } catch (error) {
        return next(new AppError("Failed to upload media content", 500));
      }
    }
  }

  // Assuming options are already structured correctly as an array of objects
  const newQuiz = {
    id: uuidv4(),
    user_id: user_id,
    course_id: course_id,
    question: question,
    questionAnswer: correctAns,
    options: options2, // Save options directly as an array of objects
    media: mediaContents, // Save mediaContents as an array
    score: score,
    time: time,
    type: type,
    status: 1,
  };

  courseData.exams.push(newQuiz);

  try {
    await updateDoc(courseDoc.ref, {
      exams: courseData.exams,
    });
    res.status(200).json({
      status: "ok",
      message: "Exam created successfully",
      data: {
        content: courseData.exams,
      },
    });
  } catch (error) {
    console.error(error);
    return next(new AppError("Failed to save course exam", 500));
  }
});

module.exports.createMultipleExams = catchAsync(async (req, res, next) => {
  const { user_id, course_id, exams } = req.body;

  if (
    !user_id ||
    !course_id ||
    !exams ||
    !Array.isArray(exams) ||
    exams.length === 0
  ) {
    return next(
      new AppError("User ID, course ID, and exams array are required", 400)
    );
  }

  const querySnapshot = await checkIfCourseExistWithId(course_id);

  if (querySnapshot.empty) {
    return next(new AppError("Course does not exist", 404));
  }

  const courseDoc = querySnapshot.docs[0];
  const courseData = courseDoc.data();

  const storage = getStorage();
  const newQuizzes = [];

  for (const exam of exams) {
    const { time, type, question, questionAnswer, score, options } = exam;

    if (!time || !question || !questionAnswer || !type || !score) {
      return next(new AppError("All fields are required for each exam", 400));
    }

    // Parse options for Objective questions (no need to JSON.parse() because it's already an array)
    let options2 = [];
    if (type === "Objective") {
      options2 = options; // options is already an array, no need to parse
      if (!Array.isArray(options2)) {
        return next(new AppError("Options must be an array", 400));
      }
    }

    // Parse correct answers for FillInTheGap questions
    let correctAns = null;
    if (type === "FillInTheGap") {
      correctAns = questionAnswer;
      // JSON.parse(correctAns);
      if (!Array.isArray(correctAns)) {
        return next(
          new AppError(
            "Answer must be an array for FillInTheGap questions",
            400
          )
        );
      }
    } else {
      correctAns = questionAnswer;
    }

    const quizExists = courseData.exams.some(
      (quiz) => quiz.question === question
    );
    if (quizExists) {
      return next(
        new AppError(`Quiz for question "${question}" already exists`, 403)
      );
    }

    // Handle media upload
    const mediaContents = [];
    if (
      req.files &&
      req.files[exam.question] &&
      req.files[exam.question].length > 0
    ) {
      for (const file of req.files[exam.question]) {
        const storageRef = ref(storage, `courses/${file.originalname}`);
        const uploadTask = uploadBytesResumable(storageRef, file.buffer);

        try {
          await new Promise((resolve, reject) => {
            uploadTask.on(
              "state_changed",
              (snapshot) => {
                const progress =
                  (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                console.log(`Upload is ${progress}% done`);
              },
              (error) => {
                console.error("Error uploading file:", error);
                reject(new AppError(error.message));
              },
              async () => {
                const downloadURL = await getDownloadURL(
                  uploadTask.snapshot.ref
                );

                let mediaType;
                if (file.mimetype.startsWith("image/")) {
                  mediaType = "image";
                } else if (file.mimetype.startsWith("video/")) {
                  mediaType = "video";
                } else if (file.mimetype === "application/pdf") {
                  mediaType = "pdf";
                } else if (file.mimetype.includes("word")) {
                  mediaType = "doc";
                } else {
                  mediaType = "unknown";
                }

                mediaContents.push({
                  image: downloadURL,
                  thumbnail: downloadURL,
                  type: mediaType,
                  status: 1,
                });

                resolve();
              }
            );
          });
        } catch (error) {
          return next(new AppError("Failed to upload media content", 500));
        }
      }
    }

    // Create new quiz object
    const newQuiz = {
      id: uuidv4(),
      user_id: user_id,
      course_id: course_id,
      question: question,
      questionAnswer: correctAns,
      options: options2, // Save options directly as an array of objects
      media: mediaContents, // Save mediaContents as an array
      score: score,
      time: time,
      type: type,
      status: 1,
    };

    newQuizzes.push(newQuiz);
  }

  // Add the new quizzes to the course data
  courseData.exams.push(...newQuizzes);

  // Update the course with new exams
  try {
    await updateDoc(courseDoc.ref, {
      exams: courseData.exams,
    });
    res.status(200).json({
      status: "ok",
      message: "Exams created successfully",
      data: {
        content: courseData.exams,
      },
    });
  } catch (error) {
    console.error(error);
    return next(new AppError("Failed to save course exams", 500));
  }
});

module.exports.getExams = catchAsync(async (req, res, next) => {
  let { course_id } = req.query;

  if (!course_id) {
    return next(new AppError("course id is required", 403));
  }

  const querySnapshot = await checkIfCourseExistWithId(course_id);
  if (querySnapshot.empty) {
    return next(new AppError("Course does not exists", 404));
  }
  const courseDoc = querySnapshot.docs[0];
  const courseData = courseDoc.data();

  if (courseData) {
    res.status(200).json({
      status: "ok",
      message: "Exams fetched successfully",
      data: courseData?.exams,
    });
  } else {
    res.status(200).json({
      status: "ok",
      message: "No Quiz Found",
      data: courseData?.exams,
    });
  }
});

module.exports.getExamsByType = catchAsync(async (req, res, next) => {
  let { course_id, type } = req.query;

  if (!course_id) {
    return next(new AppError("course id is required", 403));
  }
  if (!type) {
    return next(new AppError("type id is required", 403));
  }
  if (type !== "Theory" && type !== "Objective" && type !== "FillInTheGap") {
    return next(new AppError("type supplied is not found", 404));
  }

  const querySnapshot = await checkIfCourseExistWithId(course_id);
  if (querySnapshot.empty) {
    return next(new AppError("Course does not exists", 404));
  }
  const courseDoc = querySnapshot.docs[0];
  const courseData = courseDoc.data();
  const courseDataWithType = courseData.exams.find(
    (exam) => exam?.type === type
  );

  if (courseDataWithType) {
    res.status(200).json({
      status: "ok",
      message: "Exams fetched successfully",
      data: courseDataWithType,
    });
  } else {
    res.status(200).json({
      status: "ok",
      message: "No Exam Found",
      data: [],
    });
  }
});

module.exports.getQuiz = catchAsync(async (req, res, next) => {
  let { course_id } = req.query;

  if (!course_id) {
    return next(new AppError("course id is required", 403));
  }

  const querySnapshot = await checkIfCourseExistWithId(course_id);
  if (querySnapshot.empty) {
    return next(new AppError("Course does not exists", 404));
  }
  const courseDoc = querySnapshot.docs[0];
  const courseData = courseDoc.data();

  if (courseData) {
    res.status(200).json({
      status: "ok",
      message: "Quiz fetched successfully",
      data: courseData?.quiz,
    });
  } else {
    res.status(200).json({
      status: "ok",
      message: "No Quiz Found",
      data: courseData?.quiz,
    });
  }
});

module.exports.getAllPrograms = catchAsync(async (req, res, next) => {
  let { user_id } = req.query;

  if (!user_id) {
    return next(new AppError("user_id is required", 403));
  }

  const documents = await getProgramsFunction(next);
  console.log(documents, "documents");

  res.status(200).json({
    status: "ok",
    message: "Programs gotten successfully",
    data: documents,
  });
});

module.exports.UploadVideo = catchAsync(async (req, res, next) => {
  const file = req.file;
  const { module_name, subscriptionRequired } = req.body;

  // ffmpeg.ffprobe(file.originalname, (err, metadata) => {
  //   if (err) {
  //     console.log(err.message);
  //     return next(new AppError(`${err.message}`, 402));
  //   }
  //   const durationInSeconds = metadata.format.duration;
  //   console.log(`Movie duration is ${durationInSeconds}`);
  // });

  const encryptedFile = await encryptVideo(file.buffer, key, iv);

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
  const snapshot = await uploadBytesResumable(
    storageRef,
    encryptedFile,
    metadata
  );
  // Grab the public url
  const downloadURL = await getDownloadURL(snapshot.ref);

  const createLessons = await Modules({
    module_name,
    firebase_id: downloadURL,
    // duration: durationInSeconds,
    subscriptionRequired,
  });
  await createLessons.save();

  res.status(200).json({
    success: true,
    message: "Course module succesfully uploaded",

    createLessons,
  });
});

module.exports.CreateCourses = catchAsync(async (req, res, next) => {
  const { title, creator, thumbnail, description, price, lessons } = req.body;
  const findCourseByName = await Courses.findOne({ title });
  if (findCourseByName) {
    return next(new AppError("Course with this name already exist", 403));
  }

  const createCourse = await Courses({
    title,
    creator,
    thumbnail,
    description,
    price,
    lessons,
  });
  await createCourse.save();

  res.status(200).json({
    success: true,
    message: "Course created succesfully",
    createCourse,
  });
});

module.exports.createProgramCourse = catchAsync(async (req, res, next) => {
  let {
    user_id,
    program_id,
    title,
    description,
    creator,
    package,
    price,
    cancelPrice,
    level,
  } = req.body;

  if (!user_id) {
    return next(new AppError("userid is required", 403));
  }

  if (!price || !title || !level) {
    return next(new AppError("All fields are required", 403));
  }

  if (!req.file) {
    console.log("no file");
    return next(new AppError("Error: No image uploaded", 400));
  }

  const firestore = getFirestore();
  const storage = getStorage();
  const imageBuffer = req.file.buffer;

  const storageRef = ref(storage, `courses/${req.file.originalname}`);

  // Upload file to Firebase Storage
  const uploadTask = uploadBytesResumable(storageRef, imageBuffer);

  uploadTask.on(
    "state_changed",
    (snapshot) => {
      const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
      console.log("Upload is " + progress + "% done");
    },
    (error) => {
      console.error("Error uploading image:", error);
      return next(new AppError(error.message));
    },
    async () => {
      const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
      console.log("Image uploaded successfully! Download URL:", downloadURL);

      const courseRef = doc(collection(firestore, "courses"));
      const courseData = {
        price: price,
        dateCreated: new Date().toUTCString(),
        date: new Date().toUTCString(),
        thumbnail: downloadURL,
        title: title,
        cancelPrice: cancelPrice,
        creator: creator,
        description: description,
        image: downloadURL,
        package: package,
        instructorId: user_id,
        instructor: user_id,
        id: courseRef.id,
        programId: program_id,
        level: level,
        assignment: [],
        quiz: [],
        lesson: [],
        exams: [],
        faq: [],
        status: 1,
      };

      // Save course data to Firestore
      await setDoc(courseRef, courseData).catch((error) => {
        console.error(error);
        return next(new AppError("Failed to upload course"));
      });

      // Return the created course in the response
      res.status(200).json({
        status: "ok",
        message: "Course Uploaded Successfully",
        data: courseData, // Returning the created course
      });
    }
  );
});

module.exports.deleteCourse = catchAsync(async (req, res, next) => {
  const { course_id } = req.params;

  if (!course_id) {
    return next(new AppError("Course ID is required", 403));
  }

  const firestore = getFirestore();

  const courseRef = doc(collection(firestore, "courses"), course_id);
  const courseSnapshot = await getDoc(courseRef);

  if (!courseSnapshot.exists()) {
    return next(new AppError("Course not found", 404));
  }

  await updateDoc(courseRef, {
    status: 0,
    dateDeleted: new Date().toUTCString(),
  }).catch((error) => {
    console.error("Failed to delete course:", error);
    return next(new AppError("Failed to delete course"));
  });

  res.status(200).json({
    status: "ok",
    message: "Course deleted successfully",
  });
});


module.exports.getAllProgramsCourses = catchAsync(async (req, res, next) => {
  let { user_id, program_id } = req.query;

  if (!user_id) {
    return next(new AppError("user id is required", 403));
  }
  if (!program_id) {
    return next(new AppError("program id is required", 403));
  }

  const documents = await getProgramsCourseFunction(program_id, next, res);
  console.log(documents, "documents");

  res.status(200).json({
    status: "ok",
    message: "Courses gotten successfully",
    data: documents,
  });
});

module.exports.getAllCoursesViaLevel = catchAsync(async (req, res, next) => {
  let { user_id, level } = req.query;

  if (!user_id) {
    return next(new AppError("user id is required", 403));
  }
  if (!level) {
    return next(new AppError("level is required", 403));
  }

  const documents = await getProgramsCourseViaLevelFunction(level, next, res);
  console.log(documents, "documents");

  res.status(200).json({
    status: "ok",
    message: "Courses gotten successfully",
    data: documents,
  });
});

module.exports.getCoursesLessons = catchAsync(async (req, res, next) => {
  let { user_id, course_id } = req.query;

  if (!user_id) {
    return next(new AppError("user id is required", 403));
  }
  if (!course_id) {
    return next(new AppError("program id is required", 403));
  }

  const documents = await getProgramsCourseLessonsFunction(course_id, next);

  res.status(200).json({
    status: "ok",
    message: "Lesson fetched successfully",
    data: documents,
  });
});

module.exports.getAllCourses = catchAsync(async (req, res, next) => {
  let { user_id } = req.query;

  if (!user_id) {
    return next(new AppError("user id is required", 403));
  }

  const documents = await getCourseFunction(next);
  console.log(documents, "documents");

  if (documents) {
    res.status(200).json({
      status: "ok",
      message: "Courses gotten successfully",
      data: documents,
    });
  } else {
    res.status(200).json({
      status: "ok",
      message: "No Course Found",
      data: documents,
    });
  }
});

module.exports.GetCourseDetails = catchAsync(async (req, res, next) => {
  const courseId = req.params.courseId;

  // console.log(findCourseById)

  const findCourseById = await Courses.findById(courseId);

  if (!findCourseById) {
    return next(
      new AppError("This course does not exist. Please check course ID", 403)
    );
  }

  const innerCourseId = await findCourseById.populate({
    path: "lessons",
    populate: {
      path: "modules",
    },
  });

  res.status(200).json({
    status: "ok",
    success: true,
    message: "Course details fetched succesfully",
    courseDetails: innerCourseId,
    // videoToPlay,
  });
});

module.exports.GetAllCourses = catchAsync(async (req, res, next) => {
  const AllCourses = await Courses.find();
  res.status(202).json({
    status: "ok",
    success: true,
    message: "All Courses fetched succesfully",
    AllCourses,
  });
});

module.exports.SearchCourse = catchAsync(async (req, res, next) => {
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

module.exports.PlayDecryptVideo = catchAsync(async (req, res, next) => {
  const { url } = req.body;
  // Make a request to Firebase storage
  try {
    const feedback = await axios.get(url, {
      responseType: "arraybuffer", // Set the responseType to 'arraybuffer' for binary data
    });

    const decryptedVideo = await decryptVideo(feedback.data, key, iv);
    // console.log(decryptedVideo);
    res.status(202).json({
      status: "ok",
      success: true,
      message: "Video fetched succesfully from Firebase storage",
      video: decryptedVideo,
    });
  } catch (error) {
    throw new Error(error);
  }
  //console.log the decrypted file
});

module.exports.searchCourses = catchAsync(async (req, res, next) => {
  const { title, description, instructor, course_id, status } = req.query;

  // Initialize Firestore reference
  const firestore = getFirestore();
  const coursesRef = collection(firestore, "courses");

  // Build Firestore query dynamically based on available search params
  let q = coursesRef;

  // Add filters based on provided query parameters
  if (title) {
    q = query(
      q,
      where("title", ">=", title),
      where("title", "<=", title + "\uf8ff")
    );
  }

  if (description) {
    q = query(
      q,
      where("description", ">=", description),
      where("description", "<=", description + "\uf8ff")
    );
  }

  if (instructor) {
    q = query(q, where("instructor", "==", instructor));
  }

  if (course_id) {
    q = query(q, where("id", "==", course_id));
  }

  if (status) {
    q = query(q, where("status", "==", parseInt(status)));
  }

  try {
    // Execute query
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return res.status(404).json({
        status: "fail",
        message: "No courses found based on your search.",
      });
    }

    // Collect search results
    const searchResults = [];
    querySnapshot.forEach((doc) => {
      searchResults.push(doc.data());
    });

    res.status(200).json({
      status: "ok",
      message: "Search results retrieved successfully",
      data: searchResults,
    });
  } catch (error) {
    console.error("Error fetching search results:", error);
    return next(new AppError("Error fetching search results.", 500));
  }
});

module.exports.enrollCourse = catchAsync(async (req, res, next) => {
  const { student_id, course_id } = req.body;

  // Validate inputs
  if (!student_id || !course_id) {
    return next(new AppError("Student ID and Course ID are required", 400));
  }

  const firestore = getFirestore();

  // Check if the course exists
  const courseRef = doc(firestore, "courses", course_id);
  const courseSnapshot = await getDoc(courseRef);

  if (!courseSnapshot.exists()) {
    return next(new AppError("Course does not exist", 404));
  }

  // Get the course data correctly
  const course_data = courseSnapshot.data();

  // Check if student is already enrolled
  const enrollmentRef = collection(firestore, "enrollments");
  const enrollmentQuery = query(
    enrollmentRef,
    where("student_id", "==", student_id),
    where("course_id", "==", course_id)
  );
  const enrollmentSnapshot = await getDocs(enrollmentQuery);
  if (!enrollmentSnapshot.empty) {
    return next(new AppError("Student is already enrolled for this course", 400));
  }

  // Fetch total lessons, quizzes, and assignments
  const { lesson = [], quiz = [], assignment = [] } = course_data;

  // Enroll the student
  const newEnrollmentRef = doc(collection(firestore, "enrollments"));
  await setDoc(newEnrollmentRef, {
    student_id,
    course_id,
    program_id: course_data?.programId, // Access programId from course_data
    enrollment_date: new Date().toISOString(),
    status: "active",
    progress: {
      lessons_completed: 0,
      quizzes_completed: 0,
      assignments_completed: 0,
      total_lessons: lesson.length,
      total_quizzes: quiz.length,
      total_assignments: assignment.length,
      percentage: 0,
    },
  });

  res.status(201).json({
    status: "success",
    message: "Student enrolled successfully",
  });
});


module.exports.getEnrolledCoursesOld = catchAsync(async (req, res, next) => {
  const { student_id } = req.query;
  const firestore = getFirestore();

  if (!student_id) {
    return next(new AppError("Student ID is required", 400));
  }

  const enrollmentRef = collection(firestore, "enrollments");
  const enrollmentQuery = query(
    enrollmentRef,
    where("student_id", "==", student_id),
    where("status", "==", "active")
  );
  const enrollmentSnapshot = await getDocs(enrollmentQuery);

  const enrolledCourses = [];
  enrollmentSnapshot.forEach((doc) =>
    enrolledCourses.push(doc.data().course_id)
  );

  // Fetch course details
  const courses = [];
  for (const course_id of enrolledCourses) {
    const courseRef = doc(firestore, "courses", course_id);
    const courseSnapshot = await getDoc(courseRef);
    if (courseSnapshot.exists()) {
      courses.push(courseSnapshot.data());
    }
  }

  res.status(200).json({
    status: "success",
    data: courses,
  });
});

module.exports.getEnrolledCourses = catchAsync(async (req, res, next) => {
  const { student_id } = req.params;

  // Validate student_id
  if (!student_id) {
    return next(new AppError("Student ID is required", 400));
  }

  const firestore = getFirestore();
  const enrollmentRef = collection(firestore, "enrollments");

  // Query to get all courses for the given student_id
  const q = query(enrollmentRef, where("student_id", "==", student_id));
  const querySnapshot = await getDocs(q);

  // Check if no courses are found
  if (querySnapshot.empty) {
    return next(
      new AppError("No enrolled courses found for the given student", 404)
    );
  }

  const enrolledCourses = [];
  querySnapshot.forEach((doc) => {
    enrolledCourses.push(doc.data());
  });

  // Return the enrolled courses
  res.status(200).json({
    status: "success",
    data: {
      enrolledCourses,
    },
  });
});

module.exports.getEnrolledCoursesByStudentId = catchAsync(
  async (req, res, next) => {
    let { student_id } = req.query;

    // Validate student_id
    if (!student_id) {
      return next(new AppError("Student ID is required", 400));
    }

    const firestore = getFirestore();
    const enrollmentRef = collection(firestore, "enrollments");

    // Query to get all courses for the given student_id
    const q = query(enrollmentRef, where("student_id", "==", student_id));
    const querySnapshot = await getDocs(q);

    // Check if no courses are found
    if (querySnapshot.empty) {
      return next(
        new AppError("No enrolled courses found for the given student", 404)
      );
    }

    const enrolledCourses = [];
    querySnapshot.forEach((doc) => {
      enrolledCourses.push(doc.data());
    });

    // Return the enrolled courses
    res.status(200).json({
      status: "success",
      data: {
        enrolledCourses,
      },
    });
  }
);

module.exports.getEnrolledStudentsByCourseId = catchAsync(
  async (req, res, next) => {
    const { course_id } = req.query;

    // Validate course_id
    if (!course_id) {
      return next(new AppError("Course ID is required", 400));
    }

    const firestore = getFirestore();
    const enrollmentRef = collection(firestore, "enrollments");

    // Query to get all students enrolled in the given course_id
    const q = query(enrollmentRef, where("course_id", "==", course_id));
    const querySnapshot = await getDocs(q);

    // Check if no students are found
    if (querySnapshot.empty) {
      return next(
        new AppError("No students found enrolled in this course", 404)
      );
    }

    const enrolledStudents = [];
    querySnapshot.forEach((doc) => {
      enrolledStudents.push(doc.data());
    });

    // Return the enrolled students
    res.status(200).json({
      status: "success",
      data: {
        enrolledStudents,
      },
    });
  }
);

module.exports.updateCourseProgress = catchAsync(async (req, res, next) => {
  const {
    student_id,
    course_id,
    lessons_completed,
    quizzes_completed,
    assignments_completed,
  } = req.body;

  const firestore = getFirestore();
  // Validate inputs
  if (!student_id || !course_id) {
    return next(new AppError("Student ID and Course ID are required", 400));
  }

  // Get enrollment record
  const enrollmentRef = collection(firestore, "enrollments");
  const enrollmentQuery = query(
    enrollmentRef,
    where("student_id", "==", student_id),
    where("course_id", "==", course_id)
  );
  const enrollmentSnapshot = await getDocs(enrollmentQuery);
  if (enrollmentSnapshot.empty) {
    return next(new AppError("Enrollment record not found", 404));
  }

  const enrollmentDoc = enrollmentSnapshot.docs[0];
  const enrollmentData = enrollmentDoc.data();

  // Update progress
  const updatedProgress = {
    lessons_completed:
      lessons_completed || enrollmentData.progress.lessons_completed,
    quizzes_completed:
      quizzes_completed || enrollmentData.progress.quizzes_completed,
    assignments_completed:
      assignments_completed || enrollmentData.progress.assignments_completed,
    total_lessons: enrollmentData.progress.total_lessons,
    total_quizzes: enrollmentData.progress.total_quizzes,
    total_assignments: enrollmentData.progress.total_assignments,
  };

  // Calculate percentage
  const totalTasks =
    updatedProgress.total_lessons +
    updatedProgress.total_quizzes +
    updatedProgress.total_assignments;
  const completedTasks =
    updatedProgress.lessons_completed +
    updatedProgress.quizzes_completed +
    updatedProgress.assignments_completed;
  updatedProgress.percentage = Math.round((completedTasks / totalTasks) * 100);

  // Mark course as completed if 100% progress
  const status = updatedProgress.percentage === 100 ? "completed" : "active";

  await updateDoc(enrollmentDoc.ref, {
    progress: updatedProgress,
    status: status,
    dateUpdated: new Date().toISOString(),
  });

  res.status(200).json({
    status: "success",
    message: "Progress updated successfully",
    data: updatedProgress,
  });
});

module.exports.getEnrolledCoursesWithProgress = catchAsync(
  async (req, res, next) => {
    const { student_id } = req.query;
    const firestore = getFirestore();
    if (!student_id) {
      return next(new AppError("Student ID is required", 400));
    }

    const enrollmentRef = collection(firestore, "enrollments");
    const enrollmentQuery = query(
      enrollmentRef,
      where("student_id", "==", student_id)
    );
    const enrollmentSnapshot = await getDocs(enrollmentQuery);

    const enrolledCourses = [];
    enrollmentSnapshot.forEach((doc) => enrolledCourses.push(doc.data()));

    // Fetch course details with progress
    const courses = [];
    for (const enrollment of enrolledCourses) {
      const courseRef = doc(firestore, "courses", enrollment.course_id);
      const courseSnapshot = await getDoc(courseRef);
      if (courseSnapshot.exists()) {
        courses.push({
          ...courseSnapshot.data(),
          progress: enrollment.progress,
          enrollment_status: enrollment.status,
        });
      }
    }

    res.status(200).json({
      status: "success",
      data: courses,
    });
  }
);
