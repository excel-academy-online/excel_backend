const catchAsync = require("../utils/errors/catchAsync");
const PDFDocument = require("pdfkit");
const fs = require("fs");

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
  addDoc,
  updateDoc,
  update,
} = require("firebase/firestore");
const {
  getStorage,
  ref,
  getDownloadURL,
  uploadBytesResumable,
  uploadBytes,
} = require("firebase/storage");
const { Readable } = require("stream");

const storage = getStorage();

const AppError = require("../utils/errors/AppError");
// const { query } = require("express");
const firestore = getFirestore();

const nodemailer = require("nodemailer");

const getCourseProgress = async (studentId, courseId) => {
  // const firestore = getFirestore();
  const progressRef = collection(firestore, "enrollments");
  const progressQuery = query(
    progressRef,
    where("student_id", "==", studentId),
    where("course_id", "==", courseId)
  );
  const progressSnapshot = await getDocs(progressQuery);

  if (progressSnapshot.empty) {
    return null; // If no progress found
  }

  const progressData = progressSnapshot.docs[0].data();
  return {
    percentage: progressData?.progress?.percentage,
    //   completion_status: progressData?.progress?.completion_status,
    lessons_completed: progressData?.progress?.lessons_completed,
    quizzes_completed: progressData?.progress?.quizzes_completed,
    assignments_completed: progressData?.progress?.assignments_completed,
    total_lessons: progressData?.progress?.total_lessons,
    total_quizzes: progressData?.progress?.total_quizzes,
    total_assignments: progressData?.progress?.total_assignments,
  };
};

const sendCertificateToStudent = async (studentEmail, certificateUrl) => {
  console.log({ studentEmail });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    port: 587,
    auth: {
      user: "tomiwaaderanti@gmail.com",
      pass: "qitbnwkhotssvogn",
    },
  });

  const mailOptions = {
    from: "tomzyadex@gmail.com",
    to: studentEmail,
    subject: "Your Course Completion Certificate",
    text: `Congratulations! You've successfully completed the course. You can download your certificate here: ${certificateUrl}`,
  };

  return transporter.sendMail(mailOptions);
};

const generateCertificateManual = (studentId, courseId, completionDate) => {
  const doc = new PDFDocument();
  const filePath = `certificate/${studentId}_${courseId}.pdf`;

  doc.pipe(fs.createWriteStream(filePath));

  doc
    .fontSize(25)
    .text("Certificate of Completion", { align: "center" })
    .moveDown();

  doc
    .fontSize(20)
    .text(`This certifies that student with ID: ${studentId}`, {
      align: "center",
    })
    .moveDown();

  doc
    .fontSize(18)
    .text(`Has successfully completed the course with ID: ${courseId}`, {
      align: "center",
    })
    .moveDown();

  doc
    .fontSize(12)
    .text(`Issued on: ${completionDate}`, { align: "center" })
    .moveDown();

  doc.end();

  return filePath; // Return path to save certificate
};

const generateAndUploadCertificate = async (studentId, courseId) => {
  // Create a new PDF document
  const doc = new PDFDocument();
  const buffers = [];

  // Capture the generated PDF into buffers
  doc.on("data", buffers.push.bind(buffers));

  return new Promise((resolve, reject) => {
    doc.on("end", async () => {
      const pdfData = Buffer.concat(buffers);

      // Upload the PDF to Firebase Storage
      try {
        const storageRef = ref(
          storage,
          `certificate/${studentId}_${courseId}.pdf`
        );
        await uploadBytes(storageRef, pdfData, {
          contentType: "application/pdf",
        });

        // Get the download URL after the upload completes
        const downloadURL = await getDownloadURL(storageRef);
        console.log("PDF uploaded successfully. URL:", downloadURL);
        resolve(downloadURL); // Return the download URL
      } catch (error) {
        console.error("Error uploading PDF:", error);
        reject(error); // Reject in case of error
      }
    });

    // Add content to the PDF
    doc.fontSize(25).text("Certificate of Completion", 100, 100);
    doc.text(`Awarded to: ${studentId}`);
    doc.text(`For completing the course: ${courseId}`);

    // Finalize the PDF
    doc.end();
  });
};

const generateVerificationCode = () => {
  return Math.random().toString(36).substr(2, 9).toUpperCase();
};

