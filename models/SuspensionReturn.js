const mongoose = require('mongoose');

const SuspensionReturnSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, default: '' },
    returnAt: { type: Date, required: true, index: true },
    status: {
        type: String,
        required: true,
        default: 'pending',
        enum: ['pending', 'completed', 'failed'],
        index: true,
    },
    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    inviteUrl: { type: String, default: '' },
    error: { type: String, default: '' },
});

SuspensionReturnSchema.index({ guildId: 1, userId: 1, status: 1 });

module.exports = mongoose.model('SuspensionReturn', SuspensionReturnSchema);
