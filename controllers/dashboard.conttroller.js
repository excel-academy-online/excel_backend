
const catchAsync = require("../utils/errors/catchAsync");


const { admin, serviceAccount, firebaseConfig } = require('../firebaseadminvar');

const { getFirestore, collection, getDoc, doc, setDoc, getDocs, where, query } = require("firebase/firestore");
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




async function uploadImageSample(imageBuffer, filename, next) {
    try {
        // const storage = getStorage(admin.app());
        const storageRef = ref(storage, `courses/${filename}`);

        // Create a reference to the uploaded file in Firebase Storage
        const uploadTask = uploadBytesResumable(storageRef, imageBuffer);

        // Handle upload progress (optional)
        uploadTask.on('state_changed',
            (snapshot) => {
                // Observe state change events such as progress, pause, and resume
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                console.log('Upload is ' + progress + '% done');
                switch (snapshot.state) {
                    case 'paused':
                        console.log('Upload is paused');
                        break;
                    case 'running':
                        console.log('Upload is in progress');
                        break;
                }
            },
            (error) => {
                // Handle upload errors
                console.error('Error uploading image:', error);
                return next(new AppError(error.message,));
            },
            async () => {
                // Successfully uploaded the image
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                console.log('Image uploaded successfully! Download URL:', downloadURL);
                return downloadURL; // Return the download URL for further use
            }
        );
    } catch (error) {
        console.error('Error uploading image:', error);
        return next(new AppError(error.message,));
    }
}

async function getProgramsFunction(uid, next) {
    try {
        const colRef = collection(firestore, 'programs');
        const querry = query(colRef, where('instructor id', '!=', uid));

        const snapshot = await getDocs(querry);

        if (snapshot.empty) {
            console.log(`You haven't uploaded any programs`);
            return 0; // Return 0 if no programs exist
        }

        return snapshot.size; // Return the count of programs

    } catch (error) {
        console.error(error.message, error);
        return next(new AppError(error.message));
    }
}



//////////////////////////////////////////////
//////////////////////////////////////////////

module.exports.getDashboardData = catchAsync(async (req, res, next) => {
    let { uid } = req.query;

    if (!uid) {
        return next(new AppError("userid is required", 403));
    }

    async function getDocumentCount(collectionName) {
        try {
            const snapshot = await admin.firestore().collection(collectionName);
            const query = snapshot.where('instructor', '==', uid);
            const snapshottwo = await query.get();

            return snapshottwo.size;
        } catch (error) {
            console.error("Error fetching documents:", error);
            return 0; 
        }
    }

    const uploaded_courses = await getDocumentCount("courses");
    const total_programs = await getProgramsFunction(uid, next); // Returns count, 0 if empty

    return res.status(200).json({
        status: "ok",
        message: "Dashboard data retrieved successfully",
        data: {
            uploaded_courses,
            students_per_course: 12,
            completed_course_student: 30,
            total_programs,
        }
    });
});



module.exports.uploadCourses = catchAsync(async (req, res, next) => {

    let { uid, price, requirements, title, whoforcourse, about_group, cancelPrice, category, certification, courseDateDuration, courseTimeDuration, creator, description, package, program_id, level } = req.body;



    if (!uid) {
        return next(new AppError("userid is required", 403));
    }

    if (!price || !title || !about_group) {
        return next(new AppError("All fields are required", 403));
    }


    if (!req.file) {
        console.log('no file');
        return next(new AppError("Error: No image uploaded", 400));
    }

    const imageBuffer = req.file.buffer;

    // const storage = getStorage(admin.app());
    const storageRef = ref(storage, `courses/${req.file.originalname}`);

    // Create a reference to the uploaded file in Firebase Storage
    const uploadTask = uploadBytesResumable(storageRef, imageBuffer);

    // Handle upload progress (optional)
    uploadTask.on('state_changed',
        (snapshot) => {
            // Observe state change events such as progress, pause, and resume
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            console.log('Upload is ' + progress + '% done');
            switch (snapshot.state) {
                case 'paused':
                    console.log('Upload is paused');
                    break;
                case 'running':
                    console.log('Upload is in progress');
                    break;
            }
        },
        (error) => {
            // Handle upload errors
            console.error('Error uploading image:', error);
            return next(new AppError(error.message,));
        },
        async () => {
            // Successfully uploaded the image
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            console.log('Image uploaded successfully! Download URL:', downloadURL);
            console.log("Storing download URL in Firestore...");
            // ... your Firestore logic to store the downloadURL ...


            const courseRef = doc(collection(firestore, 'courses'));

            await setDoc(courseRef, {
                'price': price,
                'requirements': requirements,
                // 'phoneNumber': null,
                'datecreated': new Date().toUTCString(),
                "date": new Date().toUTCString(),
                'thumbnail': downloadURL,
                'title': title,
                'whoForCourse': whoforcourse,
                "about group": about_group,
                "cancelPrice": cancelPrice,
                "category": category,
                "certification": certification,
                "courseDateDuration": courseDateDuration,
                "courseTimeDuration": courseTimeDuration,
                "creator": creator,
                "description": description,
                "image": downloadURL,
                "package": package,
                "instructor id": uid,
                "instructor": uid,
                "id": courseRef.id,
                "program id": program_id,
                "level": level,

            }).catch((error) => {
                console.error(error);
                return next(new AppError("Failed to upload course",));
            });

            // userCredential.user.upda

            res.status(200).json({
                status: "ok", message: "Course Uploaded Successfully", data: {}
            });
        }
    );

});


