const {
    SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
var Flight = require('../models/Flight');
var { updateAllCalendars } = require('../utils/calendar');
var ids = require('../config/ids');

var pendingEnds = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('end')
        .setDescription('End a scheduled flight'),
    pendingEnds: pendingEnds,

    async execute(interaction) {
        var flights = await Flight.find({
            status: 'scheduled',
            dispatcherId: interaction.user.id,
        }).sort({ serverOpenTime: 1 });

        if (flights.length === 0) {
            return interaction.reply({ content: '\u274C You have no active flights to end. Only the dispatcher can end their flights.', ephemeral: true });
        }

        var options = flights.slice(0, 25).map(function(f) {
            var date = new Date(f.serverOpenTime * 1000);
            var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            var timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            var prefix = '';
            if (f.flightType === 'test') prefix = '[TEST] ';
            if (f.flightType === 'premium') prefix = '[PREMIUM] ';
            return {
                label: prefix + f.flightNumber + ' \u2014 ' + f.departure + ' \u27A1 ' + f.destination,
                description: dateStr + ' at ' + timeStr,
                value: f._id.toString(),
            };
        });

        var select = new StringSelectMenuBuilder()
            .setCustomId('end_flight')
            .setPlaceholder('Select the flight to end')
            .addOptions(options);

        await interaction.reply({
            content: 'Select the flight you want to end:',
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral: true,
        });
    },

    async handleFlightSelect(interaction) {
        var flightId = interaction.values[0];
        var flight = await Flight.findById(flightId);
        if (!flight || flight.status !== 'scheduled') {
            return interaction.update({ content: '\u274C Flight not found.', components: [] });
        }
        if (flight.dispatcherId !== interaction.user.id) {
            return interaction.update({ content: '\u274C Only the dispatcher can end this flight.', components: [] });
        }

        pendingEnds.set(interaction.user.id, flightId);

        var date = new Date(flight.serverOpenTime * 1000);
        var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        var timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        var row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('end_confirm').setLabel('End Flight').setStyle(ButtonStyle.Danger).setEmoji('\u2705'),
            new ButtonBuilder().setCustomId('end_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        await interaction.update({
            content: '\u26A0\uFE0F Are you sure you want to end **' + flight.flightNumber + '** (' + flight.departure + ' \u27A1 ' + flight.destination + ')?\n**Date:** ' + dateStr + ' at ' + timeStr + '\n\nThis will mark the flight as completed and remove it from all calendars.',
            components: [row],
        });
    },

    async handleConfirm(interaction) {
        var flightId = pendingEnds.get(interaction.user.id);
        if (!flightId) return interaction.update({ content: '\u274C Session expired.', components: [] });

        await interaction.deferUpdate();

        var flight = await Flight.findById(flightId);
        if (!flight || flight.status !== 'scheduled') {
            pendingEnds.delete(interaction.user.id);
            return interaction.editReply({ content: '\u274C Flight not found.', components: [] });
        }
        if (flight.dispatcherId !== interaction.user.id) {
            pendingEnds.delete(interaction.user.id);
            return interaction.editReply({ content: '\u274C Only the dispatcher can end this flight.', components: [] });
        }

        // Delete Discord scheduled event
        try {
            if (flight.discordEventId) {
                var servers = [ids.CALENDAR_SERVER_ID, ids.STAFF_SERVER_ID];
                for (var s = 0; s < servers.length; s++) {
                    var guild = interaction.client.guilds.cache.get(servers[s]);
                    if (guild) {
                        var event = await guild.scheduledEvents.fetch(flight.discordEventId).catch(function() { return null; });
                        if (event) {
                            await event.delete();
                            break;
                        }
                    }
                }
            }
        } catch (err) { console.error('[End] Event delete error:', err); }

        // Lock/archive the forum thread
        try {
            if (flight.forumThreadId) {
                var g = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
                var thread = g ? g.channels.cache.get(flight.forumThreadId) : null;
                if (!thread && g) thread = await g.channels.fetch(flight.forumThreadId).catch(function() { return null; });
                if (thread) {
                    await thread.setLocked(true).catch(function() {});
                    await thread.setArchived(true).catch(function() {});
                }
            }
        } catch (err) { console.error('[End] Thread error:', err); }

        flight.status = 'completed';
        flight.completedAt = new Date();
        await flight.save();

        try { await updateAllCalendars(interaction.client); } catch (err) { console.error('[End] Calendar error:', err); }

        pendingEnds.delete(interaction.user.id);
        await interaction.editReply({
            content: '\u2705 Flight **' + flight.flightNumber + '** (' + flight.departure + ' \u27A1 ' + flight.destination + ') has been completed.',
            components: [],
        });
    },

    async handleCancel(interaction) {
        pendingEnds.delete(interaction.user.id);
        await interaction.update({ content: '\u274C End flight cancelled.', components: [] });
    },
};
