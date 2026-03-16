const {
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
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
            var dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
            var timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
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

        pendingEdits.set(interaction.user.id, { flightId: flightId });

        var select = new StringSelectMenuBuilder()
            .setCustomId('edit_action')
            .setPlaceholder('What do you want to edit?')
            .addOptions([
                { label: 'Edit Flight Details', value: 'details', description: 'Route, timestamps' },
                { label: 'Transfer Dispatcher', value: 'transfer', description: 'Hand off to another flight host' },
                { label: 'Force Unallocate Crew', value: 'unallocate', description: 'Remove a crew member' },
            ]);

        await interaction.update({
            content: 'Editing **' + flight.flightNumber + '** (' + flight.departure + ' \u27A1 ' + flight.destination + ')\nSelect what you want to do:',
            components: [new ActionRowBuilder().addComponents(select)],
        });
    },

    // Action select
    async handleActionSelect(interaction) {modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('flight_number').setLabel('Flight Number').setStyle(TextInputStyle.Short).setRequired(false).setValue(flight.flightNumber).setMaxLength(10)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('departure').setLabel('IATA Departure').setStyle(TextInputStyle.Short).setRequired(false).setValue(flight.departure).setMaxLength(4)
                ),
        var pending = pendingEdits.get(interaction.user.id);
        if (!pending) return interaction.update({ content: '\u274C Session expired. Use `/edit` again.', components: [] });

        var action = interaction.values[0];
        var flight = await Flight.findById(pending.flightId);
        if (!flight || flight.status !== 'scheduled') {
            return interaction.update({ content: '\u274C Flight not found.', components: [] });
        }

        if (action === 'details') {
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
                    new TextInputBuilder().setCustomId('employee_join_time').setLabel('Employee Join Time').setStyle(TextInputStyle.Short).setRequired(false).setValue(String(flight.employeeJoinTime)).setPlaceholder('e.g. <t:1772089560:f> or 1772089560')
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('server_open_time').setLabel('Server Open Time').setStyle(TextInputStyle.Short).setRequired(false).setValue(String(flight.serverOpenTime)).setPlaceholder('e.g. <t:1772089560:f> or 1772089560')
                ),
            );
            return interaction.showModal(modal);
        }

        if (action === 'transfer') {
            var modal = new ModalBuilder()
                .setCustomId('edit_transfer_modal')
                .setTitle('Transfer Dispatcher');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('new_dispatcher').setLabel('New Dispatcher (User ID or @mention)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 123456789012345678 or <@123456789012345678>')
                ),
            );
            return interaction.showModal(modal);
        }

        if (action === 'unallocate') {
            if (flight.allocations.length === 0) {
                return interaction.update({ content: '\u274C No crew allocated to this flight.', components: [] });
            }

            var options = flight.allocations.map(function(a, idx) {
                return {
                    label: a.username + ' \u2014 ' + a.position,
                    value: idx.toString(),
                };
            });

            var select = new StringSelectMenuBuilder()
                .setCustomId('edit_unallocate_crew')
                .setPlaceholder('Select crew member to remove')
                .addOptions(options);

            return interaction.update({
                content: 'Select the crew member to remove from **' + flight.flightNumber + '**:',
                components: [new ActionRowBuilder().addComponents(select)],
            });
        }
    },

    // Transfer dispatcher modal
    async handleTransferModal(interaction) {
        var pending = pendingEdits.get(interaction.user.id);
        if (!pending) return interaction.reply({ content: '\u274C Session expired.', ephemeral: true });

        var flight = await Flight.findById(pending.flightId);
        if (!flight) return interaction.reply({ content: '\u274C Flight not found.', ephemeral: true });

        var raw = interaction.fields.getTextInputValue('new_dispatcher').trim();
        var match = raw.match(/(\d{17,20})/);
        if (!match) {
            return interaction.reply({ content: '\u274C Invalid user ID. Use a numeric ID or @mention.', ephemeral: true });
        }
        var newId = match[1];

        var guild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
        var member = null;
        if (guild) {
            member = await guild.members.fetch(newId).catch(function() { return null; });
        }
        if (!member) {
            return interaction.reply({ content: '\u274C User not found in the server.', ephemeral: true });
        }

        var oldDispatcher = flight.dispatcherId;
        flight.dispatcherId = newId;
        flight.dispatcherUsername = member.user.username;
        await flight.save();

        // Update forum embed
        try {
            if (flight.forumThreadId && flight.forumMessageId) {
                var thread = guild.channels.cache.get(flight.forumThreadId);
                if (!thread) thread = await guild.channels.fetch(flight.forumThreadId).catch(function() { return null; });
                if (thread) {
                    var msg = await thread.messages.fetch(flight.forumMessageId).catch(function() { return null; });
                    if (msg) await msg.edit({ embeds: [buildFlightInfoEmbed(flight), buildAllocationEmbed(flight)] });
                }
            }
        } catch (err) { console.error('[Edit] Transfer forum error:', err); }

        pendingEdits.delete(interaction.user.id);
        await interaction.reply({
            content: '<:volare_check:1408484391348605069> Dispatcher for **' + flight.flightNumber + '** transferred from <@' + oldDispatcher + '> to <@' + newId + '>.',
            ephemeral: true,
        });
    },

    // Force unallocate crew select
    async handleUnallocateCrew(interaction) {
        var pending = pendingEdits.get(interaction.user.id);
        if (!pending) return interaction.update({ content: '\u274C Session expired.', components: [] });

        var flight = await Flight.findById(pending.flightId);
        if (!flight) return interaction.update({ content: '\u274C Flight not found.', components: [] });

        var idx = parseInt(interaction.values[0]);
        var removed = flight.allocations[idx];
        if (!removed) return interaction.update({ content: '\u274C Crew member not found.', components: [] });

        pending.removeIndex = idx;
        pending.removedUser = removed;
        pendingEdits.set(interaction.user.id, pending);

        var row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('edit_replace_yes').setLabel('Replace with someone').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('edit_replace_no').setLabel('Just remove').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('edit_replace_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        await interaction.update({
            content: 'Removing **' + removed.username + '** (' + removed.position + ') from **' + flight.flightNumber + '**.\n\nDo you want to replace them with someone else?',
            components: [row],
        });
    },

    // Replace yes — show modal for replacement user
    async handleReplaceYes(interaction) {
        var pending = pendingEdits.get(interaction.user.id);
        if (!pending || !pending.removedUser) return interaction.update({ content: '\u274C Session expired.', components: [] });

        var modal = new ModalBuilder()
            .setCustomId('edit_replace_modal')
            .setTitle('Replace ' + pending.removedUser.username);
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('replacement_user').setLabel('Replacement User (ID or @mention)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. 123456789012345678 or <@123456789012345678>')
            ),
        );
        await interaction.showModal(modal);
    },

    // Replace modal submit
    async handleReplaceModal(interaction) {
        var pending = pendingEdits.get(interaction.user.id);
        if (!pending || !pending.removedUser) return interaction.reply({ content: '\u274C Session expired.', ephemeral: true });

        var flight = await Flight.findById(pending.flightId);
        if (!flight) return interaction.reply({ content: '\u274C Flight not found.', ephemeral: true });

        var raw = interaction.fields.getTextInputValue('replacement_user').trim();
        var match = raw.match(/(\d{17,20})/);
        if (!match) return interaction.reply({ content: '\u274C Invalid user ID.', ephemeral: true });
        var newId = match[1];

        var guild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
        var member = null;
        if (guild) member = await guild.members.fetch(newId).catch(function() { return null; });
        if (!member) return interaction.reply({ content: '\u274C User not found in the server.', ephemeral: true });

        if (flight.allocations.find(function(a) { return a.userId === newId; })) {
            return interaction.reply({ content: '\u274C That user is already allocated on this flight.', ephemeral: true });
        }

        var removed = flight.allocations[pending.removeIndex];
        if (!removed) return interaction.reply({ content: '\u274C Crew member already removed.', ephemeral: true });

        var position = removed.position;
        var oldUsername = removed.username;
        flight.allocations.splice(pending.removeIndex, 1);
        flight.allocations.push({
            userId: newId,
            username: member.user.username,
            position: position,
        });
        await flight.save();

        await updateForumEmbed(interaction.client, flight);

        pendingEdits.delete(interaction.user.id);
        await interaction.reply({
            content: '<:volare_check:1408484391348605069> Removed **' + oldUsername + '** and replaced with **' + member.user.username + '** as **' + position + '** on **' + flight.flightNumber + '**.',
            ephemeral: true,
        });
    },

    // Just remove — no replacement
    async handleReplaceNo(interaction) {
        var pending = pendingEdits.get(interaction.user.id);
        if (!pending || !pending.removedUser) return interaction.update({ content: '\u274C Session expired.', components: [] });

        var flight = await Flight.findById(pending.flightId);
        if (!flight) return interaction.update({ content: '\u274C Flight not found.', components: [] });

        var removed = flight.allocations[pending.removeIndex];
        if (!removed) return interaction.update({ content: '\u274C Already removed.', components: [] });

        var oldUsername = removed.username;
        var position = removed.position;
        flight.allocations.splice(pending.removeIndex, 1);
        await flight.save();

        await updateForumEmbed(interaction.client, flight);

        pendingEdits.delete(interaction.user.id);
        await interaction.update({
            content: '<:volare_check:1408484391348605069> Removed **' + oldUsername + '** (' + position + ') from **' + flight.flightNumber + '**.',
            components: [],
        });
    },

    // Cancel
    async handleReplaceCancel(interaction) {
        pendingEdits.delete(interaction.user.id);
        await interaction.update({ content: '\u274C Cancelled.', components: [] });
    },

    // Edit details modal submit
    async handleModalSubmit(interaction) {
        var pending = pendingEdits.get(interaction.user.id);
        if (!pending) return interaction.reply({ content: '\u274C Session expired. Use `/edit` again.', ephemeral: true });

        var flight = await Flight.findById(pending.flightId);
        if (!flight) return interaction.reply({ content: '\u274C Flight not found.', ephemeral: true });

        var flightNumber = interaction.fields.getTextInputValue('flight_number').toUpperCase().trim();
        var departure = interaction.fields.getTextInputValue('departure').toUpperCase().trim();
        var destination = interaction.fields.getTextInputValue('destination').toUpperCase().trim();
        var ejRaw = interaction.fields.getTextInputValue('employee_join_time').trim();
        var soRaw = interaction.fields.getTextInputValue('server_open_time').trim();

        var changes = [];

        if (flightNumber && flightNumber !== flight.flightNumber) {
            flight.flightNumber = flightNumber;
            changes.push('Flight Number \u2192 ' + flightNumber);
        }
        
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
            if (!isNaN(ej) && ej !== flight.employeeJoinTime) {
                flight.employeeJoinTime = ej;
                changes.push('Staff Join \u2192 <t:' + ej + ':F>');
            }
        }
        if (soRaw) {
            var so = parseTimestamp(soRaw);
            if (!isNaN(so) && so !== flight.serverOpenTime) {
                flight.serverOpenTime = so;
                changes.push('Server Open \u2192 <t:' + so + ':F>');
            }
        }

        if (changes.length === 0) {
            return interaction.reply({ content: '\u26A0\uFE0F No changes detected.', ephemeral: true });
        }

        await flight.save();
        await updateForumEmbed(interaction.client, flight);

        try { await updateAllCalendars(interaction.client); } catch (err) { console.error('[Edit] Calendar error:', err); }

        pendingEdits.delete(interaction.user.id);
        await interaction.reply({
            content: '<:volare_check:1408484391348605069> Flight **' + flight.flightNumber + '** updated:\n' + changes.map(function(c) { return '\u2022 ' + c; }).join('\n'),
            ephemeral: true,
        });
    },
};

async function updateForumEmbed(client, flight) {
    try {
        if (!flight.forumThreadId || !flight.forumMessageId) return;
        var guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
        var thread = guild ? guild.channels.cache.get(flight.forumThreadId) : null;
        if (!thread && guild) thread = await guild.channels.fetch(flight.forumThreadId).catch(function() { return null; });
        if (!thread) return;
        var msg = await thread.messages.fetch(flight.forumMessageId).catch(function() { return null; });
        if (msg) await msg.edit({ embeds: [buildFlightInfoEmbed(flight), buildAllocationEmbed(flight)] });
    } catch (err) { console.error('[Edit] Forum update error:', err); }
}
