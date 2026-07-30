const mongoose = require('mongoose');

var PaymentAdjustmentSchema = new mongoose.Schema({
    amount: { type: Number, required: true },
    reason: { type: String, default: '' },
    editedBy: { type: String, default: null },
    editedByUsername: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true },
}, { _id: false });

var PersonnelActionSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ['warning', 'suspension', 'termination', 'payment_edit', 'points_edit', 'position_edit'],
    },
    reason: { type: String, default: '' },
    issuedBy: { type: String, default: null },
    issuedByUsername: { type: String, default: '' },
    durationDays: { type: Number, default: null },
    meta: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true },
}, { _id: false });

var PersonnelRecordSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true, index: true },
    positionOverride: { type: String, default: '' },
    paymentAdjustments: { type: [PaymentAdjustmentSchema], default: [] },
    actions: { type: [PersonnelActionSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

PersonnelRecordSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('PersonnelRecord', PersonnelRecordSchema);
