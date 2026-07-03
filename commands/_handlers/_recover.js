const {
    SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
var Flight = require('../../models/Flight');
var { inspectThread, recreateForumThread, LIVE_STATUSES } = require('../../utils/forumRecovery');
var ids = require('../../config/ids');

var pendingRecovers = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('recover')
        .setDescription('Recreate a deleted flight allocation post from stored data'),
    pendingRecovers: pendingRecovers,

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ids.FLIGHT_HOST_ROLE_ID)) {
            return interaction.reply({ content: '\u274C You need the Flight Host role.', ephemeral: true });
        }

        var flights = await Flight.find({ status: { $in: LIVE_STATUSES } }).sort({ serverOpenTime: 1 });
        if (flights.length === 0) {
            return interaction.reply({ content: '\u274C No active flights to recover.', ephemeral: true });
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
            .setCustomId('recover_flight')
            .setPlaceholder('Select the flight whose post was deleted')
            .addOptions(options);

        await interaction.reply({
            content: 'Select the flight whose allocation post you want to recover:',
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral: true,
        });
    },

    async handleFlightSelect(interaction) {
        var flightId = interaction.values[0];
        var flight = await Flight.findById(flightId);
        if (!flight || LIVE_STATUSES.indexOf(flight.status) === -1) {
            return interaction.update({ content: '\u274C Flight not found.', components: [] });
        }

        var state = await inspectThread(interaction.client, flight);

        if (state === 'live') {
            return interaction.update({
                content: '\u2139\uFE0F The allocation post for **' + flight.flightNumber + '** still exists in <#' + ids.FORUM_CHANNEL_ID + '> \u2014 nothing to recover. (If you want a fresh one, delete the current post first, then run `/flight recover` again.)',
                components: [],
            });
        }
        if (state === 'archived') {
            return interaction.update({
                content: '\u2139\uFE0F The post for **' + flight.flightNumber + '** still exists but is archived. I won\u2019t create a duplicate. Un-archive the existing thread instead, or delete it first if you want a fresh one.',
                components: [],
            });
        }
        if (state === 'unknown') {
            return interaction.update({
                content: '\u26A0\uFE0F Couldn\u2019t verify the post for **' + flight.flightNumber + '** right now (temporary Discord/cache issue). Please try again in a moment.',
                components: [],
            });
        }

        // state === 'missing' -> safe to recreate
        pendingRecovers.set(interaction.user.id, flightId);

        var row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('recover_confirm').setLabel('Recover Post').setStyle(ButtonStyle.Success).setEmoji({ id: '1408484391348605069', name: 'volare_check' }),
            new ButtonBuilder().setCustomId('recover_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        await interaction.update({
            content: '\u2705 The allocation post for **' + flight.flightNumber + '** (' + flight.departure + ' \u27A1 ' + flight.destination + ') is gone. I\u2019ll recreate it from stored data with its **' + flight.allocations.length + '** current allocation(s).\n\n\u26A0\uFE0F This posts a new thread in <#' + ids.FORUM_CHANNEL_ID + '> and pings **@everyone**. Any chat messages from the old thread can\u2019t be restored.',
            components: [row],
        });
    },

    async handleConfirm(interaction) {
        var flightId = pendingRecovers.get(interaction.user.id);
        if (!flightId) return interaction.update({ content: '\u274C Session expired.', components: [] });

        await interaction.deferUpdate();

        var flight = await Flight.findById(flightId);
        if (!flight || LIVE_STATUSES.indexOf(flight.status) === -1) {
            pendingRecovers.delete(interaction.user.id);
            return interaction.editReply({ content: '\u274C Flight not found.', components: [] });
        }

        // Re-check right before acting, in case the post reappeared or another
        // recover already ran (prevents a duplicate @everyone post).
        var state = await inspectThread(interaction.client, flight);
        if (state === 'live' || state === 'archived') {
            pendingRecovers.delete(interaction.user.id);
            return interaction.editReply({
                content: '\u2139\uFE0F The post for **' + flight.flightNumber + '** already exists again \u2014 skipped to avoid a duplicate.',
                components: [],
            });
        }
        if (state === 'unknown') {
            pendingRecovers.delete(interaction.user.id);
            return interaction.editReply({
                content: '\u26A0\uFE0F Couldn\u2019t verify the post state just now. Nothing was created. Please try `/flight recover` again shortly.',
                components: [],
            });
        }

        try {
            var thread = await recreateForumThread(interaction.client, flight, { ping: true });
            pendingRecovers.delete(interaction.user.id);
            await interaction.editReply({
                content: '<:volare_check:1408484391348605069> Recovered the allocation post for **' + flight.flightNumber + '** \u2014 <#' + thread.id + '>. Allocations are intact and `/allocate` / `/unallocate` now point at the new post.',
                components: [],
            });
        } catch (err) {
            console.error('[Recover] Recreate error:', err);
            pendingRecovers.delete(interaction.user.id);
            await interaction.editReply({
                content: '\u274C Failed to recreate the post: ' + (err && err.message ? err.message : 'unknown error') + '. The flight data is untouched \u2014 you can try again.',
                components: [],
            });
        }
    },

    async handleCancel(interaction) {
        pendingRecovers.delete(interaction.user.id);
        await interaction.update({ content: '\u274C Recovery cancelled.', components: [] });
    },
};
