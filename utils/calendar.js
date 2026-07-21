const { EmbedBuilder } = require('discord.js');
var Flight = require('../models/Flight');
var { buildFlightInfoEmbed, buildAllocationEmbed } = require('./embed');
var ids = require('../config/ids');

// Allocation threads live off the Volare calendar message. 7 days (10080 min)
// is the max auto-archive; editing the sheet on allocate/unallocate keeps it
// active, and recovery/self-heal can recreate it if it ever archives away.
var ALLOC_THREAD_AUTOARCHIVE = 10080;

var calendarMessageRef = null;
var staffCalendarRef = null;
var premiumCalendarRef = null;

function buildCalendarDescription(flights, skipHeader) {
    if (flights.length === 0) {
        if (skipHeader) return '*No flights currently scheduled.*';
        return '<:UnitedCurve:1297074894164463628> Below are scheduled, upcoming departures operated by United Airlines and its subsidiaries.\n\n*No flights currently scheduled.*';
    }
    var desc = skipHeader ? '' : '<:UnitedCurve:1297074894164463628> Below are scheduled, upcoming departures operated by United Airlines and its subsidiaries.\n\n';
    var todayStart = getTodayStartUnix();
    var todayEnd = todayStart + 86400;
    var todayFlights = flights.filter(function(f) { return f.serverOpenTime >= todayStart && f.serverOpenTime < todayEnd; });
    var upcomingFlights = flights.filter(function(f) { return f.serverOpenTime >= todayEnd; });
    var pastTodayFlights = flights.filter(function(f) { return f.serverOpenTime < todayStart; });

    if (todayFlights.length > 0) {
        var dateStr = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
        desc += '**Today (' + dateStr + '):**\n';
        for (var i = 0; i < todayFlights.length; i++) desc += formatFlightLine(todayFlights[i]);
        desc += '\n';
    }
    if (upcomingFlights.length > 0) {
        desc += '**Upcoming Flights:**\n';
        for (var j = 0; j < upcomingFlights.length; j++) desc += formatFlightLine(upcomingFlights[j]);
    }
    if (pastTodayFlights.length > 0 && todayFlights.length === 0 && upcomingFlights.length === 0) {
        desc += '**Scheduled Flights:**\n';
        for (var k = 0; k < pastTodayFlights.length; k++) desc += formatFlightLine(pastTodayFlights[k]);
    }
    return desc;
}

function formatFlightLine(flight) {
    var emoji = '<:UATail2:1076723231391744050>';
    var prefix = '';
    if (flight.flightType === 'test') {
        emoji = '<:e_structure:1397829560782946445>';
        prefix = '[TEST] ';
    }
    if (flight.flightType === 'premium') {
        emoji = '<:UnitedGlobalServices:1298320156342358088>';
        prefix = '';
    }
    return emoji + ' **' + prefix + flight.flightNumber + '** | ' + flight.departure + ' \u27A1 ' + flight.destination + ' | <t:' + flight.serverOpenTime + ':F>\n';
}

function getTodayStartUnix() {
    var now = new Date();
    return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
}

async function findOrCreateBotMessage(client, channel, ref, title) {
    if (ref) {
        try { await ref.edit({ content: '' }); return ref; } catch (e) {}
    }
    var recent = await channel.messages.fetch({ limit: 20 });
    var found = recent.find(function(m) {
        return m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title && m.embeds[0].title.includes(title);
    });
    return found || null;
}

// Main server calendar - REGULAR ONLY
async function updateCalendar(client) {
    try {
        var guild = client.guilds.cache.get(ids.CALENDAR_SERVER_ID);
        if (!guild) return;
        var channel = guild.channels.cache.get(ids.CALENDAR_CHANNEL_ID);
        if (!channel) return;

        var flights = await Flight.find({ status: 'scheduled', flightType: 'regular' }).sort({ serverOpenTime: 1 });
        var embed = new EmbedBuilder()
            .setTitle('<:e_plane:1397829563249328138> Scheduled Departures')
            .setColor(ids.EMBED_COLOR)
            .setDescription(buildCalendarDescription(flights))
            .setTimestamp()
            .setFooter({ text: 'United Airlines \u2022 Auto-updated' });

        calendarMessageRef = await findOrCreateBotMessage(client, channel, calendarMessageRef, 'Scheduled Departures');
        if (calendarMessageRef) {
            await calendarMessageRef.edit({ embeds: [embed] });
        } else {
            calendarMessageRef = await channel.send({ embeds: [embed] });
        }
    } catch (err) { console.error('[Calendar] Error:', err); }
}

// Staff calendar - ALL FLIGHTS (regular + premium + test)
async function updateStaffCalendar(client) {
    try {
        var guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
        if (!guild) return;
        var channel = guild.channels.cache.get(ids.STAFF_CALENDAR_CHANNEL_ID);
        if (!channel) return;

        var flights = await Flight.find({ status: 'scheduled' }).sort({ serverOpenTime: 1 });
        var embed = new EmbedBuilder()
            .setTitle('<:e_plane:1397829563249328138> Scheduled Departures')
            .setColor(ids.EMBED_COLOR)
            .setDescription(buildCalendarDescription(flights))
            .setTimestamp()
            .setFooter({ text: 'United Airlines \u2022 Auto-updated' });

        staffCalendarRef = await findOrCreateBotMessage(client, channel, staffCalendarRef, 'Scheduled Departures');
        if (staffCalendarRef) {
            await staffCalendarRef.edit({ embeds: [embed] });
        } else {
            staffCalendarRef = await channel.send({ embeds: [embed] });
        }
    } catch (err) { console.error('[StaffCalendar] Error:', err); }
}

