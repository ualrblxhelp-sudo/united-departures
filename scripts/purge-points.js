require('dotenv').config();
const mongoose = require('mongoose');
const { Client, GatewayIntentBits } = require('discord.js');
const PointRecord = require('../models/PointRecord');
const sheet = require('../utils/sheet');
const bloxlink = require('../services/bloxlink');
const roblox = require('../services/roblox');

var VOLARE_GUILD_ID = '1309560657473179679';
var EMPLOYEE_ROLE_ID = '1309614533056270366';

function hasFlag(flag) {
    return process.argv.indexOf(flag) !== -1;
}

function printUsage() {
    console.log('Usage:');
    console.log('  PURGE_POINTS_CONFIRM=YES node scripts/purge-points.js');
    console.log('  PURGE_POINTS_CONFIRM=YES node scripts/purge-points.js --hard-delete');
    console.log('');
    console.log('Default mode marks all active points as removed and syncs current Employee-role usernames to 0 in the sheet.');
    console.log('--hard-delete permanently deletes all point records, then syncs current Employee-role usernames to 0 in the sheet.');
}

async function resolveEmployeeUsernames() {
    if (!process.env.BOT_TOKEN) {
        throw new Error('BOT_TOKEN is not set.');
    }
    if (!bloxlink.configured()) {
        throw new Error('Bloxlink is not configured. Set BLOXLINK_API_KEY and BLOXLINK_GUILD_ID.');
    }

    var client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
        ],
    });

    try {
        await client.login(process.env.BOT_TOKEN);

        var guild = client.guilds.cache.get(VOLARE_GUILD_ID) || await client.guilds.fetch(VOLARE_GUILD_ID);
        if (!guild) throw new Error('United Volare guild not found.');

        await guild.members.fetch();

        var role = guild.roles.cache.get(EMPLOYEE_ROLE_ID) || await guild.roles.fetch(EMPLOYEE_ROLE_ID).catch(function () { return null; });
        if (!role) throw new Error('Employee role not found: ' + EMPLOYEE_ROLE_ID);

        var usernames = [];
        var seen = new Set();
        var failures = [];
        var members = role.members ? Array.from(role.members.values()) : [];

        for (var i = 0; i < members.length; i++) {
            var member = members[i];
            if (!member || !member.user || member.user.bot) continue;

            try {
                var link = await bloxlink.discordToRoblox(member.id);
                if (!link.configured || !link.linked || !link.robloxId) {
                    failures.push(member.user.username + ' (' + member.id + '): not linked in Bloxlink');
                    continue;
                }

                var who = await roblox.userIdToUsername(link.robloxId);
                if (!who || !who.username) {
                    failures.push(member.user.username + ' (' + member.id + '): Roblox username lookup failed');
                    continue;
                }

                var key = String(who.username).trim().toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    usernames.push(who.username);
                }
            } catch (err) {
                failures.push(member.user.username + ' (' + member.id + '): ' + err.message);
            }
        }

        return {
            usernames: usernames,
            failures: failures,
            memberCount: members.length,
        };
    } finally {
        await client.destroy();
    }
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
        var resolved = await resolveEmployeeUsernames();
        var usernames = resolved.usernames;

        console.log('[PurgePoints] Employee-role members seen: ' + resolved.memberCount);
        console.log('[PurgePoints] Employee usernames resolved via Bloxlink: ' + usernames.length);
        if (resolved.failures.length) {
            console.log('[PurgePoints] Username resolution failures (' + resolved.failures.length + '):');
            resolved.failures.forEach(function(item) { console.log('  - ' + item); });
        }

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
