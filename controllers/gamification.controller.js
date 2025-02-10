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
  orderBy,
  where,
  limit,
  startAfter,
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

// Helper function to check if the game question already exists
async function checkIfGameExist(question) {
  const firestore = getFirestore();
  const programsRef = collection(firestore, "gamification");
  const q = query(programsRef, where("question", "==", question));
  const querySnapshot = await getDocs(q);

  // If the querySnapshot is empty, it means the question does not exist
  return !querySnapshot.empty;
}
async function getAllActiveGames(next, status) {
  try {
    const firestore = getFirestore();
    const gamesRef = collection(firestore, "gamification");

    // Query to get all games with status 1
    const q = query(gamesRef, where("status", "==", status));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return next(new AppError("No active games found.", 404));
    }

    // Collect all active games
    const activeGames = [];
    querySnapshot.forEach((doc) => {
      activeGames.push(doc.data());
    });

    return activeGames;
  } catch (error) {
    console.error("Error fetching active games:", error);
    return next(new AppError("Error fetching active games.", 500));
  }
}

async function getGamesByProgramId(program_id, next) {
  try {
    const firestore = getFirestore();
    const gamesRef = collection(firestore, "gamification");

    // Query to get all games with a specific program_id
    const q = query(gamesRef, where("program_id", "==", program_id));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return next(
        new AppError("No games found for the given program ID.", 404)
      );
    }

    // Collect all games with the specified program_id
    const games = [];
    querySnapshot.forEach((doc) => {
      games.push(doc.data());
    });

    return games;
  } catch (error) {
    console.error("Error fetching games by program ID:", error);
    return next(new AppError("Error fetching games by program ID.", 500));
  }
}

async function getPaginatedGames(
  next,
  pageSize,
  lastVisible = null,
  program_id = null
) {
  try {
    const firestore = getFirestore();
    const gamesRef = collection(firestore, "gamification");

    // Query to get games with status 1, and optionally filter by program_id
    let q;
    if (program_id) {
      q = query(
        gamesRef,
        where("status", "==", 1),
        where("program_id", "==", program_id),
        limit(pageSize)
      );
    } else {
      q = query(gamesRef, where("status", "==", 1), limit(pageSize));
    }

    if (lastVisible) {
      // Start the next page after the last visible document
      const lastDocRef = doc(gamesRef, lastVisible);
      const lastDocSnapshot = await getDoc(lastDocRef);
      q = query(q, startAfter(lastDocSnapshot));
    }

    const querySnapshot = await getDocs(q);

    // If no documents are found, return false
    if (querySnapshot.empty) {
      return null;
    }

    return querySnapshot;
  } catch (error) {
    console.error("Error fetching paginated games:", error);
    return next(new AppError("Error fetching paginated games.", 500));
  }
}

async function groupGamesByCourseId(querySnapshot, next) {
  try {
    const firestore = getFirestore();

    // Initialize an empty object to store grouped data
    const groupedData = {};

    // Process each game in the snapshot
    for (const doc of querySnapshot.docs) {
      const gameData = doc.data();
      const courseId = gameData.course_id;

      // Fetch the course name using course_id
      const courseRef = doc(firestore, "courses", courseId);
      const courseSnapshot = await getDoc(courseRef);
      const courseName = courseSnapshot.exists()
        ? courseSnapshot.data().title
        : "Unknown Course";

      // If the course_id is not already in the groupedData, initialize it
      if (!groupedData[courseId]) {
        groupedData[courseId] = {
          courseName: courseName,
          totalScore: 0,
          games: [],
        };
      }

      // Add the current game to the appropriate group
      groupedData[courseId].games.push(gameData);

      // Accumulate the total score for the group
      groupedData[courseId].totalScore += parseInt(gameData.score);
    }

    return groupedData;
  } catch (error) {
    console.error("Error grouping games by course_id:", error);
    return next(new AppError("Error grouping games by course_id.", 500));
  }
}

