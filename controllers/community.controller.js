const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { initializeApp } = require("firebase/app");
const { v4: uuidv4 } = require("uuid");
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
  arrayUnion,
  arrayRemove,
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

async function deleteDocumentById(collectionName, documentId, res) {
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

const getUserDetail = async (id) => {
  // const firestore = getFirestore();
  const studentRef = doc(firestore, "users", id);
  const studentSnapshot = await getDoc(studentRef);
  if (studentSnapshot.exists()) {
    return studentSnapshot.data();
  } else {
    return false;
  }
};

module.exports.CreateCommunityPost = catchAsync(async (req, res, next) => {
  const {
    category_type,
    program_id,
    description = "",
    user_id,
    title,
    allow_replies,
    allow_new_msg_request,
  } = req.body;

  if (
    !user_id ||
    !program_id ||
    !category_type ||
    !description ||
    !title ||
    !allow_replies ||
    !allow_new_msg_request
  ) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const userRef = doc(collection(firestore, "communities"));

  // const q = query(programsRef, where("title", "==", title));
  const q = query(
    collection(firestore, "communities"),
    where("title", "==", title),
    where("category_type", "==", category_type)
  );
  const querySnapshot = await getDocs(q);

  if (!querySnapshot.empty) {
    return next(
      new AppError("community post with this name already exists", 403)
    );
  }

  const data = {
    id: userRef.id,
    userId: user_id,
    title,
    description,
    thumbnail: null,
    allow_replies,
    allow_new_msg_request,
    category_type,
    program_id,
    msg: [],
    request: [],
    removedStudent: [],
    dateCreated: new Date().toUTCString(),
    dateUpdated: new Date().toUTCString(),
    status: "draft",
  };

  if (req.file) {
    const storage = getStorage();
    const storageRef = ref(storage, `community/${req.file.originalname}`);
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
          return next(new AppError("Failed to add community post"));
        });

        res.status(200).json({
          status: "ok",
          message: "Community post added successfully",
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
      message: "Community post added successfully",
      data: {},
    });
  }
});
module.exports.EditCommunityPostOld = catchAsync(async (req, res, next) => {
  const {
    community_id,
    type,
    description = "",
    user_id,
    title,
    allow_replies,
    allow_new_msg_request,
  } = req.body;

  if (!community_id || !user_id) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const communityRef = doc(firestore, "communities", community_id);

  // Check if the document exists
  const docSnapshot = await getDoc(communityRef);
  if (!docSnapshot.exists()) {
    return next(new AppError("Community not found", 404));
  }

  const updateData = {
    type,
    description,
    title,
    userId: user_id,
    allow_replies,
    allow_new_msg_request,
    dateUpdated: new Date().toUTCString(),
  };

  if (req.file) {
    const storage = getStorage();
    const storageRef = ref(storage, `community/${req.file.originalname}`);
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

        await updateDoc(communityRef, updateData).catch((error) => {
          console.error(error);
          return next(new AppError(error?.message));
        });

        res.status(200).json({
          status: "ok",
          message: "Community post updated successfully",
          data: {},
        });
      }
    );
  } else {
    await updateDoc(communityRef, updateData).catch((error) => {
      console.error(error);
      return next(new AppError(error?.message));
    });

    res.status(200).json({
      status: "ok",
      message: "Community post updated successfully",
      data: {},
    });
  }
});

module.exports.EditCommunityPost = catchAsync(async (req, res, next) => {
  const {
    community_id,
    type,
    description = "",
    user_id,
    title,
    allow_replies,
    allow_new_msg_request,
  } = req.body;

  if (!community_id || !user_id) {
    return next(new AppError("Community ID and User ID are required", 403));
  }

  const firestore = getFirestore();
  const communityRef = doc(firestore, "communities", community_id);

  // Check if the document exists
  const docSnapshot = await getDoc(communityRef);
  if (!docSnapshot.exists()) {
    return next(new AppError("Community not found", 404));
  }

  // Only include fields that are defined in updateData
  const updateData = {};
  if (type !== undefined) updateData.type = type;
  if (description !== undefined) updateData.description = description;
  if (title !== undefined) updateData.title = title;
  if (user_id !== undefined) updateData.userId = user_id;
  if (allow_replies !== undefined) updateData.allow_replies = allow_replies;
  if (allow_new_msg_request !== undefined) updateData.allow_new_msg_request = allow_new_msg_request;

  updateData.dateUpdated = new Date().toUTCString();

  if (req.file) {
    const storage = getStorage();
    const storageRef = ref(storage, `community/${req.file.originalname}`);
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

        await updateDoc(communityRef, updateData).catch((error) => {
          console.error(error);
          return next(new AppError(error?.message));
        });

        res.status(200).json({
          status: "ok",
          message: "Community post updated successfully",
          data: {},
        });
      }
    );
  } else {
    await updateDoc(communityRef, updateData).catch((error) => {
      console.error(error);
      return next(new AppError(error?.message));
    });

    res.status(200).json({
      status: "ok",
      message: "Community post updated successfully",
      data: {},
    });
  }
});


