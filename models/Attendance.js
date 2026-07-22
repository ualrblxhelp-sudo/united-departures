// models/Attendance.js
// One record per flight payout: who was on duty when miles were paid out.
//
// Mongoose runs in strict mode, so every field that gets persisted MUST be
// declared here or it is silently dropped on save.

var mongoose = require('mongoose');

var AttendeeSchema = new mongoose.Schema({
    userId: { type: Number, required: true },   // Roblox UserId
    username: { type: String, required: true }, // Roblox username
    rank: { type: Number, default: 0 },         // numeric group rank
    rankName: { type: String, default: '' },    // group role name, e.g. "Managing Director"
    discordId: { type: String, default: null }, // resolved via Bloxlink; null when unlinked
}, { _id: false });

var AttendanceSchema = new mongoose.Schema({
    flightId: { type: String, required: true, index: true },
    flightCode: { type: String, default: null },
    route: { type: String, default: null },
    recordedBy: { type: String, default: null }, // Roblox username of the staff who ran payout
    minRank: { type: Number, default: 50 },
    attendees: { type: [AttendeeSchema], default: [] },
    linkedCount: { type: Number, default: 0 },   // how many resolved to a Discord account
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Attendance', AttendanceSchema);
