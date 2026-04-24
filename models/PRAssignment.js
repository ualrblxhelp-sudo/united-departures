// models/PRAssignment.js
const mongoose = require('mongoose');

const prAssignmentSchema = new mongoose.Schema({
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD Central
    theme: { type: String, required: true },

    originalAssigneeId: { type: String, required: true },
    currentAssigneeId: { type: String, required: true },
    acceptedBy: { type: String, default: null },
    rejectedIds: { type: [String], default: [] },

    status: {
        type: String,
        enum: ['pending', 'accepted', 'completed', 'failed', 'skipped'],
        default: 'pending',
    },

    dmMessages: [{
        userId: String,
        channelId: String,
        messageId: String,
    }],

    failureProcessed: { type: Boolean, default: false },

    createdAt: { type: Date, default: Date.now },
    acceptedAt: Date,
    completedAt: Date,
    failedAt: Date,
});

module.exports = mongoose.model('PRAssignment', prAssignmentSchema);
