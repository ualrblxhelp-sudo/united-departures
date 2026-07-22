// models/Flight.js
const mongoose = require('mongoose');

const allocationSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    username: { type: String, required: true },
    position: { type: String, required: true },
    allocatedAt: { type: Date, default: Date.now },
});

const flightSchema = new mongoose.Schema({
    flightNumber: { type: String, required: true },
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
    discordEventId: { type: String },      // Discord scheduled event ID (used by end/edit/delete)

    // Status
    flightType: { type: String, default: 'regular', enum: ['regular', 'premium', 'test'] },
    status: { type: String, default: 'scheduled', enum: ['scheduled', 'active', 'completed', 'cancelled'] },
    createdAt: { type: Date, default: Date.now },
    archivedAt: { type: Date },

    // Lifecycle timestamps used by /flightpanel.
    // NOTE: completedAt was already being assigned in _end.js but was NOT
    // declared here -- Mongoose strict mode silently dropped it on every save,
    // so no flight has ever recorded a completion time. Declaring it fixes that.
    startedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelReason: { type: String },

    // Ops announcements already sent for this flight, so the panel can show
    // what's been done and avoid accidental duplicates.
    announcementsSent: { type: [String], default: [] },
});

// Index for fast lookups
flightSchema.index({ status: 1 });
flightSchema.index({ serverOpenTime: 1 });

module.exports = mongoose.model('DiscordFlight', flightSchema);
