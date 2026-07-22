const mongoose = require('mongoose');

var AttendanceMemberSchema = new mongoose.Schema({
    discordId: { type: String, required: true },
    discordUsername: { type: String, default: '' },
}, { _id: false });

var TrainingAttendanceLogSchema = new mongoose.Schema({
    trainingType: {
        type: String,
        required: true,
        enum: ['customer-service', 'flight-crew', 'ramp-services'],
        index: true,
    },
    hostId: { type: String, required: true, index: true },
    hostUsername: { type: String, default: '' },
    attendees: { type: [AttendanceMemberSchema], default: [] },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model('TrainingAttendanceLog', TrainingAttendanceLogSchema);
