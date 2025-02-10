const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    first_name: {
      type: String,
      required: true,
    },
    last_name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    profile_picture: {
      type: String,
      required: true,
    },
    gender: {
      type: String,
      required: true,
      enum: {
        values: ["male", "female"],
        message: `{VALUE} is neither male nor female`,
      },
    },

    password: {
      type: String,
      required: true,
      },

    courses: [
      {
        type: mongoose.Types.ObjectId,
        ref: "course",
      },
    ],
    lastLogin: {
      type:Date,
      default:null,
    },
  },
  { timestamps: true }
);

const User = mongoose.model("user", userSchema);
module.exports = User;
