// commands/unallocate.js
const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const Flight = require('../models/Flight');
const { buildFlightInfoEmbed, buildAllocationEmbed } = require('../utils/embed');
const ids = require('../config/ids');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unallocate')
        .setDescription('Remove yourself from a flight allocation'),

    async execute(interaction) {
        // Find flights where this user is allocated
        const flights = await Flight.find({
            status: 'scheduled',
            'allocations.userId': interaction.user.id,
        }).sort({ serverOpenTime: 1 });

        if (flights.length === 0) {
            return interaction.reply({ content: '❌ You are not allocated to any flights.', ephemeral: true });
        }

        const options = flights.slice(0, 25).map(f => {
            const alloc = f.allocations.find(a => a.userId === interaction.user.id);
            return {
                label: `${f.flightNumber} — ${alloc.position}`,
                description: `${f.departure} ➜ ${f.destination}`,
                value: f.flightNumber,
            };
        });

        const select = new StringSelectMenuBuilder()
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
        const flightNumber = interaction.values[0];
        const flight = await Flight.findOne({ flightNumber, status: 'scheduled' });
        if (!flight) return interaction.update({ content: '❌ Flight not found.', components: [] });

        const allocIndex = flight.allocations.findIndex(a => a.userId === interaction.user.id);
        if (allocIndex === -1) {
            return interaction.update({ content: '❌ You are not allocated to this flight.', components: [] });
        }

        const removed = flight.allocations[allocIndex];
        flight.allocations.splice(allocIndex, 1);
        await flight.save();

        // Update forum embed
        try {
            if (flight.forumThreadId && flight.forumMessageId) {
                const guild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
                const thread = guild?.channels.cache.get(flight.forumThreadId)
                    || await guild?.channels.fetch(flight.forumThreadId).catch(() => null);
                if (thread) {
                    const msg = await thread.messages.fetch(flight.forumMessageId).catch(() => null);
                    if (msg) {
                        await msg.edit({ embeds: [buildFlightInfoEmbed(flight), buildAllocationEmbed(flight)] });
                    }
                }
            }
        } catch (err) { console.error('[Unallocate] Forum update error:', err); }

        await interaction.update({
            content: `✅ You have been removed as **${removed.position}** from flight **${flightNumber}**.`,
            components: [],
        });
    },
};
