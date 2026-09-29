const multer = require("multer");

const storage = multer.memoryStorage();
// Files posted through the API are held in memory, so cap them: a large
// video could exhaust the server's RAM and restart it for everyone. Big
// videos go from the dashboard straight to Firebase Storage instead.
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } });

module.exports = upload;


// const multer = require('multer');
// const upload = multer({ storage: multer.memoryStorage() });