async function getPaginatedGamesAll(next, pageSize, lastVisible = null) {
  try {
    const firestore = getFirestore();
    const gamesRef = collection(firestore, "gamification");

    // Base query to get games with status 1
    let q = query(gamesRef, where("status", "==", 1), limit(pageSize));

    if (lastVisible) {
      // Check if the lastVisible document exists
      const lastDocRef = doc(gamesRef, lastVisible);
      const lastDocSnapshot = await getDoc(lastDocRef);

      if (lastDocSnapshot.exists()) {
        // If the document exists, use startAfter() for pagination
        q = query(
          gamesRef,
          where("status", "==", 1),
          startAfter(lastDocSnapshot),
          limit(pageSize)
        );
      } else {
        // If the lastVisible document doesn't exist, log the error and return an empty array
        console.error(`Document with id ${lastVisible} not found`);
        return [];
      }
    }

    const querySnapshot = await getDocs(q);

    // If no documents are found, return an empty array
    if (querySnapshot.empty) {
      return [];
    }

    return querySnapshot;
  } catch (error) {
    console.error("Error fetching paginated games:", error);
    return next(new AppError("Error fetching paginated games.", 500));
  }
}

async function groupGamesByCourseIdAll(querySnapshot, next) {
  try {
    const firestore = getFirestore();

    // Initialize an empty object to store grouped data
    const groupedData = {};

    // Process each game in the snapshot
    for (const doc of querySnapshot.docs) {
      const gameData = doc.data();
      const courseId = gameData.course_id;

      // Fetch the course name using course_id
      const courseRef = doc(firestore, "courses", courseId);
      const courseSnapshot = await getDoc(courseRef);
      const courseName = courseSnapshot.exists()
        ? courseSnapshot.data().title
        : "Unknown Course";

      // If the course_id is not already in the groupedData, initialize it
      if (!groupedData[courseId]) {
        groupedData[courseId] = {
          courseName: courseName,
          totalScore: 0,
          games: [],
        };
      }

      // Add the current game to the appropriate group
      groupedData[courseId].games.push(gameData);

      // Accumulate the total score for the group
      groupedData[courseId].totalScore += parseInt(gameData.score);
    }

    return groupedData;
  } catch (error) {
    console.error("Error grouping games by course_id:", error);
    return next(new AppError("Error grouping games by course_id.", 500));
  }
}

module.exports.createGamificationNewMultipleQst = catchAsync(
  async (req, res, next) => {
    const { questions } = req.body;
    // const questions = JSON.parse(req.body.questions);
    const mediaContents = [];
    console.log({ questions });

    // Process each question
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      // const mediaField = `media_${i}`; // Access media files for this question

      const mediaForQuestion = [];

      // if (req.files && req.files[mediaField]) {
      //   const storage = getStorage();

      //   try {
      //     for (const file of req.files[mediaField]) {
      //       const storageRef = ref(storage, `courses/${file.originalname}`);
      //       const uploadTask = uploadBytesResumable(storageRef, file.buffer);

      //       await new Promise((resolve, reject) => {
      //         uploadTask.on(
      //           "state_changed",
      //           (snapshot) => {
      //             const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
      //             console.log(`Upload is ${progress}% done`);
      //           },
      //           (error) => {
      //             reject(new AppError(error.message));
      //           },
      //           async () => {
      //             const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

      //             let mediaType;
      //             if (file.mimetype.startsWith("image/")) {
      //               mediaType = "image";
      //             } else if (file.mimetype.startsWith("video/")) {
      //               mediaType = "video";
      //             } else if (file.mimetype === "application/pdf") {
      //               mediaType = "pdf";
      //             } else if (file.mimetype.includes("word")) {
      //               mediaType = "doc";
      //             } else {
      //               mediaType = "unknown";
      //             }

      //             mediaForQuestion.push({
      //               image: downloadURL,
      //               thumbnail: downloadURL,
      //               type: mediaType,
      //               status: 1,
      //             });

      //             resolve();
      //           }
      //         );
      //       });
      //     }
      //   } catch (error) {
      //     return next(new AppError("Failed to upload media content", 500));
      //   }
      // }

      // Save each question along with its media
      const firestore = getFirestore();
      const questionRef = doc(collection(firestore, "gamification"));
      await setDoc(questionRef, {
        id: questionRef.id,
        ...question,
        options: question.options,
        media: mediaForQuestion,
        dateCreated: new Date().toUTCString(),
        dateModify: new Date().toUTCString(),
        status: 1,
      });
    }

    res.status(200).json({
      status: "ok",
      message: "Questions created successfully",
    });
  }
);

