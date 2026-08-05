const mongoose = require('mongoose');

const ResignationRequestSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    username: { type: String, default: '' },
    reason: { type: String, required: true },
    status: {
        type: String,
        required: true,
        default: 'pending',
        enum: ['pending', 'approved', 'rejected'],
        index: true,
    },
    reviewChannelId: { type: String, default: null },
    reviewMessageId: { type: String, default: null },
    requestedAt: { type: Date, default: Date.now, index: true },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: null },
    reviewedByUsername: { type: String, default: '' },
});

ResignationRequestSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('ResignationRequest', ResignationRequestSchema);
