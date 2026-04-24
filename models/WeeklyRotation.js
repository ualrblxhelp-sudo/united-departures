// models/WeeklyRotation.js
const mongoose = require('mongoose');

const weeklyRotationSchema = new mongoose.Schema({
    weekStartDate: { type: String, required: true, unique: true }, // YYYY-MM-DD Sunday Central
    assignments: [{
        date: String,  // YYYY-MM-DD
        userId: String,
    }],
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('WeeklyRotation', weeklyRotationSchema);
