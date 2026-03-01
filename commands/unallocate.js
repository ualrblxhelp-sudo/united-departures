const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
var Flight = require('../models/Flight');
var { buildFlightInfoEmbed, buildAllocationEmbed } = require('../utils/embed');
var ids = require('../config/ids');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unallocate')
        .setDescription('Remove yourself from a flight allocation'),

    async execute(interaction) {
        if (interaction.guildId !== '1309560657473179679') {
            return interaction.reply({ content: '\u274C This command can only be used in the United Volare server.', ephemeral: true });
        }
        var flights = await Flight.find({
            status: 'scheduled',
            'allocations.userId': interaction.user.id,
        }).sort({ serverOpenTime: 1 });

        if (flights.length === 0) {
            return interaction.reply({ content: '\u274C You are not allocated to any flights.', ephemeral: true });
        }

        var options = flights.slice(0, 25).map(function(f) {
            var alloc = f.allocations.find(function(a) { return a.userId === interaction.user.id; });
            var date = new Date(f.serverOpenTime * 1000);
            var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            var timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            var prefix = '';
            if (f.flightType === 'test') prefix = '[TEST] ';
            if (f.flightType === 'premium') prefix = '[PREMIUM] ';
            return {
                label: prefix + f.flightNumber + ' \u2014 ' + alloc.position,
                description: f.departure + ' \u27A1 ' + f.destination + ' \u2022 ' + dateStr + ' at ' + timeStr,
                value: f._id.toString(),
            };
        });

        var select = new StringSelectMenuBuilder()
            .setCustomId('unallocate_flight')
            .setPlaceholder('Select the flight to unallocate from')
            .addOptions(options);

        await interaction.reply({
            content: 'Select the flight you want to remove yourself from:',
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral: true,
        });
    },

    async handleFlightSelect(interaction) {
        var flightId = interaction.values[0];
        var flight = await Flight.findById(flightId);
        if (!flight || flight.status !== 'scheduled') return interaction.update({ content: '\u274C Flight not found.', components: [] });

        var allocIndex = flight.allocations.findIndex(function(a) { return a.userId === interaction.user.id; });
        if (allocIndex === -1) {
            return interaction.update({ content: '\u274C You are not allocated to this flight.', components: [] });
        }

        var removed = flight.allocations[allocIndex];
        flight.allocations.splice(allocIndex, 1);
        await flight.save();

        try {
            if (flight.forumThreadId && flight.forumMessageId) {
                var guild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
                var thread = guild ? guild.channels.cache.get(flight.forumThreadId) : null;
                if (!thread && guild) thread = await guild.channels.fetch(flight.forumThreadId).catch(function() { return null; });
                if (thread) {
                    var msg = await thread.messages.fetch(flight.forumMessageId).catch(function() { return null; });
                    if (msg) await msg.edit({ embeds: [buildFlightInfoEmbed(flight), buildAllocationEmbed(flight)] });
                }
            }
        } catch (err) { console.error('[Unallocate] Forum update error:', err); }

        await interaction.update({
            content: '\u2705 You have been removed as **' + removed.position + '** from flight **' + flight.flightNumber + '**.',
            components: [],
        });
    },
};