module.exports.addStudentToRemovedList = catchAsync(async (req, res, next) => {
  const { community_id, student_id, user_id } = req.body;

  // Validate required fields
  if (!community_id || !student_id) {
    return next(new AppError("Community ID and Student ID are required", 400));
  }
  if (!user_id) {
    return next(new AppError("User ID is required", 400));
  }

  const firestore = getFirestore();
  const communityRef = doc(firestore, "communities", community_id);

  // Get the community document
  const communityDoc = await getDoc(communityRef);

  if (!communityDoc.exists()) {
    return next(new AppError("Community not found", 404));
  }

  try {
    // console.log("Updating community with ID:", community_id);
    // console.log("Adding student with ID:", student_id);
    // console.log("User performing the action:", user_id);

    // Update the removedStudent array using arrayUnion
    await updateDoc(communityRef, {
      removedStudent: arrayUnion(student_id),
      dateUpdated: new Date().toUTCString(), // Update the last modified date
    });

    res.status(200).json({
      status: "ok",
      message: "Student added to removed list successfully",
      data: {},
    });
  } catch (error) {
    console.error("Error updating community post:", error);
    return next(
      new AppError(error.message || "Failed to update community post", 500)
    );
  }
});

module.exports.removeStudentFromRemovedList = catchAsync(
  async (req, res, next) => {
    const { community_id, student_id, user_id } = req.body;

    // Validate required fields
    if (!community_id || !student_id) {
      return next(
        new AppError("Community ID and Student ID are required", 400)
      );
    }
    if (!user_id) {
      return next(new AppError("User ID is required", 400));
    }

    const firestore = getFirestore();
    const communityRef = doc(firestore, "communities", community_id);

    // Get the community document
    const communityDoc = await getDoc(communityRef);

    if (!communityDoc.exists()) {
      return next(new AppError("Community not found", 404));
    }

    try {
      // console.log("Updating community with ID:", community_id);
      // console.log("Removing student with ID:", student_id);
      // console.log("User performing the action:", user_id);

      // Remove the student ID from the removedStudent array using arrayRemove
      await updateDoc(communityRef, {
        removedStudent: arrayRemove(student_id),
        dateUpdated: new Date().toUTCString(), // Update the last modified date
      });

      res.status(200).json({
        status: "ok",
        message: "Student removed from removed list successfully",
        data: {},
      });
    } catch (error) {
      console.error("Error updating community post:", error);
      return next(
        new AppError(error.message || "Failed to update community post", 500)
      );
    }
  }
);

module.exports.PublishCommunityPost = catchAsync(async (req, res, next) => {
  const { id, user_id } = req.body;

  if (!id || !user_id) {
    return next(new AppError("All fields are required", 403));
  }

  const firestore = getFirestore();
  const communityRef = doc(firestore, "communities", id);

  // Check if the document exists
  const docSnapshot = await getDoc(communityRef);
  if (!docSnapshot.exists()) {
    return next(new AppError("Community post not found", 404));
  }

  const updateData = {
    status: "publish",
    userId: user_id,
    dateUpdated: new Date().toUTCString(),
  };

  await updateDoc(communityRef, updateData).catch((error) => {
    console.error(error);
    return next(new AppError("Failed to publish community post"));
  });

  res.status(200).json({
    status: "ok",
    message: "Community post published successfully",
    data: {},
  });
});
module.exports.GetCommunityPostOld = catchAsync(async (req, res, next) => {
  const { user_id, status } = req.query;

  // Check for required parameters
  if (!user_id) {
    return next(new AppError("User ID is required", 403));
  }
  if (!status) {
    return next(new AppError("Status is required", 403));
  }

  const colRef = collection(firestore, "communities");
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
    console.log(`No community post found`);
    return next(new AppError("No community post found", 404));
  }

  // Extract the document data
  const documents = snapshot.docs.map((doc) => doc.data());

  // Respond with the data
  res.status(200).json({
    status: "ok",
    message: "Community post retrieved successfully",
    data: documents,
  });
});

