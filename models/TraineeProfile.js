const mongoose = require('mongoose');

var DisciplinaryActionSchema = new mongoose.Schema({
    reason: { type: String, required: true },
    issuedBy: { type: String, default: null },
    issuedByUsername: { type: String, default: null },
    issuedAt: { type: Date, default: Date.now },
    notes: { type: String, default: '' },
}, { _id: false });

var TraineeProfileSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true, index: true },
    discordUsername: { type: String, default: '' },
    completedTrainings: {
        type: [String],
        default: [],
        enum: ['customer-service', 'flight-crew', 'ramp-services'],
    },
    disciplinaryActions: { type: [DisciplinaryActionSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

TraineeProfileSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('TraineeProfile', TraineeProfileSchema);