module.exports.editGamificationQst = catchAsync(async (req, res, next) => {
  const {
    user_id,
    gamification_id,
    question,
    questionAnswer,
    options,
    score,
  } = req.body;

  // Validate required fields
  if (!user_id || !gamification_id || !question || !questionAnswer || !options || !score) {
    return next(new AppError("All fields are required", 400));
  }

  // Parse options and validate it's an array
  let parsedOptions;
  try {
    parsedOptions = JSON.parse(options);
    if (!Array.isArray(parsedOptions)) {
      throw new Error("Options must be an array");
    }
  } catch (err) {
    return next(new AppError("Options must be a valid JSON array", 400));
  }

  const id = gamification_id.trim(); // Ensure no extra spaces
  console.log(`Gamification ID: ${id}`); // Debug log

  // Initialize Firestore and query the gamification collection
  const firestore = getFirestore();
  if (!firestore) {
    return next(new AppError("Failed to initialize Firestore", 500));
  }

  const gamesRef = collection(firestore, "gamification"); // Reference the "gamification" collection
  const questionRef = query(gamesRef, where("id", "==", id)); // Query the document using the gamification_id
  const questionSnapshot = await getDocs(questionRef);

  // Check if any documents are returned
  if (questionSnapshot.empty) {
    console.log("Gamification question not found:", id); // Debug log
    return next(new AppError("Gamification question not found", 404));
  }

  let questionDoc;
  questionSnapshot.forEach((doc) => {
    questionDoc = doc;
  });

  // Update media if any
  const mediaContents = [];
  if (req.files && req.files.length > 0) {
    const storage = getStorage();
    try {
      for (const file of req.files) {
        const storageRef = ref(storage, `courses/${file.originalname}`);
        const uploadTask = uploadBytesResumable(storageRef, file.buffer);

        await new Promise((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              console.log(`Upload is ${progress}% done`);
            },
            (error) => {
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
      }
    } catch (error) {
      return next(new AppError("Failed to upload media content", 500));
    }
  }

  // Update the gamification question
  try {
    await updateDoc(questionDoc.ref, {
      question,
      questionAnswerIndex: questionAnswer,
      options: parsedOptions,
      media: mediaContents.length ? mediaContents : questionDoc.data().media, // Only update media if new ones are uploaded
      score,
      dateModify: new Date().toUTCString(),
    });

    res.status(200).json({
      status: "ok",
      message: "Gamification question updated successfully",
    });
  } catch (error) {
    return next(new AppError("Failed to update gamification question", 500));
  }
});



module.exports.toggleGamificationStatus = catchAsync(async (req, res, next) => {
  const { gamification_id, status } = req.body;

  // Validate required fields
  if (!gamification_id || !status) {
    return next(new AppError("Gamification ID and status are required", 400));
  }

  // Validate status (either 'activate' or 'deactivate')
  const validStatuses = ["activate", "deactivate"];
  if (!validStatuses.includes(status)) {
    return next(new AppError("Invalid status value", 400));
  }

  // Set new status based on request
  const newStatus = status === "activate" ? 1 : 0;

  const firestore = getFirestore();
  const gamesRef = collection(firestore, "gamification");

  try {
    // Query to find the specific gamification question
    const questionRef = query(gamesRef, where("id", "==", gamification_id));
    const questionSnapshot = await getDocs(questionRef);

    // If the gamification question does not exist
    if (questionSnapshot.empty) {
      return next(new AppError("Gamification question not found.", 404));
    }

    // Assuming only one document is returned based on the unique `id` field
    const questionDoc = questionSnapshot.docs[0].ref;

    // Update the status and modify date
    await updateDoc(questionDoc, {
      status: newStatus,
      dateModify: new Date().toUTCString(),
    });

    res.status(200).json({
      status: "ok",
      message: `Gamification question ${status}d successfully`,
    });
  } catch (error) {
    console.error("Error updating gamification status:", error);
    return next(new AppError("Failed to update gamification status", 500));
  }
});

module.exports.createGamificationQst = catchAsync(async (req, res, next) => {
  const {
    user_id,
    program_id,
    course_id,
    session_id,
    question,
    questionAnswer,
    options,
    score,
  } = req.body;

  // Validate required fields
  if (
    !user_id ||
    !program_id ||
    !course_id ||
    !session_id ||
    !question ||
    !questionAnswer ||
    !options ||
    !score
  ) {
    return next(new AppError("All fields are required", 400));
  }

  // Parse options and validate it's an array
  let parsedOptions;
  try {
    parsedOptions = JSON.parse(options);
    if (!Array.isArray(parsedOptions)) {
      throw new Error("Options must be an array");
    }
  } catch (err) {
    return next(new AppError("Options must be a valid JSON array", 400));
  }

  // Check if the game question already exists
  const gameExists = await checkIfGameExist(question);
  if (gameExists) {
    return next(new AppError("Game question already exists", 409)); // 409 Conflict is more appropriate for an existing resource
  }

  // Upload media files if any
  const mediaContents = [];
  if (req.files && req.files.length > 0) {
    const storage = getStorage();

    try {
      for (const file of req.files) {
        const storageRef = ref(storage, `courses/${file.originalname}`);
        const uploadTask = uploadBytesResumable(storageRef, file.buffer);

        await new Promise((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            (snapshot) => {
              const progress =
                (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              console.log(`Upload is ${progress}% done`);
            },
            (error) => {
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
      }
    } catch (error) {
      return next(new AppError("Failed to upload media content", 500));
    }
  }

  // Create the gamification question
  try {
    const firestore = getFirestore();
    const userRef = doc(collection(firestore, "gamification"));
    await setDoc(userRef, {
      id: userRef.id,
      user_id,
      program_id,
      course_id,
      session_id,
      question,
      questionAnswerIndex: questionAnswer,
      options: parsedOptions,
      media: mediaContents,
      score,
      dateCreated: new Date().toUTCString(),
      dateModify: new Date().toUTCString(),
      status: 1,
    });

    res.status(200).json({
      status: "ok",
      message: "Question created successfully",
    });
  } catch (error) {
    return next(new AppError("Failed to save course quiz", 500));
  }
});

module.exports.createMultipleGamificationQst = catchAsync(
  async (req, res, next) => {
    const { questions } = req.body;

    // Validate that questions is an array
    JSON.parse(questions);
    if (!Array.isArray(questions) || questions.length === 0) {
      return next(
        new AppError("Questions must be an array with at least one item", 400)
      );
    }

    // Array to store any errors encountered during the process
    const errors = [];

    // Process each question
    for (const questionObj of questions) {
      const {
        user_id,
        program_id,
        course_id,
        session_id,
        question,
        questionAnswer,
        options,
        score,
      } = questionObj;

      // Validate required fields for each question
      if (
        !user_id ||
        !program_id ||
        !course_id ||
        !session_id ||
        !question ||
        !questionAnswer ||
        !options ||
        !score
      ) {
        errors.push(`Missing required fields for question: ${question}`);
        continue; // Skip to the next question
      }

      // Parse options and validate it's an array
      let parsedOptions;
      try {
        parsedOptions = JSON.parse(options);
        if (!Array.isArray(parsedOptions)) {
          throw new Error("Options must be an array");
        }
      } catch (err) {
        errors.push(
          `Invalid options for question: ${question}. Must be a valid JSON array.`
        );
        continue; // Skip to the next question
      }

      // Check if the game question already exists
      const gameExists = await checkIfGameExist(question);
      if (gameExists) {
        errors.push(`Game question already exists: ${question}`);
        continue; // Skip to the next question
      }

      // Upload media files if any (for individual question)
      const mediaContents = [];
      if (req.files && req.files.length > 0) {
        const storage = getStorage();

        try {
          for (const file of req.files) {
            const storageRef = ref(storage, `courses/${file.originalname}`);
            const uploadTask = uploadBytesResumable(storageRef, file.buffer);

            await new Promise((resolve, reject) => {
              uploadTask.on(
                "state_changed",
                (snapshot) => {
                  const progress =
                    (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                  console.log(`Upload is ${progress}% done`);
                },
                (error) => {
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
          }
        } catch (error) {
          errors.push(
            `Failed to upload media content for question: ${question}`
          );
          continue; // Skip to the next question
        }
      }

      // Create the gamification question in Firestore
      try {
        const firestore = getFirestore();
        const userRef = doc(collection(firestore, "gamification"));
        await setDoc(userRef, {
          id: userRef.id,
          user_id,
          program_id,
          course_id,
          session_id,
          question,
          questionAnswerIndex: questionAnswer,
          options: parsedOptions,
          media: mediaContents,
          score,
          dateCreated: new Date().toUTCString(),
          dateModify: new Date().toUTCString(),
          status: 1,
        });
      } catch (error) {
        errors.push(`Failed to save quiz for question: ${question}`);
        continue; // Skip to the next question
      }
    }

    // If there were any errors, return them
    if (errors.length > 0) {
      return res.status(400).json({
        status: "error",
        message: "Some questions failed to process",
        errors,
      });
    }

    // If all questions were successfully processed
    res.status(200).json({
      status: "ok",
      message: "All questions created successfully",
    });
  }
);

module.exports.GetAllActiveGames = catchAsync(async (req, res, next) => {
  const querySnapshot = await getAllActiveGames(next, 1);
  if (querySnapshot.empty) {
    return next(new AppError("No active Gamification", 404));
  }
  res.status(200).json({
    status: "ok",
    message: "Game questions gotten successfully",
    data: querySnapshot,
  });
});
module.exports.GetAllNonActiveGames = catchAsync(async (req, res, next) => {
  const querySnapshot = await getAllActiveGames(next, 0);
  if (querySnapshot.empty) {
    return next(new AppError("No data found", 404));
  }
  res.status(200).json({
    status: "ok",
    message: "Non active questions gotten successfully",
    data: querySnapshot,
  });
});

module.exports.GetGamesByProgramId = catchAsync(async (req, res, next) => {
  let { program_id } = req.query;

  if (!program_id) {
    return next(new AppError("program ID is required", 403));
  }
  const querySnapshot = await getGamesByProgramId(program_id, next);
  if (querySnapshot.empty) {
    return next(new AppError("Course does not exists", 404));
  }
  res.status(200).json({
    status: "ok",
    message: "Game questions gotten successfully",
    data: querySnapshot,
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

module.exports.GetSinglePaginatedGames = catchAsync(async (req, res, next) => {
  const { pageSize = 10, lastVisible, program_id } = req.query;

  const querySnapshot = await getPaginatedGames(
    next,
    parseInt(pageSize),
    lastVisible,
    program_id
  );

  if (!querySnapshot) {
    return next(new AppError("No games found.", 404));
  }

  const groupedGames = await groupGamesByCourseId(querySnapshot, next);
  res.status(200).json({
    status: "ok",
    message: "Game questions fetched successfully",
    data: groupedGames,
  });
});

module.exports.searchGamification = catchAsync(async (req, res, next) => {
  const { question, course_id, session_id, status } = req.query;

  // Initialize Firestore reference
  const firestore = getFirestore();
  const gamificationRef = collection(firestore, "gamification");

  // Build Firestore query dynamically based on available search params
  let q = gamificationRef;

  // Add filters based on provided query parameters
  if (question) {
    q = query(
      q,
      where("question", ">=", question),
      where("question", "<=", question + "\uf8ff")
    );
  }

  if (course_id) {
    q = query(q, where("course_id", "==", course_id));
  }

  if (session_id) {
    q = query(q, where("session_id", "==", session_id));
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
        message: "No gamification content found based on your search.",
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

module.exports.GetPaginatedGames = catchAsync(async (req, res, next) => {
  const { pageSize = 10, lastVisible } = req.query; // Get the lastVisible and pageSize from query

  const querySnapshot = await getAllActiveGames(
    next,
    parseInt(pageSize),
    lastVisible
  );

  if (!querySnapshot || querySnapshot.data.length === 0) {
    return next(new AppError("No active games found.", 404));
  }

  res.status(200).json({
    status: "ok",
    message: "Game questions fetched successfully",
    data: querySnapshot.data,
    lastVisible: querySnapshot.lastVisible, // Return lastVisible for the next pagination request
  });
});

async function getAllActiveGames(next, pageSize, lastVisible) {
  try {
    const firestore = getFirestore();
    const gamesRef = collection(firestore, "gamification");

    // Prepare the query with pagination and sorting by dateCreated
    let q = query(
      gamesRef,
      where("status", "==", 1),
      // orderBy("dateCreated", "desc"),
      limit(pageSize)
    );

    // Handle lastVisible only if it's passed
    if (lastVisible) {
      const lastVisibleDoc = await getDoc(
        doc(firestore, "gamification", lastVisible)
      );
      if (lastVisibleDoc.exists()) {
        q = query(
          gamesRef,
          where("status", "==", 1),
          // orderBy("dateCreated", "desc"),
          startAfter(lastVisibleDoc), // Add pagination using the last document
          limit(pageSize)
        );
      }
    }

    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return { data: [], lastVisible: null };
    }

    const activeGames = [];
    const courseIds = new Set(); // To keep track of unique course IDs for batch fetching course names
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      activeGames.push(data);
      courseIds.add(data.course_id);
    });

    // Fetch course names using course IDs
    const courseNames = await getCoursesByIds(Array.from(courseIds));

    // Group games by course_id and calculate total score for each group
    const groupedData = groupByCourseId(activeGames, courseNames);

    // Get the last document for pagination
    const lastVisibleDoc = querySnapshot.docs[querySnapshot.docs.length - 1].id;

    return { data: groupedData, lastVisible: lastVisibleDoc };
  } catch (error) {
    console.error("Error fetching paginated games:", error);
    return next(new AppError("Error fetching paginated games.", 500));
  }
}

function groupByCourseId(games, courseNames) {
  const grouped = {};

  games.forEach((game) => {
    const courseId = game.course_id;
    if (!grouped[courseId]) {
      grouped[courseId] = {
        course_id: courseId,
        course_name: courseNames[courseId] || "Unknown", // Use the course name or "Unknown"
        total_score: 0,
        games: [],
      };
    }
    grouped[courseId].games.push(game);
    grouped[courseId].total_score += parseInt(game.score, 10); // Add to total score
  });

  return Object.values(grouped); // Convert the grouped object into an array
}

async function getCoursesByIds(courseIds) {
  const firestore = getFirestore();
  const courseRef = collection(firestore, "courses");
  const courseNames = {};

  // Fetch courses by their IDs
  const promises = courseIds.map(async (courseId) => {
    const q = query(courseRef, where("id", "==", courseId));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      let course = null;
      snapshot.forEach((doc) => {
        course = doc.data();
        courseNames[courseId] = course.title
      });
      // const course = snapshot.docs[0].data();
      // courseNames[courseId] = course.title; // Use course title as the name
    } else {
      courseNames[courseId] = "Unknown"; // Fallback if course not found
    }
  });

  await Promise.all(promises);
  return courseNames;
}
