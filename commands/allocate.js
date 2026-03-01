const {
    SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder,
} = require('discord.js');
var Flight = require('../models/Flight');
var { getPositionsForAircraft, DEPARTMENTS } = require('../config/aircraft');
var { buildFlightInfoEmbed, buildAllocationEmbed } = require('../utils/embed');
var ids = require('../config/ids');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('allocate')
        .setDescription('Allocate yourself to a position on a scheduled flight'),

    async execute(interaction) {
        if (interaction.guildId !== '1309560657473179679') {
            return interaction.reply({ content: '\u274C This command can only be used in the United Volare server.', ephemeral: true });
        }
        var flights = await Flight.find({ status: 'scheduled' }).sort({ serverOpenTime: 1 });
        if (flights.length === 0) {
            return interaction.reply({ content: '\u274C No scheduled flights available.', ephemeral: true });
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
            .setCustomId('allocate_flight')
            .setPlaceholder('Select a flight')
            .addOptions(options);

        await interaction.reply({
            content: '**Step 1/2** \u2014 Select the flight you want to allocate for:',
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

        var existingAlloc = flight.allocations.find(function(a) { return a.userId === interaction.user.id; });
        if (existingAlloc) {
            return interaction.update({
                content: '\u274C You are already allocated as **' + existingAlloc.position + '** on flight **' + flight.flightNumber + '**. Use `/unallocate` to remove yourself first.',
                components: [],
            });
        }

        var positions = getPositionsForAircraft(flight.aircraft);
        if (!positions) {
            return interaction.update({ content: '\u274C Unknown aircraft type.', components: [] });
        }

        var options = [];
        for (var d = 0; d < DEPARTMENTS.length; d++) {
            var dept = DEPARTMENTS[d];
            var entries = Object.entries(positions).filter(function(e) { return e[1].department === dept; });
            for (var i = 0; i < entries.length; i++) {
                var role = entries[i][0];
                var config = entries[i][1];
                var filled = flight.allocations.filter(function(a) { return a.position === role; }).length;
                var available = config.max - filled;
                if (available > 0) {
                    options.push({
                        label: role,
                        description: dept + ' \u2022 ' + filled + '/' + config.max + ' filled',
                        value: flightId + '::' + role,
                    });
                }
            }
        }

        if (options.length === 0) {
            return interaction.update({ content: '\u274C All positions on **' + flight.flightNumber + '** are filled.', components: [] });
        }

        var select = new StringSelectMenuBuilder()
            .setCustomId('allocate_position')
            .setPlaceholder('Select a position')
            .addOptions(options);

        await interaction.update({
            content: '**Step 2/2** \u2014 Select your position for **' + flight.flightNumber + '**:',
            components: [new ActionRowBuilder().addComponents(select)],
        });
    },

    async handlePositionSelect(interaction) {
        var parts = interaction.values[0].split('::');
        var flightId = parts[0];
        var position = parts[1];

        var flight = await Flight.findById(flightId);
        if (!flight || flight.status !== 'scheduled') return interaction.update({ content: '\u274C Flight not found.', components: [] });

        var positions = getPositionsForAircraft(flight.aircraft);
        var posConfig = positions ? positions[position] : null;
        if (!posConfig) return interaction.update({ content: '\u274C Invalid position.', components: [] });

        var filled = flight.allocations.filter(function(a) { return a.position === position; }).length;
        if (filled >= posConfig.max) {
            return interaction.update({ content: '\u274C **' + position + '** is now full on **' + flight.flightNumber + '**.', components: [] });
        }

        if (flight.allocations.find(function(a) { return a.userId === interaction.user.id; })) {
            return interaction.update({ content: '\u274C You are already allocated on **' + flight.flightNumber + '**.', components: [] });
        }

        flight.allocations.push({
            userId: interaction.user.id,
            username: interaction.user.username,
            position: position,
        });
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
        } catch (err) { console.error('[Allocate] Forum update error:', err); }

        await interaction.update({
            content: '\u2705 You have been allocated as **' + position + '** on flight **' + flight.flightNumber + '** (' + flight.departure + ' \u27A1 ' + flight.destination + '). Use `/unallocate` if you become unavailable.',
            components: [],
        });
    },
};
