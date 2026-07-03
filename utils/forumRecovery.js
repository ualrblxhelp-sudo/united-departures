// utils/forumRecovery.js
// Recovery for accidentally-deleted flight allocation forum posts.
//
// Discord has no "undelete" — once an allocation thread is deleted it's gone.
// But every flight's data (info + allocations) lives in the DiscordFlight
// document, so we can recreate the thread from stored data. This module powers
// both the on-demand `/flight recover` command and an automatic startup
// self-heal that mirrors the calendar's self-healing behaviour.

var Flight = require('../models/Flight');
var { buildFlightInfoEmbed, buildAllocationEmbed } = require('./embed');
var ids = require('../config/ids');

// Type prefix/colour must match _create.js so a recovered post looks identical
// to the original.
var FLIGHT_TYPES = {
    regular: { color: null, threadPrefix: '' },
    premium: { color: 0xDAA520, threadPrefix: '[PREMIUM] ' },
    test: { color: 0x1414d2, threadPrefix: '[TEST] ' },
};

// Statuses whose allocation post is supposed to be live. `completed`/`cancelled`
// flights intentionally have locked+archived threads (see _end.js/_delete.js),
// so they are never touched by recovery.
var LIVE_STATUSES = ['scheduled', 'active'];

// Backstop against a mass @everyone storm: if a large number of threads look
// missing on a single boot (e.g. the whole forum channel was recreated with a
// new ID, invalidating every stored thread ID), we do NOT silently repost to
// all of them. We heal up to this many, then log and defer the rest to the
// manual `/flight recover` command.
var MAX_AUTO_RECOVERIES_PER_RUN = 3;

// Spacing between auto-recreations to stay well clear of rate limits and to
// avoid firing several @everyone pings back-to-back.
var SELFHEAL_DELAY_MS = 1500;

// Whether the startup self-heal re-pings @everyone when it restores a post.
// The on-demand command always pings (the user explicitly confirms it).
var PING_ON_SELFHEAL = true;

var selfHealRunning = false;

function delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// Resolve the staff-server forum channel, tolerating a cold cache by falling
// back to an explicit fetch. Returns null if it genuinely can't be reached.
async function getForumChannel(client) {
    var guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
    if (!guild) return null;
    var forum = guild.channels.cache.get(ids.FORUM_CHANNEL_ID);
    if (!forum) {
        forum = await guild.channels.fetch(ids.FORUM_CHANNEL_ID).catch(function() { return null; });
    }
    return forum || null;
}

// Classify the current state of a flight's stored forum thread.
// Returns one of: 'live', 'archived', 'missing', 'unknown'.
// 'unknown' means a transient/uncertain failure — callers must NOT recreate on
// 'unknown', only on 'missing' (a definitive 404 / no stored id).
async function inspectThread(client, flight) {
    if (!flight.forumThreadId) return 'missing';

    var guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
    if (!guild) return 'unknown';

    var cached = guild.channels.cache.get(flight.forumThreadId);
    if (cached) return cached.archived ? 'archived' : 'live';

    try {
        var thread = await guild.channels.fetch(flight.forumThreadId);
        if (!thread) return 'missing';
        return thread.archived ? 'archived' : 'live';
    } catch (err) {
        // 10003 = Unknown Channel (the thread was deleted). Only this — and an
        // explicit 404 — counts as "missing". Everything else (network blips,
        // 5xx, rate limits, permissions) is treated as 'unknown' so we never
        // recreate a thread that may actually still exist.
        if (err && (err.code === 10003 || err.status === 404 || err.httpStatus === 404)) {
            return 'missing';
        }
        console.error('[ForumRecovery] Thread inspect error for flight ' + flight.flightNumber + ':', err && err.message ? err.message : err);
        return 'unknown';
    }
}

