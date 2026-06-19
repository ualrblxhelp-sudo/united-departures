// utils/announce.js — Public flight announcement + ghost ping
// Posts a flight-scheduled announcement to the main server announcement channel,
// reacts to it with the plane emoji, and fires a ghost ping (@everyone, then delete).
var ids = require('../config/ids');

// Custom emojis used in the announcement body (must be accessible to the app).
var E_PLANE = '<:e_plane:1397829563249328138>';
var E_ARROW = '<:e_arrow:1406847964655259710>';
var D_STARALLIANCE = '<:d_staralliance:1397830727919337493>';

// Reaction identifier for the e_plane emoji (name:id form, no angle brackets).
var E_PLANE_REACTION = 'e_plane:1397829563249328138';

// Builds the exact announcement content. `eventLink` is the Discord scheduled-event URL.
function buildAnnouncementContent(flight, eventLink) {
    return (
        E_PLANE + ' [**A Flight Has Been Scheduled**](' + eventLink + ')\n' +
        '> ' + E_ARROW + ' A flight has been scheduled for <t:' + flight.serverOpenTime + ':F>, ' +
        'departing from **' + flight.departure + '** and landing at **' + flight.destination + '**. ' +
        'Information about the flight can be found by clicking on the link above.\n' +
        '-# ' + D_STARALLIANCE + ' ᴀ ꜱᴛᴀʀ ᴀʟʟɪᴀɴᴄᴇ ᴍᴇᴍʙᴇʀ'
    );
}

// Posts the announcement, reacts, and ghost pings. Never throws — logs and returns null on failure.
async function postFlightAnnouncement(client, flight, eventLink) {
    try {
        var channelId = ids.FLIGHT_ANNOUNCE_CHANNEL_ID;
        if (!channelId) {
            console.error('[Announce] No FLIGHT_ANNOUNCE_CHANNEL_ID configured.');
            return null;
        }

        var channel = await client.channels.fetch(channelId).catch(function() { return null; });
        if (!channel || typeof channel.send !== 'function') {
            console.error('[Announce] Announcement channel not found or not text-based: ' + channelId);
            return null;
        }

        // 1) Post the announcement (no pings from the body itself).
        var content = buildAnnouncementContent(flight, eventLink);
        var announcement = await channel.send({
            content: content,
            allowedMentions: { parse: [] },
        });

        // 2) React to the announcement with the plane emoji.
        try {
            await announcement.react(E_PLANE_REACTION);
        } catch (reactErr) {
            console.error('[Announce] React error:', reactErr);
        }

        // 3) Ghost ping @everyone, then delete the ping message.
        try {
            var ping = await channel.send({
                content: '@everyone',
                allowedMentions: { parse: ['everyone'] },
            });
            await ping.delete().catch(function() {});
        } catch (pingErr) {
            console.error('[Announce] Ghost ping error:', pingErr);
        }

        return announcement;
    } catch (err) {
        console.error('[Announce] Failed to post flight announcement:', err);
        return null;
    }
}

module.exports = {
    postFlightAnnouncement: postFlightAnnouncement,
    buildAnnouncementContent: buildAnnouncementContent,
};
