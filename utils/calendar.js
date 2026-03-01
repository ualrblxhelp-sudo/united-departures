const { EmbedBuilder } = require('discord.js');
var Flight = require('../models/Flight');
var ids = require('../config/ids');

var calendarMessageRef = null;
var staffCalendarRef = null;
var premiumCalendarRef = null;

function buildCalendarDescription(flights, skipHeader) {
    if (flights.length === 0) {
        if (skipHeader) return '*No flights currently scheduled.*';
        return '<:UnitedCurve:1297074894164463628> Below are scheduled, upcoming departures operated by United Airlines and its subsidiaries.\n\n*No flights currently scheduled.*';
    }
    var desc = skipHeader ? '' : '<:UnitedCurve:1297074894164463628> Below are scheduled, upcoming departures operated by United Airlines and its subsidiaries.\n\n';
    var now = Math.floor(Date.now() / 1000);
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
    if (flight.flightType === 'test') prefix = '[TEST] ';
    if (flight.flightType === 'premium') prefix = '\u2B50 ';
    return emoji + ' **' + prefix + flight.flightNumber + '** | ' + flight.departure + ' \u27A1 ' + flight.destination + ' | <t:' + flight.serverOpenTime + ':F>\n';
}

function getTodayStartUnix() {
    var now = new Date();
    return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
}

async function findOrCreateBotMessage(client, channel, ref, title) {
    if (ref) {
        try { await ref.edit({ content: '' }); return ref; } catch (e) { /* message deleted */ }
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
            .setTitle('<:e_plane:1397829563249328138> Premium Departures')
            .setColor(0x2596be)
            .setDescription('<:UnitedCurve:1297074894164463628> Below are scheduled, upcoming premium, private departures operated by United Airlines and its subsidiaries.\n\n' + (flights.length === 0 ? '*No flights currently scheduled.*' : buildCalendarDescription(flights, true)))
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
        var guild = client.guilds.cache.get(ids.CALENDAR_SERVER_ID);
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
            .setTitle('\u2B50 Premium Departures')
            .setColor(0xDAA520)
            .setDescription(buildCalendarDescription(flights))
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

async function announceNewFlight(client, flight) {
    try {
        var guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
        if (!guild) return;
        var channel = guild.channels.cache.get(ids.STAFF_CALENDAR_CHANNEL_ID);
        if (!channel) return;
        var prefix = '';
        if (flight.flightType === 'test') prefix = '**test** ';
        if (flight.flightType === 'premium') prefix = '**premium** ';
        await channel.send('@everyone A ' + prefix + 'flight has been scheduled. You may allocate accordingly in the <#' + ids.FORUM_CHANNEL_ID + '> forum.');
    } catch (err) { console.error('[Announce] Error:', err); }
}

module.exports = { updateCalendar, updateStaffCalendar, updatePremiumCalendar, updateAllCalendars, announceNewFlight };