module.exports.GetCommunityPostOld = catchAsync(async (req, res, next) => {
  const { user_id, status } = req.query;

  // Check for required parameters
  if (!user_id) {
      return next(new AppError("User ID is required", 403));
  }
  if (!status) {
      return next(new AppError("Status is required", 403));
  }

  const colRef = collection(firestore, "communities");
  let queryData;

  // If status is "All", get all documents; otherwise filter by status
  if (status === "All") {
      queryData = colRef;
  } else {
      queryData = query(colRef, where("status", "==", status));
  }

  // Fetch the community documents
  const snapshot = await getDocs(queryData);

  // Check if the snapshot is empty
  if (snapshot.empty) {
      console.log(`No community post found`);
      return next(new AppError("No community post found", 404));
  }

  // Extract the document data
  const documents = snapshot.docs.map((doc) => doc.data());

  // Assuming category_type is present in the community post documents
  const communityPostsWithUserAccess = await Promise.all(documents.map(async (post) => {
      const categoryType = post.program_id;

      // Fetch courses that match the category type
      const coursesRef = collection(firestore, "courses");
      const coursesQuery = query(coursesRef, where("programId", "==", categoryType));
      const coursesSnapshot = await getDocs(coursesQuery);

      if (coursesSnapshot.empty) {
          post.user_ids_with_access = []; // No courses found for this category
          return post;
      }

      // Extract the level and id of the course
      const courseData = coursesSnapshot.docs.map((doc) => doc.data());
      const userIdsWithAccess = [];

      for (const course of courseData) {
          const level = course.level;
          const courseId = course.id;

          // Fetch enrollments that match the course id
          const enrollmentsRef = collection(firestore, "enrollments");
          const enrollmentsQuery = query(enrollmentsRef, where("course_id", "==", courseId));
          const enrollmentsSnapshot = await getDocs(enrollmentsQuery);

          // Check for enrolled students
          if (!enrollmentsSnapshot.empty) {
              enrollmentsSnapshot.docs.forEach((enrollmentDoc) => {
                  const enrollmentData = enrollmentDoc.data();
                  userIdsWithAccess.push(enrollmentData.student_id); // Collect student ids
              });
          }
      }

      // Optionally: Fetch user details based on student ids
      post.user_ids_with_access = userIdsWithAccess; // Store student ids in the post
      return post;
  }));

  // Respond with the data
  res.status(200).json({
      status: "ok",
      message: "Community post retrieved successfully",
      data: communityPostsWithUserAccess,
  });
});

module.exports.GetCommunityPost = catchAsync(async (req, res, next) => {
  const { user_id, status } = req.query;

  // Check for required parameters
  if (!user_id) {
    return next(new AppError("User ID is required", 403));
  }
  if (!status) {
    return next(new AppError("Status is required", 403));
  }

  const firestore = getFirestore();
  const colRef = collection(firestore, "communities");
  let queryData;

  // If status is "All", get all documents; otherwise filter by status
  if (status === "All") {
    queryData = colRef;
  } else {
    queryData = query(colRef, where("status", "==", status));
  }

  // Fetch the community documents
  const snapshot = await getDocs(queryData);

  // Check if the snapshot is empty
  if (snapshot.empty) {
    console.log(`No community post found`);
    return next(new AppError("No community post found", 404));
  }

  // Extract the document data
  const documents = snapshot.docs.map((doc) => doc.data());

  // Fetch user details for each post's relevant courses and enrolled users
  const communityPostsWithUserAccess = await Promise.all(
    documents.map(async (post) => {
      const categoryType = post.program_id;

      // Fetch courses that match the category type
      const coursesRef = collection(firestore, "courses");
      const coursesQuery = query(coursesRef, where("programId", "==", categoryType));
      const coursesSnapshot = await getDocs(coursesQuery);

      if (coursesSnapshot.empty) {
        post.user_ids_with_access = []; // No courses found for this category
        return post;
      }

      // Extract the level and id of the course
      const courseData = coursesSnapshot.docs.map((doc) => doc.data());
      const userIdsWithAccess = [];

      for (const course of courseData) {
        const courseId = course.id;

        // Fetch enrollments that match the course id
        const enrollmentsRef = collection(firestore, "enrollments");
        const enrollmentsQuery = query(enrollmentsRef, where("course_id", "==", courseId));
        const enrollmentsSnapshot = await getDocs(enrollmentsQuery);

        // Check for enrolled students
        if (!enrollmentsSnapshot.empty) {
          for (const enrollmentDoc of enrollmentsSnapshot.docs) {
            const enrollmentData = enrollmentDoc.data();
            const studentId = enrollmentData.student_id;

            // Fetch the user details for this student_id
            const userRef = doc(firestore, "users", studentId);
            const userSnapshot = await getDoc(userRef);

            if (userSnapshot.exists()) {
              const userData = userSnapshot.data();
              // Push student details including name, dp, and email
              userIdsWithAccess.push({
                student_id: studentId,
                name: userData.name || "Unknown",
                dp: userData.dp || "default_dp_url", // Handle missing profile pictures
                email: userData.email || "No email",
              });
            } else {
              // If the user does not exist, push basic student ID info
              userIdsWithAccess.push({
                student_id: studentId,
                name: "Unknown",
                dp: "default_dp_url", // Handle missing profile pictures
                email: "No email",
              });
            }
          }
        }
      }

      // Add the user details to the community post
      post.user_ids_with_access = userIdsWithAccess;
      return post;
    })
  );

  // Respond with the data
  res.status(200).json({
    status: "ok",
    message: "Community post retrieved successfully",
    data: communityPostsWithUserAccess,
  });
});


