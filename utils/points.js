// utils/points.js — Sanction point helpers
// Backed by models/PointRecord. Each call to addPoint() inserts one document
// per point added (so a +3 sanction produces 3 records, all with the same
// addedAt/expiresAt). Active = removed:false AND expiresAt > now.

const PointRecord = require('../models/PointRecord');

const VOLARE_GUILD_ID = '1309560657473179679';
const POINT_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;     // every 6 hours

// Best-effort label for the user. We don't have a real Discord<->Roblox link
// table, so we use the member's nickname/displayName from the Volare guild
// (which by community convention matches their Roblox username), falling
// back to the global Discord username.
async function resolveLabel(client, discordId) {
    try {
        const guild = await client.guilds.fetch(VOLARE_GUILD_ID);
        const member = await guild.members.fetch(discordId);
        return member.displayName || member.user.username;
    } catch (e) {
        try {
            const user = await client.users.fetch(discordId);
            return user.username;
        } catch (e2) {
            return 'unknown';
        }
    }
}

async function getActiveRecords(discordId) {
    return PointRecord.find({
        discordId: discordId,
        removed: false,
        expiresAt: { $gt: new Date() },
    }).sort({ addedAt: 1 }).lean();
}

async function getActiveCount(discordId) {
    return PointRecord.countDocuments({
        discordId: discordId,
        removed: false,
        expiresAt: { $gt: new Date() },
    });
}

async function addPoint(client, discordId, opts) {
    opts = opts || {};
    const amount = Math.max(1, opts.amount || 1);
    const reason = opts.reason || 'No reason provided';
    const addedBy = opts.addedBy || 'system';
    const addedByUsername = opts.addedByUsername || null;

    try {
        const robloxUsername = await resolveLabel(client, discordId);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + POINT_LIFETIME_MS);

        const docs = [];
        for (let i = 0; i < amount; i++) {
            docs.push({
                discordId: discordId,
                robloxUsername: robloxUsername,
                reason: reason,
                addedBy: addedBy,
                addedByUsername: addedByUsername,
                addedAt: now,
                expiresAt: expiresAt,
            });
        }
        await PointRecord.insertMany(docs);

        const total = await getActiveCount(discordId);
        return { ok: true, total: total, robloxUsername: robloxUsername };
    } catch (err) {
        console.error('[Points] addPoint error:', err);
        return { ok: false, error: err.message };
    }
}

async function removePoint(client, discordId, opts) {
    opts = opts || {};
    const amount = Math.max(1, opts.amount || 1);
    const removedBy = opts.removedBy || 'system';

    try {
        // Remove oldest active points first.
        const active = await PointRecord.find({
            discordId: discordId,
            removed: false,
            expiresAt: { $gt: new Date() },
        }).sort({ addedAt: 1 }).limit(amount);

        if (active.length === 0) {
            return { ok: false, error: 'no active points' };
        }

        const ids = active.map(function(r) { return r._id; });
        await PointRecord.updateMany(
            { _id: { $in: ids } },
            { $set: { removed: true, removedAt: new Date(), removedBy: removedBy } }
        );

        const total = await getActiveCount(discordId);
        return {
            ok: true,
            removed: active.length,
            total: total,
            robloxUsername: active[0].robloxUsername,
        };
    } catch (err) {
        console.error('[Points] removePoint error:', err);
        return { ok: false, error: err.message };
    }
}

// Periodic sweep that flips expired records' `removed` flag to true.
// Active queries already filter on expiresAt, so this is bookkeeping —
// it keeps the active index tight and gives clean audit trails.
async function expireOldPoints() {
    try {
        const result = await PointRecord.updateMany(
            { removed: false, expiresAt: { $lte: new Date() } },
            { $set: { removed: true, removedAt: new Date(), removedBy: 'expired' } }
        );
        if (result.modifiedCount > 0) {
            console.log('[Points] Expired ' + result.modifiedCount + ' point(s).');
        }
    } catch (err) {
        console.error('[Points] expireOldPoints error:', err);
    }
}

let _cleanupStarted = false;
function startCleanupScheduler(client) {
    if (_cleanupStarted) return;
    _cleanupStarted = true;
    expireOldPoints();
    setInterval(expireOldPoints, CLEANUP_INTERVAL_MS);
    console.log('[Points] Cleanup scheduler started (every 6h).');
}

module.exports = {
    addPoint: addPoint,
    removePoint: removePoint,
    getActiveRecords: getActiveRecords,
    getActiveCount: getActiveCount,
    expireOldPoints: expireOldPoints,
    startCleanupScheduler: startCleanupScheduler,
};