module.exports.getCourses = catchAsync(async (req, res, next) => {
    let { uid } = req.query;

    if (!uid) {
        return next(new AppError("userid is required", 403));
    }


    const colRef = collection(firestore, 'courses');
    const querry = query(colRef, where('instructor id', '==', uid));

    const snapshot = await getDocs(querry);

    if (snapshot.empty) {
        console.log(`You havent uploaded any course`);
        res.status(200).json({
            status: "ok", message: "You havent uploaded any course", data: {}
        });
        return null; // Or handle the case where no document is found
    }

    const documents = [];
    snapshot.forEach((doc) => {
        documents.push(doc.data());
    });





    res.status(200).json({
        status: "ok", message: "Courses gotten successfully", data: documents
    });
});


module.exports.uploadProgram = catchAsync(async (req, res, next) => {



    let { program_name, levels, uid, description } = req.body;



    if (!uid) {
        return next(new AppError("userid is required", 403));
    }

    if (!program_name || !levels) {
        return next(new AppError("All fields are required", 403));
    }


    if (levels.empty) {
        return next(new AppError("Add atleast one level", 403));
    }


    if (!req.file) {
        console.log('no file');
        return next(new AppError("Error: No image uploaded", 400));
    }

    const imageBuffer = req.file.buffer;

    // const storage = getStorage(admin.app());
    const storageRef = ref(storage, `programs/${req.file.originalname}`);

    // Create a reference to the uploaded file in Firebase Storage
    const uploadTask = uploadBytesResumable(storageRef, imageBuffer);

    // Handle upload progress (optional)
    uploadTask.on('state_changed',
        (snapshot) => {
            // Observe state change events such as progress, pause, and resume
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            console.log('Upload is ' + progress + '% done');
            switch (snapshot.state) {
                case 'paused':
                    console.log('Upload is paused');
                    break;
                case 'running':
                    console.log('Upload is in progress');
                    break;
            }
        },
        (error) => {
            // Handle upload errors
            console.error('Error uploading image:', error);
            return next(new AppError(error.message,));
        },
        async () => {
            // Successfully uploaded the image
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            console.log('Image uploaded successfully! Download URL:', downloadURL);
            console.log("Storing download URL in Firestore...");
            // ... your Firestore logic to store the downloadURL ...


            const userRef = doc(collection(firestore, 'programs'));

            await setDoc(userRef, {
                'datecreated': new Date().toUTCString(),
                "date": new Date().toUTCString(),
                'thumbnail': downloadURL,
                'program name': program_name,
                "description": description ?? '',
                "image": downloadURL,
                "levels": levels,
                "instructor id": uid,
                "instructor": uid,
                "id": userRef.id,

            }).catch((error) => {
                console.error(error);
                return next(new AppError("Failed to add program",));
            });

            // userCredential.user.upda

            res.status(200).json({
                status: "ok", message: "Program added Successfully", data: {}
            });
        }
    );

});


module.exports.getPrograms = catchAsync(async (req, res, next) => {
    let { uid } = req.query;

    if (!uid) {
        return next(new AppError("userid is required", 403));
    }


    const documents = await getProgramsFunction(uid, next, res);


    res.status(200).json({
        status: "ok", message: "Programs gotten successfully", data: documents
    });
});
