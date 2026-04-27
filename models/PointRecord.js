// models/PointRecord.js
const mongoose = require('mongoose');

const pointRecordSchema = new mongoose.Schema({
    discordId: { type: String, required: true, index: true },
    robloxUsername: { type: String, required: true },

    reason: { type: String, default: 'No reason provided' },
    addedBy: { type: String, default: 'system' }, // 'system' | Discord user ID
    addedByUsername: { type: String, default: null },

    addedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },

    removed: { type: Boolean, default: false },
    removedAt: { type: Date, default: null },
    removedBy: { type: String, default: null }, // 'expired' | 'system' | Discord user ID
});

pointRecordSchema.index({ discordId: 1, removed: 1 });
pointRecordSchema.index({ expiresAt: 1, removed: 1 });

module.exports = mongoose.model('PointRecord', pointRecordSchema);
