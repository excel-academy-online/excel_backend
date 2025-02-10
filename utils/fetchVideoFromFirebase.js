const bucket = require("./firebase.config");

const fetchVideoFromFirebase = (filename)=>{
    const file = bucket.file(filename);
    return file
}
module.exports = fetchVideoFromFirebase