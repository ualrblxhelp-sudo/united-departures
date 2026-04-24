// models/LeaveOfAbsence.js
const mongoose = require('mongoose');

const loaSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    username: String,
    robloxUsername: String,
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: String,
    approvedBy: String,
    approvedByUsername: String,
    approvedAt: { type: Date, default: Date.now },
});

loaSchema.index({ userId: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model('LeaveOfAbsence', loaSchema);