// Premium calendar - PREMIUM ONLY
async function updatePremiumCalendar(client) {
    try {
        var guild = client.guilds.cache.get(ids.CALENDAR_SERVER_ID);
        if (!guild) return;
        var channel = guild.channels.cache.get(ids.PREMIUM_CALENDAR_CHANNEL_ID);
        if (!channel) return;

        var flights = await Flight.find({ status: 'scheduled', flightType: 'premium' }).sort({ serverOpenTime: 1 });
        var embed = new EmbedBuilder()
            .setTitle('<:e_plane:1397829563249328138> Premium Departures')
            .setColor(0x2596be)
            .setDescription('<:UnitedCurve:1297074894164463628> Below are scheduled, upcoming premium, private departures operated by United Airlines and its subsidiaries.\n\n' + (flights.length === 0 ? '*No flights currently scheduled.*' : buildCalendarDescription(flights, true)))
            .setTimestamp()
            .setFooter({ text: 'United Airlines \u2022 Premium Flights \u2022 Auto-updated' });

        premiumCalendarRef = await findOrCreateBotMessage(client, channel, premiumCalendarRef, 'Premium Departures');
        if (premiumCalendarRef) {
            await premiumCalendarRef.edit({ embeds: [embed] });
        } else {
            premiumCalendarRef = await channel.send({ embeds: [embed] });
        }
    } catch (err) { console.error('[PremiumCalendar] Error:', err); }
}

async function updateAllCalendars(client) {
    await updateCalendar(client);
    await updateStaffCalendar(client);
    await updatePremiumCalendar(client);
}

// Thread name format: "Flight Number - Route - Aircraft" (Discord caps at 100).
function buildAllocationThreadName(flight) {
    var route = flight.departure + '-' + flight.destination;
    var name = flight.flightNumber + ' - ' + route + ' - ' + flight.aircraft;
    return name.length > 100 ? name.slice(0, 100) : name;
}

// Resolve the Volare (staff) calendar channel, tolerating a cold cache.
async function getStaffCalendarChannel(client) {
    var guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
    if (!guild) return null;
    var channel = guild.channels.cache.get(ids.STAFF_CALENDAR_CHANNEL_ID);
    if (!channel) channel = await guild.channels.fetch(ids.STAFF_CALENDAR_CHANNEL_ID).catch(function() { return null; });
    return channel || null;
}

// Post a FRESH Volare calendar message and return it. Discord allows only one
// thread per message, so each flight gets its own reposted calendar message to
// spawn its allocation thread from. The newest repost becomes the live calendar
// (so /update edits it in place thereafter).
async function postStaffCalendarMessage(client) {
    var channel = await getStaffCalendarChannel(client);
    if (!channel) return null;
    var flights = await Flight.find({ status: 'scheduled' }).sort({ serverOpenTime: 1 });
    var embed = new EmbedBuilder()
        .setTitle('<:e_plane:1397829563249328138> Scheduled Departures')
        .setColor(ids.EMBED_COLOR)
        .setDescription(buildCalendarDescription(flights))
        .setTimestamp()
        .setFooter({ text: 'United Airlines \u2022 Auto-updated' });
    var msg = await channel.send({ embeds: [embed] });
    staffCalendarRef = msg;
    return msg;
}

// Create the allocation sheet as a THREAD hanging off a freshly-posted Volare
// calendar message. Returns { thread, starter } or null. Reused by /create,
// /flight recover, and startup self-heal so every path is identical.
async function postAllocationThread(client, flight, options) {
    options = options || {};
    var ping = options.ping !== false; // default: ping @everyone in the thread
    var calMsg = await postStaffCalendarMessage(client);
    if (!calMsg) return null;

    var infoEmbed = buildFlightInfoEmbed(flight);
    var allocEmbed = buildAllocationEmbed(flight);
    if (options.color) { infoEmbed.setColor(options.color); allocEmbed.setColor(options.color); }

    var thread = await calMsg.startThread({
        name: buildAllocationThreadName(flight),
        autoArchiveDuration: ALLOC_THREAD_AUTOARCHIVE,
    });
    var starter = await thread.send({
        content: ping ? '@everyone' : '\u200b',
        embeds: [infoEmbed, allocEmbed],
    });
    return { thread: thread, starter: starter };
}

async function announceNewFlight(client, flight) {
    try {
        var guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
        if (!guild) return;
        var channel = guild.channels.cache.get(ids.STAFF_CALENDAR_CHANNEL_ID);
        if (!channel) return;
        var prefix = '';
        if (flight.flightType === 'test') prefix = '**test** ';
        if (flight.flightType === 'premium') prefix = '**premium** ';
        await channel.send('@everyone A ' + prefix + 'flight has been scheduled. Allocate in the flight\'s allocation thread on the calendar above.');
    } catch (err) { console.error('[Announce] Error:', err); }
}

module.exports = {
    updateCalendar, updateStaffCalendar, updatePremiumCalendar, updateAllCalendars,
    announceNewFlight,
    getStaffCalendarChannel, postStaffCalendarMessage, postAllocationThread,
    buildAllocationThreadName,
};
