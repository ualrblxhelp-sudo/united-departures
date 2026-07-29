const mongoose = require('mongoose');

// One record per student assigned to an instructor by /commencetraining.
// Stays "active" until the assigned instructor confirms it with /traininglog,
// at which point it flips to "completed" and the in-training role is removed.
var TrainingAssignmentSchema = new mongoose.Schema({
    studentId: { type: String, required: true, index: true },
    studentUsername: { type: String, default: '' },
    instructorId: { type: String, required: true, index: true },
    instructorUsername: { type: String, default: '' },
    department: {
        type: String,
        required: true,
        enum: ['customer-service', 'flight-crew', 'ramp-services'],
    },
    status: { type: String, default: 'active', enum: ['active', 'completed'] },
    assignedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    completedBy: { type: String, default: null },
    completedByUsername: { type: String, default: '' },
});

TrainingAssignmentSchema.index({ studentId: 1, status: 1 });
TrainingAssignmentSchema.index({ instructorId: 1, status: 1 });

module.exports = mongoose.model('TrainingAssignment', TrainingAssignmentSchema);