module.exports.DeleteCommunityPost = catchAsync(async (req, res, next) => {
  let { user_id, id } = req.query;

  if (!user_id) {
    return next(new AppError("userid is required", 403));
  }
  if (!id) {
    return next(
      new AppError("Community post id is required to delete post", 403)
    );
  }

  const colRef = collection(firestore, "communities");
  const querry = query(colRef, where("id", "==", id));

  const snapshot = await getDocs(querry);

  if (snapshot.empty) {
    console.log(`Community post not found`);
    return next(new AppError(`Community post with ID ${id} not found`, 404));
  }

  deleteDocumentById("communities", id, res);
});

module.exports.PostCommentOld = catchAsync(async (req, res, next) => {
  let { user_id, comment, post_id } = req.body;

  if (!user_id) {
    return next(new AppError("user_id is required", 403));
  }

  if (!comment) {
    return next(new AppError("comment", 403));
  }
  if (!post_id) {
    return next(new AppError("post_id", 403));
  }
  // const querySnapshot = await checkPostAllowComment(post_id, user_id);

  const userData = await getUserDetail(user_id);

  if (!userData) {
    return next(new AppError("User not found", 404));
  }

  const communityRef = doc(firestore, "communities", post_id);
  const docSnapshot = await getDoc(communityRef);
  if (!docSnapshot.exists()) {
    return next(new AppError("Community post not found", 404));
  }
  const communityData = docSnapshot.data();

  if (communityData?.allow_replies === "false" && userData?.admin === false) {
    return next(new AppError("Commenting not allowed", 403));
  }

  const commentId = uuidv4();
  const newComment = {
    id: commentId,
    sender: user_id,
    comment: comment,
    status: 1,
    dateCreated: new Date().toUTCString(),
  };

  const updatedMsg = [...communityData.msg, newComment];
  await updateDoc(communityRef, {
    msg: updatedMsg,
  });
  res.status(200).json({
    status: "ok",
    message: "comment post successfully",
    data: {
      ...newComment, // Returning the updated lesson array
    },
  });
});

