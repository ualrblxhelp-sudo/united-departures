const {
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, StringSelectMenuBuilder,
} = require('discord.js');
var Flight = require('../models/Flight');
var { buildFlightInfoEmbed, buildAllocationEmbed } = require('../utils/embed');
var { updateAllCalendars } = require('../utils/calendar');
var ids = require('../config/ids');

function parseTimestamp(input) {
    var match = input.match(/<t:(\d+)(?::[tTdDfFR])?>/);
    if (match) return parseInt(match[1]);
    var num = parseInt(input);
    if (!isNaN(num)) return num;
    return NaN;
}

var pendingEdits = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit')
        .setDescription('Edit an existing flight\'s details'),
    pendingEdits: pendingEdits,

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ids.FLIGHT_HOST_ROLE_ID)) {
            return interaction.reply({ content: '\u274C You need the Flight Host role.', ephemeral: true });
        }

        var flights = await Flight.find({ status: 'scheduled' }).sort({ serverOpenTime: 1 });
        if (flights.length === 0) {
            return interaction.reply({ content: '\u274C No scheduled flights to edit.', ephemeral: true });
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
            .setCustomId('edit_flight')
            .setPlaceholder('Select a flight to edit')
            .addOptions(options);

        await interaction.reply({
            content: 'Select the flight you want to edit:',
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

        pendingEdits.set(interaction.user.id, flightId);

        var modal = new ModalBuilder()
            .setCustomId('edit_modal')
            .setTitle('Edit ' + flight.flightNumber);

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('departure').setLabel('IATA Departure').setStyle(TextInputStyle.Short).setRequired(false).setValue(flight.departure).setMaxLength(4)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('destination').setLabel('IATA Destination').setStyle(TextInputStyle.Short).setRequired(false).setValue(flight.destination).setMaxLength(4)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('employee_join_time').setLabel('Employee Join Time (Unix timestamp)').setStyle(TextInputStyle.Short).setRequired(false).setValue(String(flight.employeeJoinTime))
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('server_open_time').setLabel('Server Open Time (Unix timestamp)').setStyle(TextInputStyle.Short).setRequired(false).setValue(String(flight.serverOpenTime))
            ),
        );

        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction) {
        var flightId = pendingEdits.get(interaction.user.id);
        if (!flightId) return interaction.reply({ content: '\u274C Session expired. Use `/edit` again.', ephemeral: true });

        var flight = await Flight.findById(flightId);
        if (!flight) return interaction.reply({ content: '\u274C Flight not found.', ephemeral: true });

        var departure = interaction.fields.getTextInputValue('departure').toUpperCase().trim();
        var destination = interaction.fields.getTextInputValue('destination').toUpperCase().trim();
        var ejRaw = interaction.fields.getTextInputValue('employee_join_time').trim();
        var soRaw = interaction.fields.getTextInputValue('server_open_time').trim();

        var changes = [];

        if (departure && /^[A-Z]{3}$/.test(departure) && departure !== flight.departure) {
            flight.departure = departure;
            changes.push('Departure \u2192 ' + departure);
        }
        if (destination && /^[A-Z]{3}$/.test(destination) && destination !== flight.destination) {
            flight.destination = destination;
            changes.push('Destination \u2192 ' + destination);
        }
        if (ejRaw) {
            var ej = parseTimestamp(ejRaw);
            if (ej !== flight.employeeJoinTime) {
                flight.employeeJoinTime = ej;
                changes.push('Staff Join \u2192 <t:' + ej + ':F>');
            }
        }
        if (soRaw) {
            var so = parseTimestamp(soRaw);
            if (so !== flight.serverOpenTime) {
                flight.serverOpenTime = so;
                changes.push('Server Open \u2192 <t:' + so + ':F>');
            }
        }

        if (changes.length === 0) {
            return interaction.reply({ content: '\u26A0\uFE0F No changes detected.', ephemeral: true });
        }

        await flight.save();

        // Update forum embed
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
        } catch (err) { console.error('[Edit] Forum error:', err); }

        try { await updateAllCalendars(interaction.client); } catch (err) { console.error('[Edit] Calendar error:', err); }

        pendingEdits.delete(interaction.user.id);
        await interaction.reply({
            content: '\u2705 Flight **' + flight.flightNumber + '** updated:\n' + changes.map(function(c) { return '\u2022 ' + c; }).join('\n'),
            ephemeral: true,
        });
    },
};