const saveCertificateToDB = async (certificateData) => {
  // console.log({certificateData});

  // const firestore = getFirestore();
  const certificateRef = doc(collection(firestore, "certificates"));

  await setDoc(certificateRef, {
    certificate_id: certificateRef.id,
    student_id: certificateData.student_id,
    course_id: certificateData.course_id,
    creator: certificateData.creator,
    certificate_url: certificateData.certificate_url,
    issue_date: certificateData.issue_date,
    verification_code: certificateData.verification_code,
  });

  return certificateRef.id;
};

const getStudentById = async (studentId) => {
  // const firestore = getFirestore();
  const studentRef = doc(firestore, "users", studentId);
  const studentSnapshot = await getDoc(studentRef);

  if (studentSnapshot.exists()) {
    return studentSnapshot.data();
  } else {
    return false;
  }
};

const getCourseById = async (courseId) => {
  // const firestore = getFirestore();
  const courseRef = doc(firestore, "courses", courseId);
  const courseSnapshot = await getDoc(courseRef);

  if (courseSnapshot.exists()) {
    return courseSnapshot.data();
  } else {
    return false;
  }
};

module.exports.SendCertificate = catchAsync(async (req, res, next) => {
  let { studentId, courseId, user_id } = req.body; // studentId is now an array of IDs

  if (!Array.isArray(studentId)) {
    return res.status(400).json({
      status: "fail",
      message: "studentId must be an array",
      data: {},
    });
  }

  const certificateResults = [];

  for (const id of studentId) {
    const colRef = collection(firestore, "users");
    const userQuery = query(colRef, where("id", "==", id));
    const snapshot = await getDocs(userQuery);

    // Handle case where no matching user is found
    if (snapshot.empty) {
      certificateResults.push({
        studentId: id,
        status: "fail",
        message: "User not found",
      });
      continue; // Skip to the next studentId
    }

    const userData = snapshot.docs[0].data();
    const progress = await getCourseProgress(id, courseId);

    if (!progress) {
      certificateResults.push({
        studentId: id,
        status: "fail",
        message: "Progress not found for student.",
      });
      continue; // Skip to the next studentId
    }

    // Check if the certificate has already been issued for this student and course
    const certificateQuery = query(
      collection(firestore, "certificates"),
      where("student_id", "==", id),
      where("course_id", "==", courseId)
    );
    const existingCertificateSnapshot = await getDocs(certificateQuery);

    if (!existingCertificateSnapshot.empty) {
      // If a certificate has already been generated for this student and course
      certificateResults.push({
        studentId: id,
        status: "fail",
        message: "Certificate has already been generated for this course.",
      });
      continue; // Skip to the next studentId
    }

    if (progress.percentage === 100) {
      try {
        // Generate and upload certificate
        const certificateUrl = await generateAndUploadCertificate(id, courseId);

        // Save certificate to the database
        const certificateId = await saveCertificateToDB({
          student_id: id,
          course_id: courseId,
          creator: user_id,
          certificate_url: certificateUrl,
          issue_date: new Date().toISOString(),
          verification_code: generateVerificationCode(),
        });

        // Send certificate to student
        await sendCertificateToStudent(userData?.email, certificateUrl);

        // Add success result
        certificateResults.push({
          studentId: id,
          status: "ok",
          message: "Certificate Generated Successfully",
          certificateId,
        });
      } catch (error) {
        certificateResults.push({
          studentId: id,
          status: "fail",
          message: `Error generating certificate: ${error.message}`,
        });
      }
    } else {
      certificateResults.push({
        studentId: id,
        status: "fail",
        message: "Course not yet completed.",
      });
    }
  }

  res.status(200).json({
    status: "ok",
    message: "Certificate generation process completed",
    data: certificateResults,
  });
});

module.exports.ResendCertificate = catchAsync(async (req, res, next) => {
  let { studentId, courseId, user_id } = req.body;

  const colRef = collection(firestore, "users");
  const userQuery = query(colRef, where("id", "==", studentId));
  const snapshot = await getDocs(userQuery);

  // Handle case where no matching user is found
  if (snapshot.empty) {
    return res.status(404).json({
      status: "fail",
      message: "User not found",
      data: {},
    });
  }
  const userData = snapshot.docs[0].data();

  const certRef = collection(firestore, "certificates");
  const certQuery = query(
    certRef,
    where("student_id", "==", studentId),
    where("course_id", "==", courseId)
  );
  const certSnapshot = await getDocs(certQuery);

  if (certSnapshot.empty) {
    return res.status(404).json({
      status: "fail",
      message: "User not found",
      data: {},
    });
  }
  const certData = certSnapshot.docs[0].data();
  await sendCertificateToStudent(userData?.email, certData?.certificate_url);
  res.status(200).json({
    status: "ok",
    message: "Certificate Resend Successfully",
    data: {},
  });
});

