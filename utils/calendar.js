// utils/calendar.js
const { EmbedBuilder } = require('discord.js');
const Flight = require('../models/Flight');
const ids = require('../config/ids');

let calendarMessageRef = null; // cached message reference

/**
 * Update the persistent flight calendar message in the calendar server.
 * Creates the message if it doesn't exist, edits it if it does.
 */
async function updateCalendar(client) {
    try {
        const guild = client.guilds.cache.get(ids.CALENDAR_SERVER_ID);
        if (!guild) {
            console.warn('[Calendar] Calendar server not found:', ids.CALENDAR_SERVER_ID);
            return;
        }

        const channel = guild.channels.cache.get(ids.CALENDAR_CHANNEL_ID);
        if (!channel) {
            console.warn('[Calendar] Calendar channel not found:', ids.CALENDAR_CHANNEL_ID);
            return;
        }

        // Get all scheduled flights sorted by server open time
        const flights = await Flight.find({ status: 'scheduled' }).sort({ serverOpenTime: 1 });

        // Build the embed
        const embed = new EmbedBuilder()
            .setTitle('📅 Scheduled Departures')
            .setColor(ids.EMBED_COLOR)
            .setDescription(buildCalendarDescription(flights))
            .setTimestamp()
            .setFooter({ text: 'United Airlines • Auto-updated' });

        // Try to find and edit existing message, or create new one
        let message = null;

        // First check if we have any flights with a stored calendar message ID
        const flightWithCalMsg = await Flight.findOne({ calendarMessageId: { $exists: true, $ne: null } });
        const storedMessageId = flightWithCalMsg?.calendarMessageId;

        if (calendarMessageRef) {
            // Use cached reference
            try {
                await calendarMessageRef.edit({ embeds: [embed] });
                return;
            } catch {
                calendarMessageRef = null;
            }
        }

        if (storedMessageId) {
            // Try to fetch stored message
            try {
                message = await channel.messages.fetch(storedMessageId);
                await message.edit({ embeds: [embed] });
                calendarMessageRef = message;
                return;
            } catch {
                // Message was deleted, create new one
            }
        }

        // Try to find existing bot message in recent messages
        const recentMessages = await channel.messages.fetch({ limit: 20 });
        const botMessage = recentMessages.find(
            m => m.author.id === client.user.id && m.embeds.length > 0
                && m.embeds[0].title === '📅 Scheduled Departures'
        );

        if (botMessage) {
            await botMessage.edit({ embeds: [embed] });
            calendarMessageRef = botMessage;
            // Store the message ID on all flights
            await Flight.updateMany(
                { status: 'scheduled' },
                { calendarMessageId: botMessage.id }
            );
        } else {
            // Create new message
            const newMsg = await channel.send({ embeds: [embed] });
            calendarMessageRef = newMsg;
            await Flight.updateMany(
                { status: 'scheduled' },
                { calendarMessageId: newMsg.id }
            );
        }
    } catch (err) {
        console.error('[Calendar] Error updating calendar:', err);
    }
}

/**
 * Build the description text for the calendar embed
 */
function buildCalendarDescription(flights) {
    if (flights.length === 0) {
        return 'Below are the upcoming departures from United Airlines:\n\n*No flights currently scheduled.*';
    }

    let desc = 'Below are the upcoming departures from United Airlines:\n\n';

    const now = Math.floor(Date.now() / 1000);
    const todayStart = getTodayStartUnix();
    const todayEnd = todayStart + 86400;

    // Split into today and upcoming
    const todayFlights = flights.filter(f => f.serverOpenTime >= todayStart && f.serverOpenTime < todayEnd);
    const upcomingFlights = flights.filter(f => f.serverOpenTime >= todayEnd);
    const pastTodayFlights = flights.filter(f => f.serverOpenTime < todayStart);

    // Today's flights
    if (todayFlights.length > 0) {
        const dateStr = new Date().toLocaleDateString('en-US', {
            month: '2-digit', day: '2-digit', year: 'numeric'
        });
        desc += `**Today (${dateStr}):**\n`;
        for (const f of todayFlights) {
            desc += formatFlightLine(f);
        }
        desc += '\n';
    }

    // Upcoming flights
    if (upcomingFlights.length > 0) {
        desc += '**Upcoming Flights:**\n';
        for (const f of upcomingFlights) {
            desc += formatFlightLine(f);
        }
    }

    // Past flights still scheduled (shouldn't normally happen, but handle gracefully)
    if (pastTodayFlights.length > 0 && todayFlights.length === 0 && upcomingFlights.length === 0) {
        desc += '**Scheduled Flights:**\n';
        for (const f of pastTodayFlights) {
            desc += formatFlightLine(f);
        }
    }

    return desc;
}

function formatFlightLine(flight) {
    const emoji = process.env.UNITED_TAIL_EMOJI || '✈️';
    const route = `${flight.departure} ➜ ${flight.destination}`;
    return `${emoji} **${flight.flightNumber}** | ${route} | <t:${flight.serverOpenTime}:F>\n`;
}

function getTodayStartUnix() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor(todayStart.getTime() / 1000);
}

module.exports = { updateCalendar };
