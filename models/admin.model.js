const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
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
  password: {
    type: String,
    required: true,

  },
  coursesCreated: [
    {
      type: mongoose.Types.ObjectId,
      ref: "course",
    },
  ],
},{timestamps:true});

const Admin = mongoose.model("admin", adminSchema);
module.exports = Admin;
