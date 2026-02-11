// models/Flight.js
const mongoose = require('mongoose');

const allocationSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    username: { type: String, required: true },
    position: { type: String, required: true },
    allocatedAt: { type: Date, default: Date.now },
});

const flightSchema = new mongoose.Schema({
    flightNumber: { type: String, required: true, unique: true },
    departure: { type: String, required: true },       // IATA code
    destination: { type: String, required: true },      // IATA code
    aircraft: { type: String, required: true },         // aircraft key e.g. '737-800 NEXT'
    employeeJoinTime: { type: Number, required: true }, // Unix timestamp
    serverOpenTime: { type: Number, required: true },   // Unix timestamp
    dispatcherId: { type: String, required: true },     // Discord user ID of creator
    dispatcherUsername: { type: String, required: true },

    // Allocations
    allocations: [allocationSchema],

    // Discord message references
    forumThreadId: { type: String },       // Forum thread ID in staff server
    forumMessageId: { type: String },      // The allocation embed message ID
    calendarMessageId: { type: String },   // Persistent calendar message (shared)

    // Status
    status: { type: String, default: 'scheduled', enum: ['scheduled', 'active', 'completed', 'cancelled'] },
    createdAt: { type: Date, default: Date.now },
    archivedAt: { type: Date },
});

// Index for fast lookups
flightSchema.index({ flightNumber: 1 });
flightSchema.index({ status: 1 });
flightSchema.index({ serverOpenTime: 1 });

module.exports = mongoose.model('DiscordFlight', flightSchema);
