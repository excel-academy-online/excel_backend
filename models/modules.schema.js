const mongoose = require("mongoose");

const moduleSchema = new mongoose.Schema({
  module_name: {
    type: String,
    required: true,
  },
  firebase_id: {
    type: String,
    required: true,
  },
},{timestamps:true});

const Modules = mongoose.model("module", moduleSchema);
module.exports = Modules;