// Recreate the allocation thread for a flight from its stored data and persist
// the new thread/message IDs so /allocate, /unallocate, /edit, /end, /delete
// all point at the new post. Throws on failure so callers can report it.
async function recreateForumThread(client, flight, options) {
    options = options || {};
    var ping = options.ping !== false; // default: ping @everyone

    var forum = await getForumChannel(client);
    if (!forum) throw new Error('Forum channel unavailable (guild or channel not reachable).');

    var typeInfo = FLIGHT_TYPES[flight.flightType] || FLIGHT_TYPES.regular;

    var infoEmbed = buildFlightInfoEmbed(flight);
    var allocEmbed = buildAllocationEmbed(flight);
    if (typeInfo.color) {
        infoEmbed.setColor(typeInfo.color);
        allocEmbed.setColor(typeInfo.color);
    }

    var threadName = typeInfo.threadPrefix + flight.flightNumber + ' - Crew Allocation';
    // A forum thread must have a starter message. Use a zero-width char when we
    // deliberately don't want to ping (silent self-heal mode).
    var content = ping ? '@everyone' : '\u200b';

    var thread = await forum.threads.create({
        name: threadName,
        message: { content: content, embeds: [infoEmbed, allocEmbed] },
    });

    var starter = await thread.fetchStarterMessage().catch(function() { return null; });
    flight.forumThreadId = thread.id;
    flight.forumMessageId = starter ? starter.id : null;
    await flight.save();

    return thread;
}

// Startup self-heal: walk live flights, and for any whose stored thread is
// definitively gone (404), recreate it. Runs on ClientReady, mirroring the
// calendar's self-healing pattern.
async function selfHealForumThreads(client) {
    if (selfHealRunning) return;
    selfHealRunning = true;

    try {
        var forum = await getForumChannel(client);
        if (!forum) {
            console.warn('[ForumRecovery] Forum channel not reachable at startup; skipping self-heal this run.');
            return;
        }

        var flights = await Flight.find({ status: { $in: LIVE_STATUSES } }).sort({ serverOpenTime: 1 });

        var missing = [];
        for (var i = 0; i < flights.length; i++) {
            var state = await inspectThread(client, flights[i]);
            if (state === 'missing') missing.push(flights[i]);
        }

        if (missing.length === 0) {
            console.log('[ForumRecovery] Self-heal: all live flight allocation posts present.');
            return;
        }

        if (missing.length > MAX_AUTO_RECOVERIES_PER_RUN) {
            console.warn(
                '[ForumRecovery] Self-heal found ' + missing.length + ' missing allocation posts, ' +
                'which exceeds the safety cap of ' + MAX_AUTO_RECOVERIES_PER_RUN + '. ' +
                'This can indicate the forum channel itself was recreated (new FORUM_CHANNEL_ID). ' +
                'NOT auto-reposting to avoid mass @everyone pings — use /flight recover manually.'
            );
            return;
        }

        var restored = 0;
        for (var j = 0; j < missing.length; j++) {
            var flight = missing[j];
            try {
                await recreateForumThread(client, flight, { ping: PING_ON_SELFHEAL });
                restored++;
                console.log('[ForumRecovery] Self-heal restored allocation post for ' + flight.flightNumber + '.');
                if (j < missing.length - 1) await delay(SELFHEAL_DELAY_MS);
            } catch (err) {
                console.error('[ForumRecovery] Self-heal failed to restore ' + flight.flightNumber + ':', err && err.message ? err.message : err);
            }
        }
        console.log('[ForumRecovery] Self-heal complete: ' + restored + '/' + missing.length + ' restored.');
    } catch (err) {
        console.error('[ForumRecovery] Self-heal run error:', err && err.message ? err.message : err);
    } finally {
        selfHealRunning = false;
    }
}

module.exports = {
    FLIGHT_TYPES: FLIGHT_TYPES,
    LIVE_STATUSES: LIVE_STATUSES,
    inspectThread: inspectThread,
    recreateForumThread: recreateForumThread,
    selfHealForumThreads: selfHealForumThreads,
};
