require('dotenv').config();
const mongoose = require('mongoose');
const PointRecord = require('../models/PointRecord');
const sheet = require('../utils/sheet');

function hasFlag(flag) {
    return process.argv.indexOf(flag) !== -1;
}

function printUsage() {
    console.log('Usage:');
    console.log('  PURGE_POINTS_CONFIRM=YES node scripts/purge-points.js');
    console.log('  PURGE_POINTS_CONFIRM=YES node scripts/purge-points.js --hard-delete');
    console.log('');
    console.log('Default mode marks all active points as removed and syncs affected users to 0 in the sheet.');
    console.log('--hard-delete permanently deletes all point records, then syncs affected users to 0 in the sheet.');
}

async function main() {
    if (process.env.PURGE_POINTS_CONFIRM !== 'YES') {
        console.error('Refusing to run: set PURGE_POINTS_CONFIRM=YES to confirm this destructive action.');
        printUsage();
        process.exit(1);
    }

    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not set.');
        process.exit(1);
    }

    var hardDelete = hasFlag('--hard-delete');

    await mongoose.connect(process.env.MONGODB_URI);

    try {
        var affected = await PointRecord.find({}, { robloxUsername: 1, discordId: 1, removed: 1 }).lean();
        var usernames = [];
        var seen = new Set();

        affected.forEach(function(record) {
            var username = String(record.robloxUsername || '').trim();
            if (username && !seen.has(username.toLowerCase())) {
                seen.add(username.toLowerCase());
                usernames.push(username);
            }
        });

        if (hardDelete) {
            var deleted = await PointRecord.deleteMany({});
            console.log('[PurgePoints] Hard-deleted ' + deleted.deletedCount + ' point record(s).');
        } else {
            var updated = await PointRecord.updateMany(
                { removed: false },
                { $set: { removed: true, removedAt: new Date(), removedBy: 'system-purge' } }
            );
            console.log('[PurgePoints] Marked ' + updated.modifiedCount + ' active point record(s) as removed.');
        }

        var synced = 0;
        var failed = 0;
        for (var i = 0; i < usernames.length; i++) {
            var username = usernames[i];
            try {
                var result = await sheet.syncSanctionTotal(username, 0);
                if (result && result.ok) {
                    synced++;
                } else {
                    failed++;
                    console.error('[PurgePoints] Sheet sync failed for ' + username + ':', result && (result.error || JSON.stringify(result)));
                }
            } catch (err) {
                failed++;
                console.error('[PurgePoints] Sheet sync exception for ' + username + ':', err.message);
            }
        }

        console.log('[PurgePoints] Affected usernames: ' + usernames.length);
        console.log('[PurgePoints] Sheet sync successes: ' + synced);
        console.log('[PurgePoints] Sheet sync failures: ' + failed);
    } finally {
        await mongoose.disconnect().catch(function() {});
    }
}

main().catch(function(err) {
    console.error('[PurgePoints] Fatal error:', err);
    process.exit(1);
});
