const {
    SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
var Flight = require('../models/Flight');
var { buildArchiveEmbed } = require('../utils/embed');
var { updateAllCalendars } = require('../utils/calendar');
var ids = require('../config/ids');

var pendingDeletes = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delete')
        .setDescription('Delete a scheduled flight and archive its allocation sheet'),
    pendingDeletes: pendingDeletes,

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ids.FLIGHT_HOST_ROLE_ID)) {
            return interaction.reply({ content: '\u274C You need the Flight Host role.', flags: [4096] });
        }

        var flights = await Flight.find({ status: 'scheduled' }).sort({ serverOpenTime: 1 });
        if (flights.length === 0) {
            return interaction.reply({ content: '\u274C No scheduled flights to delete.', flags: [4096] });
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
            .setCustomId('delete_flight')
            .setPlaceholder('Select a flight to delete')
            .addOptions(options);

        await interaction.reply({
            content: 'Select the flight you want to delete:',
            components: [new ActionRowBuilder().addComponents(select)],
            flags: [4096],
        });
    },

    async handleFlightSelect(interaction) {
        var flightId = interaction.values[0];
        var flight = await Flight.findById(flightId);
        if (!flight || flight.status !== 'scheduled') {
            return interaction.update({ content: '\u274C Flight not found.', components: [] });
        }

        pendingDeletes.set(interaction.user.id, flightId);

        var date = new Date(flight.serverOpenTime * 1000);
        var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        var timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        var allocCount = flight.allocations.length;

        var row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('delete_confirm').setLabel('Confirm Delete').setStyle(ButtonStyle.Danger).setEmoji('\uD83D\uDDD1\uFE0F'),
            new ButtonBuilder().setCustomId('delete_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        await interaction.update({
            content: '\u26A0\uFE0F Are you sure you want to delete **' + flight.flightNumber + '** (' + flight.departure + ' \u27A1 ' + flight.destination + ')?\n**Date:** ' + dateStr + ' at ' + timeStr + '\nThis flight has **' + allocCount + '** allocated crew member(s). The allocation sheet will be archived.',
            components: [row],
        });
    },

    async handleConfirm(interaction) {
        var flightId = pendingDeletes.get(interaction.user.id);
        if (!flightId) return interaction.update({ content: '\u274C Session expired.', components: [] });

        await interaction.deferUpdate();

        var flight = await Flight.findById(flightId);
        if (!flight || flight.status !== 'scheduled') {
            pendingDeletes.delete(interaction.user.id);
            return interaction.editReply({ content: '\u274C Flight not found.', components: [] });
        }

        // Archive
        try {
            var guild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
            var archiveChannel = guild ? guild.channels.cache.get(ids.ARCHIVE_CHANNEL_ID) : null;
            if (!archiveChannel && guild) archiveChannel = await guild.channels.fetch(ids.ARCHIVE_CHANNEL_ID).catch(function() { return null; });
            if (archiveChannel) {
                var result = buildArchiveEmbed(flight);
                await archiveChannel.send({ embeds: [result.archiveEmbed, result.allocationEmbed] });
            }
        } catch (err) { console.error('[Delete] Archive error:', err); }

        // Lock thread
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
        } catch (err) { console.error('[Delete] Thread error:', err); }

        // Delete Discord event (check both servers)
        try {
            if (flight.discordEventId) {
                var servers = [ids.CALENDAR_SERVER_ID, ids.STAFF_SERVER_ID];
                for (var s = 0; s < servers.length; s++) {
                    var evGuild = interaction.client.guilds.cache.get(servers[s]);
                    if (evGuild) {
                        var event = await evGuild.scheduledEvents.fetch(flight.discordEventId).catch(function() { return null; });
                        if (event) {
                            await event.delete();
                            break;
                        }
                    }
                }
            }
        } catch (err) { console.error('[Delete] Event error:', err); }

        flight.status = 'cancelled';
        flight.archivedAt = new Date();
        await flight.save();

        try { await updateAllCalendars(interaction.client); } catch (err) { console.error('[Delete] Calendar error:', err); }

        pendingDeletes.delete(interaction.user.id);
        await interaction.editReply({
            content: '\u2705 Flight **' + flight.flightNumber + '** has been deleted and archived.',
            components: [],
        });
    },

    async handleCancel(interaction) {
        pendingDeletes.delete(interaction.user.id);
        await interaction.update({ content: '\u274C Delete cancelled.', components: [] });
    },
};
