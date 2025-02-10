const mongoose = require('mongoose');
require('dotenv').config();

const Connect = async () => {
    try {
        await mongoose.connect(process.env.Mongo_Uri);
        console.log(`Database Connection Established Succesfully`);
    } catch (error) {
        console.log(`mongoose Database Connection failed`);
    }
}
module.exports = Connect