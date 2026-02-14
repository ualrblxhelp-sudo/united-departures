// commands/allocate.js
const {
    SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder,
} = require('discord.js');
const Flight = require('../models/Flight');
const { getPositionsForAircraft, DEPARTMENTS } = require('../config/aircraft');
const { buildFlightInfoEmbed, buildAllocationEmbed } = require('../utils/embed');
const { updateCalendar } = require('../utils/calendar');
const ids = require('../config/ids');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('allocate')
        .setDescription('Allocate yourself to a position on a scheduled flight'),

    async execute(interaction) {
        // Fetch all scheduled flights
        const flights = await Flight.find({ status: 'scheduled' }).sort({ serverOpenTime: 1 });
        if (flights.length === 0) {
            return interaction.reply({ content: '❌ No scheduled flights available.', flags: [4096] });
        }

        const options = flights.slice(0, 25).map(f => ({
            label: `${f.flightNumber} — ${f.departure} ➜ ${f.destination}`,
            description: `Server open: ${new Date(f.serverOpenTime * 1000).toLocaleDateString()}`,
            value: f.flightNumber,
        }));

        const select = new StringSelectMenuBuilder()
            .setCustomId('allocate_flight')
            .setPlaceholder('Select a flight')
            .addOptions(options);

        await interaction.reply({
            content: '**Step 1/2** — Select the flight you want to allocate for:',
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral: true,
        });
    },

    async handleFlightSelect(interaction) {
        const flightNumber = interaction.values[0];
        const flight = await Flight.findOne({ flightNumber, status: 'scheduled' });
        if (!flight) {
            return interaction.update({ content: '❌ Flight not found.', components: [] });
        }

        // Check if user is already allocated to this flight
        const existingAlloc = flight.allocations.find(a => a.userId === interaction.user.id);
        if (existingAlloc) {
            return interaction.update({
                content: `❌ You are already allocated as **${existingAlloc.position}** on flight **${flightNumber}**. Use \`/unallocate\` to remove yourself first.`,
                components: [],
            });
        }

        // Build position dropdown with available slots
        const positions = getPositionsForAircraft(flight.aircraft);
        if (!positions) {
            return interaction.update({ content: '❌ Unknown aircraft type.', components: [] });
        }

        const options = [];
        for (const dept of DEPARTMENTS) {
            const deptPositions = Object.entries(positions).filter(([_, c]) => c.department === dept);
            for (const [role, config] of deptPositions) {
                const filled = flight.allocations.filter(a => a.position === role).length;
                const available = config.max - filled;
                if (available > 0) {
                    options.push({
                        label: role,
                        description: `${dept} • ${filled}/${config.max} filled`,
                        value: `${flightNumber}::${role}`,
                    });
                }
            }
        }

        if (options.length === 0) {
            return interaction.update({ content: `❌ All positions on **${flightNumber}** are filled.`, components: [] });
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId('allocate_position')
            .setPlaceholder('Select a position')
            .addOptions(options);

        await interaction.update({
            content: `**Step 2/2** — Select your position for **${flightNumber}**:`,
            components: [new ActionRowBuilder().addComponents(select)],
        });
    },

    async handlePositionSelect(interaction) {
        const [flightNumber, position] = interaction.values[0].split('::');

        const flight = await Flight.findOne({ flightNumber, status: 'scheduled' });
        if (!flight) return interaction.update({ content: '❌ Flight not found.', components: [] });

        // Double check availability
        const positions = getPositionsForAircraft(flight.aircraft);
        const posConfig = positions?.[position];
        if (!posConfig) return interaction.update({ content: '❌ Invalid position.', components: [] });

        const filled = flight.allocations.filter(a => a.position === position).length;
        if (filled >= posConfig.max) {
            return interaction.update({ content: `❌ **${position}** is now full on **${flightNumber}**.`, components: [] });
        }

        // Check if already allocated
        if (flight.allocations.find(a => a.userId === interaction.user.id)) {
            return interaction.update({ content: `❌ You are already allocated on **${flightNumber}**.`, components: [] });
        }

        // Add allocation
        flight.allocations.push({
            userId: interaction.user.id,
            username: interaction.user.username,
            position,
        });
        await flight.save();

        // Update the forum embed
        await updateForumEmbed(interaction.client, flight);

        await interaction.update({
            content: `✅ You have been allocated as **${position}** on flight **${flightNumber}** (${flight.departure} ➜ ${flight.destination}). This allocation is binding — use \`/unallocate\` if you become unavailable.`,
            components: [],
        });
    },
};

async function updateForumEmbed(client, flight) {
    try {
        if (!flight.forumThreadId || !flight.forumMessageId) return;
        const guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
        const thread = guild?.channels.cache.get(flight.forumThreadId)
            || await guild?.channels.fetch(flight.forumThreadId).catch(() => null);
        if (!thread) return;

        const message = await thread.messages.fetch(flight.forumMessageId).catch(() => null);
        if (!message) return;

        const infoEmbed = buildFlightInfoEmbed(flight);
        const allocationEmbed = buildAllocationEmbed(flight);
        await message.edit({ embeds: [infoEmbed, allocationEmbed] });
    } catch (err) {
        console.error('[Allocate] Forum update error:', err);
    }
}
