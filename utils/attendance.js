// utils/attendance.js
// Flight attendance: when staff run a MileagePlus payout in-game, the Roblox
// server sends everyone currently in the server at or above the attendance rank
// (default 50). We resolve each to a Discord account via Bloxlink, store the
// record, and post an embed in Volare that pings them and shows their rank.
//
// Design notes:
//  * FAIL-OPEN. Attendance must never break a payout. Every failure path returns
//    { ok: false, reason } instead of throwing, and the caller ignores it.
//  * Bloxlink keys are optional. Until they're set, attendees are listed by
//    Roblox username with a note explaining pings aren't available yet.

const { EmbedBuilder } = require('discord.js');
var Attendance = require('../models/Attendance');
var bloxlink = require('./../services/bloxlink');
var ids = require('../config/ids');

// Discord hard limits we have to respect.
var EMBED_DESC_LIMIT = 4096;
var SAFE_DESC_LIMIT = 3800; // leaves room for the header/footer lines

// Resolve Roblox ids -> Discord ids. Never throws; an unresolvable attendee is
// simply left with discordId = null. Returns { linkedCount, configured }.
async function resolveDiscordIds(attendees) {
    if (!bloxlink.configured()) {
        for (var i = 0; i < attendees.length; i++) attendees[i].discordId = null;
        return { linkedCount: 0, configured: false };
    }
    var linked = 0;
    for (var j = 0; j < attendees.length; j++) {
        var a = attendees[j];
        try {
            var r = await bloxlink.robloxToDiscord(a.userId);
            if (r && r.linked && r.discordId) {
                a.discordId = String(r.discordId);
                linked++;
            } else {
                a.discordId = null;
            }
        } catch (err) {
            // Rate limit, outage, bad key — degrade to username-only for this one.
            console.error('[Attendance] Bloxlink lookup failed for ' + a.username + ':', err && err.message ? err.message : err);
            a.discordId = null;
        }
    }
    return { linkedCount: linked, configured: true };
}

// One line per attendee: ping (when linked) + Roblox username + rank.
function attendeeLine(a) {
    var who = a.discordId ? '<@' + a.discordId + '>' : '`' + a.username + '`';
    var tail = a.discordId ? ' \u2014 `' + a.username + '`' : '';
    var rank = a.rankName ? a.rankName : ('Rank ' + a.rank);
    return '\u2022 ' + who + tail + ' \u2014 **' + rank + '** (' + a.rank + ')';
}

function buildAttendanceEmbed(payload, attendees, linkInfo) {
    // Highest rank first, then alphabetical, so leadership reads at the top.
    var sorted = attendees.slice().sort(function (x, y) {
        if (y.rank !== x.rank) return y.rank - x.rank;
        return String(x.username).localeCompare(String(y.username));
    });

    var lines = [];
    var shown = 0;
    var used = 0;
    for (var i = 0; i < sorted.length; i++) {
        var line = attendeeLine(sorted[i]);
        if (used + line.length + 1 > SAFE_DESC_LIMIT) break;
        lines.push(line);
        used += line.length + 1;
        shown++;
    }
    var overflow = sorted.length - shown;
    if (overflow > 0) lines.push('\u2026and **' + overflow + '** more.');

    var header = [];
    if (payload.flightCode) header.push('**' + payload.flightCode + '**');
    if (payload.route) header.push(payload.route);
    var headerLine = header.length ? header.join(' \u2014 ') + '\n\n' : '';

    var desc = headerLine +
        'Marked at MileagePlus payout for staff at **rank ' + payload.minRank + '+**.\n\n' +
        (lines.length ? lines.join('\n') : '*No staff at or above rank ' + payload.minRank + ' were in the server.*');

    if (desc.length > EMBED_DESC_LIMIT) desc = desc.slice(0, EMBED_DESC_LIMIT - 3) + '\u2026';

    var embed = new EmbedBuilder()
        .setTitle('<:volare_plane:1408298312448086056> Flight Attendance')
        .setColor(0x3D1643)
        .setDescription(desc)
        .setTimestamp();

    var footer = attendees.length + ' on duty';
    if (payload.recordedBy) footer += ' \u2022 Payout by ' + payload.recordedBy;
    embed.setFooter({ text: footer });

    // Be explicit when pings aren't possible, so nobody assumes silence = absent.
    if (linkInfo && linkInfo.configured === false) {
        embed.addFields({
            name: 'Discord linking not configured',
            value: 'Bloxlink keys aren\u2019t set, so attendees are listed by Roblox username instead of being pinged.',
        });
    } else if (linkInfo && linkInfo.linkedCount < attendees.length) {
        var unlinked = attendees.length - linkInfo.linkedCount;
        embed.addFields({
            name: 'Unlinked accounts',
            value: '**' + unlinked + '** attendee(s) have no verified Bloxlink account, so they\u2019re shown by Roblox username.',
        });
    }

    return embed;
}