module.exports.getAllCertificates = catchAsync(async (req, res, next) => {
  try {
    // const firestore = getFirestore();
    const certificatesRef = collection(firestore, "certificates");

    // Fetch all documents from the "certificates" collection
    const snapshot = await getDocs(certificatesRef);

    // Handle the case where there are no certificates
    if (snapshot.empty) {
      return res.status(404).json({
        status: "fail",
        message: "No certificates found",
        data: [],
      });
    }

    // Use Promise.all to handle async operations inside the loop
    const certificatePromises = snapshot.docs.map(async (document) => {
      const certificateData = document.data();

      // Fetch the course data
      const courseRef = doc(firestore, "courses", certificateData.course_id);
      const courseSnapshot = await getDoc(courseRef);
      const courseData = courseSnapshot.exists() ? courseSnapshot.data() : {};
      const studentRef = doc(firestore, "users", certificateData.student_id);
      const studentSnapshot = await getDoc(studentRef);
      const studentData = studentSnapshot.exists()
        ? studentSnapshot.data()
        : {};
      const modifyCourseDetails = {
        courseTitle: courseData?.title,
        courseImage: courseData?.thumbnail,
      };
      const modifyStudentDetails = {
        studentName: studentData?.name,
        studentImage: studentData?.dp || "",
      };

      return {
        certificateId: document.id,
        ...certificateData,
        courseDetails: modifyCourseDetails || {},
        studentDetails: modifyStudentDetails || {},
      };
    });

    // Wait for all promises to resolve
    const certificates = await Promise.all(certificatePromises);

    // Return all certificates
    res.status(200).json({
      status: "ok",
      message: "Certificates retrieved successfully",
      data: certificates,
    });
  } catch (error) {
    console.error("Error retrieving certificates:", error);
    return next(new AppError("Failed to retrieve certificates", 500));
  }
});

module.exports.uploadCert = catchAsync(async (req, res, next) => {
  let { courseid, studentuid } = req.body;

  if (!studentuid) {
    return next(new AppError("studentid is required", 403));
  }

  if (!courseid) {
    return next(new AppError("courseid is required", 403));
  }

  if (!req.file) {
    console.log("no file");
    return next(new AppError("Error: No image uploaded", 403));
  }

  let userData = {};

  const imageBuffer = req.file.buffer;

  // const storage = getStorage(admin.app());
  const storageRef = ref(storage, `certificates/${req.file.originalname}`);

  // Create a reference to the uploaded file in Firebase Storage
  const uploadTask = uploadBytesResumable(storageRef, imageBuffer);

  // Handle upload progress (optional)
  uploadTask.on(
    "state_changed",
    (snapshot) => {
      // Observe state change events such as progress, pause, and resume
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

      // const querry = query(colRef, where('instructor id', '==', uid));

      const collectionPath = `users/${studentuid}/courses`;
      const docRef = collection(firestore, ...collectionPath.split("/"));

      // Create a query to find the document with courseid "xxx"
      const q = query(docRef, where("id", "==", courseid));

      // Update function (to be called after finding the document)

      // Get all documents matching the query
      getDocs(q)
        .then((querySnapshot) => {
          // Check if documents exist
          if (querySnapshot.empty) {
            console.log(`No documents found with courseid ${courseid}`);
            return next(
              new AppError(`No documents found with courseid ${courseid}`, 400)
            );
          }

          querySnapshot.forEach(async (doc) => {
            // Get a reference to the document
            const documentRef = doc.ref;

            try {
              await updateDoc(documentRef, { ["certificate"]: downloadURL });
              console.log("Certificate uploaded successfully!");
              res.status(200).json({
                status: "ok",
                message: "Certifiate Uploaded Successfully",
                data: {},
              });
            } catch (error) {
              console.error("Error uploading certificate:", error);
              return next(new AppError("Error uploading certificate", 400));
            }
          });
        })
        .catch((error) => {
          console.error("Error uploading certificate", error);
          return next(new AppError("Error uploading certificate", 400));
        });
    }
  );
});