module.exports.PostComment = catchAsync(async (req, res, next) => {
  let { user_id, comment, post_id } = req.body;

  if (!user_id) {
    return next(new AppError("user_id is required", 403));
  }

  if (!comment) {
    return next(new AppError("comment", 403));
  }
  if (!post_id) {
    return next(new AppError("post_id", 403));
  }

  const userData = await getUserDetail(user_id);

  if (!userData) {
    return next(new AppError("User not found", 404));
  }

  const communityRef = doc(firestore, "communities", post_id);
  const docSnapshot = await getDoc(communityRef);
  if (!docSnapshot.exists()) {
    return next(new AppError("Community post not found", 404));
  }

  const communityData = docSnapshot.data();

  if (communityData?.allow_replies === "false" && userData?.admin === false) {
    return next(new AppError("Commenting not allowed", 403));
  }

  const commentId = uuidv4();
  const mediaContents = [];

  // Handle file uploads if present
  if (req.files && req.files.length > 0) {
    const storage = getStorage();
    for (const file of req.files) {
      const storageRef = ref(storage, `community/${commentId}/${file.originalname}`);
      const uploadTask = uploadBytesResumable(storageRef, file.buffer);

      try {
        await new Promise((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
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
                url: downloadURL,
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

  // Create new comment with optional media
  const newComment = {
    id: commentId,
    sender: user_id,
    comment: comment,
    media: mediaContents, // Add media to the comment object
    status: 1,
    dateCreated: new Date().toUTCString(),
  };

  const updatedMsg = [...communityData.msg, newComment];
  await updateDoc(communityRef, {
    msg: updatedMsg,
  });

  res.status(200).json({
    status: "ok",
    message: "comment posted successfully",
    data: {
      ...newComment,
    },
  });
});


module.exports.DeleteCommentOlds = catchAsync(async (req, res, next) => {
  const { user_id, post_id, comment_id, type } = req.body;

  if (!user_id || !post_id || !comment_id || !type) {
    return next(new AppError("user_id, post_id, type, and comment_id are required", 403));
  }

  // Fetch post data
  const communityRef = doc(firestore, "communities", post_id);
  const docSnapshot = await getDoc(communityRef);

  if (!docSnapshot.exists()) {
    return next(new AppError("Community post not found", 404));
  }
  let updatedComments = [];
  const communityData = docSnapshot.data();
  if(type === "student"){
    updatedComments = communityData.msg.filter(comment => comment.id !== comment_id || comment.sender !== user_id);

  }else{
    updatedComments = communityData.msg.filter(comment => comment.id !== comment_id);
  }

  // Find and remove the comment
  // const updatedComments = communityData.msg.filter(comment => comment.id !== comment_id || comment.sender !== user_id);

  if (updatedComments.length === communityData.msg.length) {
    return next(new AppError("Comment not found or user is not authorized", 404));
  }

  // Update the community post with the remaining comments
  await updateDoc(communityRef, {
    msg: updatedComments,
    dateUpdated: new Date().toUTCString(),
  });

  res.status(200).json({
    status: "ok",
    message: "Comment deleted successfully",
  });
});

module.exports.DeleteComment = catchAsync(async (req, res, next) => {
  const { user_id, post_id, comment_id, type } = req.body;

  if (!user_id || !post_id || !comment_id || !type) {
    return next(new AppError("user_id, post_id, type, and comment_id are required", 403));
  }

  // Fetch post data
  const communityRef = doc(firestore, "communities", post_id);
  const docSnapshot = await getDoc(communityRef);

  if (!docSnapshot.exists()) {
    return next(new AppError("Community post not found", 404));
  }
  
  let communityData = docSnapshot.data(); // Ensure this remains unchanged
  
  let updatedComments = [];
  
  if (type === "student") {
    updatedComments = communityData.msg.filter(comment => comment.id !== comment_id || comment.sender !== user_id);
  } else {
    updatedComments = communityData.msg.filter(comment => comment.id !== comment_id);
  }

  if (updatedComments.length === communityData.msg.length) {
    return next(new AppError("Comment not found or user is not authorized", 404));
  }

  // Update the community post with the remaining comments
  await updateDoc(communityRef, {
    msg: updatedComments,
    dateUpdated: new Date().toUTCString(),
  });

  res.status(200).json({
    status: "ok",
    message: "Comment deleted successfully",
  });
});





module.exports.EditComment = catchAsync(async (req, res, next) => {
  const { user_id, post_id, comment_id, new_comment } = req.body;

  if (!user_id || !post_id || !comment_id || !new_comment) {
    return next(new AppError("user_id, post_id, comment_id, and new_comment are required", 403));
  }

  // Fetch post data
  const communityRef = doc(firestore, "communities", post_id);
  const docSnapshot = await getDoc(communityRef);

  if (!docSnapshot.exists()) {
    return next(new AppError("Community post not found", 404));
  }

  const communityData = docSnapshot.data();

  // Find the comment and update it
  const updatedComments = communityData.msg.map(comment => {
    if (comment.id === comment_id && comment.sender === user_id) {
      comment.comment = new_comment;
    }
    return comment;
  });

  // Update the community post with the modified comment
  await updateDoc(communityRef, {
    msg: updatedComments,
    dateUpdated: new Date().toUTCString(),
  });

  res.status(200).json({
    status: "ok",
    message: "Comment edited successfully",
  });
});

module.exports.FetchAllComments = catchAsync(async (req, res, next) => {
  const { post_id } = req.query;

  if (!post_id) {
    return next(new AppError("post_id is required", 403));
  }

  // Fetch post data
  const communityRef = doc(firestore, "communities", post_id);
  const docSnapshot = await getDoc(communityRef);

  if (!docSnapshot.exists()) {
    return next(new AppError("Community post not found", 404));
  }

  const communityData = docSnapshot.data();

  res.status(200).json({
    status: "ok",
    message: "Comments fetched successfully",
    data: communityData.msg,
  });
});


