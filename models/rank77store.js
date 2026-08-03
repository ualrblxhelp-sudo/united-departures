'use strict';

/**
 * Mongoose-backed store for Rank77Watchdog.
 *
 * Two collections:
 *   Rank77Authorization - who is permitted to hold the guarded rank
 *   Rank77History       - each member's last known non-guarded rank
 */

const mongoose = require('mongoose');

const authorizationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    grantedBy: { type: String, required: true },
    grantedByRank: { type: Number, required: true },
    reason: { type: String, default: null },
    grantedAt: { type: String, required: true },
  },
  { collection: 'rank77_authorizations' }
);

const historySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    rank: { type: Number, required: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'rank77_history' }
);

const Rank77Authorization =
  mongoose.models.Rank77Authorization ||
  mongoose.model('Rank77Authorization', authorizationSchema);

const Rank77History =
  mongoose.models.Rank77History ||
  mongoose.model('Rank77History', historySchema);

const store = {
  async get(userId) {
    return Rank77Authorization.findOne({ userId }).lean();
  },

  async set(userId, record) {
    await Rank77Authorization.findOneAndUpdate(
      { userId },
      { $set: record },
      { upsert: true, new: true }
    );
  },

  async delete(userId) {
    await Rank77Authorization.deleteOne({ userId });
  },

  async all() {
    return Rank77Authorization.find({}).lean();
  },

  async getHistory(userId) {
    const doc = await Rank77History.findOne({ userId }).lean();
    return doc ? doc.rank : null;
  },

  async setHistory(userId, rank) {
    await Rank77History.findOneAndUpdate(
      { userId },
      { $set: { rank, updatedAt: new Date() } },
      { upsert: true }
    );
  },
};

module.exports = { store, Rank77Authorization, Rank77History };
