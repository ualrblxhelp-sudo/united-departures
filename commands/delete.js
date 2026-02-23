// commands/delete.js
const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} = require('discord.js');
const Flight = require('../models/Flight');
const { buildArchiveEmbed, buildAllocationEmbed } = require('../utils/embed');
const { updateCalendar, updateStaffCalendar } = require('../utils/calendar');const ids = require('../config/ids');
const pendingDeletes = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delete')
        .setDescription('Delete a scheduled flight and archive its allocation sheet')
        .addStringOption(opt =>
            opt.setName('flight_number')
                .setDescription('The flight number to delete')
                .setRequired(true)
        ),
    pendingDeletes,

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ids.FLIGHT_HOST_ROLE_ID)) {
            return interaction.reply({ content: '❌ You need the Flight Host role.', flags: [4096] });
        }

        const flightNumber = interaction.options.getString('flight_number').toUpperCase().trim();
        const flight = await Flight.findOne({ flightNumber, status: 'scheduled' });
        if (!flight) {
            return interaction.reply({ content: `❌ Flight **${flightNumber}** not found.`, flags: [4096] });
        }

        pendingDeletes.set(interaction.user.id, flightNumber);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('delete_confirm').setLabel('Confirm Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
            new ButtonBuilder().setCustomId('delete_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        const allocCount = flight.allocations.length;

        await interaction.reply({
            content: `⚠️ Are you sure you want to delete flight **${flightNumber}** (${flight.departure} ➜ ${flight.destination})?\n\nThis flight has **${allocCount}** allocated crew member(s). The allocation sheet will be archived.`,
            components: [row],
            flags: [4096],
        });
    },

    async handleConfirm(interaction) {
        const flightNumber = pendingDeletes.get(interaction.user.id);
        if (!flightNumber) return interaction.update({ content: '❌ Session expired.', components: [] });

        await interaction.deferUpdate();

        const flight = await Flight.findOne({ flightNumber, status: 'scheduled' });
        if (!flight) {
            pendingDeletes.delete(interaction.user.id);
            return interaction.editReply({ content: '❌ Flight not found.', components: [] });
        }

        // Archive to archive channel
        try {
            const guild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
            const archiveChannel = guild?.channels.cache.get(ids.ARCHIVE_CHANNEL_ID)
                || await guild?.channels.fetch(ids.ARCHIVE_CHANNEL_ID).catch(() => null);

            if (archiveChannel) {
                const { archiveEmbed, allocationEmbed } = buildArchiveEmbed(flight);
                await archiveChannel.send({ embeds: [archiveEmbed, allocationEmbed] });
            }
        } catch (err) { console.error('[Delete] Archive error:', err); }

        // Lock/archive the forum thread
        try {
            if (flight.forumThreadId) {
                const guild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
                const thread = guild?.channels.cache.get(flight.forumThreadId)
                    || await guild?.channels.fetch(flight.forumThreadId).catch(() => null);
                if (thread) {
                    await thread.setLocked(true).catch(() => {});
                    await thread.setArchived(true).catch(() => {});
                }
            }
        } catch (err) { console.error('[Delete] Thread archive error:', err); }
        
        // Delete Discord scheduled event (check both servers)
        try {
            if (flight.discordEventId) {
                var servers = [ids.CALENDAR_SERVER_ID, ids.STAFF_SERVER_ID];
                for (var s = 0; s < servers.length; s++) {
                    var guild = interaction.client.guilds.cache.get(servers[s]);
                    if (guild) {
                        var event = await guild.scheduledEvents.fetch(flight.discordEventId).catch(function() { return null; });
                        if (event) {
                            await event.delete();
                            console.log('[Delete] Discord event deleted from server ' + servers[s]);
                            break;
                        }
                    }
                }
            }
        } catch (err) { console.error('[Delete] Event delete error:', err); }

        // Mark as cancelled in DB
        flight.status = 'cancelled';
        // Mark as cancelled in DB
        flight.status = 'cancelled';
        flight.archivedAt = new Date();
        await flight.save();

        // Update calendar
        try { await updateCalendar(interaction.client); } catch (err) { console.error('[Delete] Calendar error:', err); }
        try { await updateStaffCalendar(interaction.client); } catch (err) { console.error('[Delete] Staff calendar error:', err); }
        pendingDeletes.delete(interaction.user.id);
        await interaction.editReply({
            content: `✅ Flight **${flightNumber}** has been deleted and archived.`,
            components: [],
        });
    },

    async handleCancel(interaction) {
        pendingDeletes.delete(interaction.user.id);
        await interaction.update({ content: '❌ Delete cancelled.', components: [] });
    },
};