/**
 * Record attendance and post the Volare embed.
 * Returns { ok: true, recorded, linked, messageId } or { ok: false, reason }.
 * Never throws — a payout must succeed even if attendance fails.
 */
async function recordAttendance(client, payload) {
    try {
        var raw = Array.isArray(payload.attendance) ? payload.attendance : [];
        var minRank = Number(payload.minRank) || ids.ATTENDANCE_MIN_RANK || 50;

        // Sanitize + enforce the rank floor server-side; never trust the client.
        var seen = {};
        var attendees = [];
        for (var i = 0; i < raw.length; i++) {
            var a = raw[i] || {};
            var uid = Number(a.userId);
            if (!uid || seen[uid]) continue;
            var rank = Number(a.rank) || 0;
            if (rank < minRank) continue;
            seen[uid] = true;
            attendees.push({
                userId: uid,
                username: String(a.username || ('User ' + uid)),
                rank: rank,
                rankName: String(a.rankName || ''),
                discordId: null,
            });
        }

        if (!attendees.length) {
            return { ok: true, recorded: 0, linked: 0, messageId: null, note: 'no eligible staff in server' };
        }

        var linkInfo = await resolveDiscordIds(attendees);

        var doc = new Attendance({
            flightId: String(payload.flightId),
            flightCode: payload.flightCode || null,
            route: payload.route || null,
            recordedBy: payload.recordedBy || null,
            minRank: minRank,
            attendees: attendees,
            linkedCount: linkInfo.linkedCount,
            channelId: null,
            messageId: null,
        });

        var messageId = null;
        try {
            var guild = client && client.guilds ? client.guilds.cache.get(ids.STAFF_SERVER_ID) : null;
            var channel = null;
            if (guild) {
                channel = guild.channels.cache.get(ids.ATTENDANCE_CHANNEL_ID);
                if (!channel) {
                    channel = await guild.channels.fetch(ids.ATTENDANCE_CHANNEL_ID).catch(function () { return null; });
                }
            }
            if (channel) {
                var embed = buildAttendanceEmbed(
                    { flightCode: payload.flightCode, route: payload.route, recordedBy: payload.recordedBy, minRank: minRank },
                    attendees, linkInfo
                );
                // Pings live in the embed description; allowedMentions scopes them
                // to exactly the attendees so nothing else can be mentioned.
                var msg = await channel.send({
                    embeds: [embed],
                    allowedMentions: {
                        users: attendees.filter(function (a) { return a.discordId; })
                            .map(function (a) { return a.discordId; }),
                    },
                });
                messageId = msg.id;
                doc.channelId = channel.id;
                doc.messageId = msg.id;
            } else {
                console.warn('[Attendance] Volare attendance channel not reachable; record saved without an embed.');
            }
        } catch (postErr) {
            // Saving the record matters more than the embed — log and continue.
            console.error('[Attendance] Embed post failed:', postErr);
        }

        // Log/archive first, delete never: save after posting so messageId lands.
        await doc.save();

        return { ok: true, recorded: attendees.length, linked: linkInfo.linkedCount, messageId: messageId };
    } catch (err) {
        console.error('[Attendance] recordAttendance failed:', err);
        return { ok: false, reason: (err && err.message) || 'attendance_failed' };
    }
}

module.exports = { recordAttendance, buildAttendanceEmbed, resolveDiscordIds };
