const mongoose = require("mongoose");
require("dotenv").config();

/**
 * Opens the MongoDB connection.
 *
 * Rejects on failure so that index.js can abort startup - a server that boots
 * without a database answers every request with a 500 while still reporting
 * itself healthy to the platform.
 */
const Connect = async () => {
  if (!process.env.Mongo_Uri) {
    throw new Error("Mongo_Uri is not set (see .env.example)");
  }

  await mongoose.connect(process.env.Mongo_Uri, {
    serverSelectionTimeoutMS: 10000,
  });
  console.log("Database connection established successfully");
};

module.exports = Connect;
