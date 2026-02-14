// commands/edit.js
const {
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, EmbedBuilder,
} = require('discord.js');
const Flight = require('../models/Flight');
const { AIRCRAFT } = require('../config/aircraft');
const { buildFlightInfoEmbed, buildAllocationEmbed } = require('../utils/embed');
const { updateCalendar, updateStaffCalendar } = require('../utils/calendar');
const ids = require('../config/ids');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit')
        .setDescription('Edit an existing flight\'s details')
        .addStringOption(opt =>
            opt.setName('flight_number')
                .setDescription('The flight number to edit (e.g. UA 1234)')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ids.FLIGHT_HOST_ROLE_ID)) {
            return interaction.reply({ content: '❌ You need the Flight Host role.', flags: [4096] });
        }

        const flightNumber = interaction.options.getString('flight_number').toUpperCase().trim();
        const flight = await Flight.findOne({ flightNumber, status: 'scheduled' });
        if (!flight) {
            return interaction.reply({ content: `❌ Flight **${flightNumber}** not found.`, flags: [4096] });
        }

        const modal = new ModalBuilder()
            .setCustomId(`edit_modal_${flightNumber}`)
            .setTitle(`Edit ${flightNumber}`);

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
        const flightNumber = interaction.customId.replace('edit_modal_', '');
        const flight = await Flight.findOne({ flightNumber, status: 'scheduled' });
        if (!flight) return interaction.reply({ content: '❌ Flight not found.', flags: [4096] });

        const departure = interaction.fields.getTextInputValue('departure').toUpperCase().trim();
        const destination = interaction.fields.getTextInputValue('destination').toUpperCase().trim();
        const ejRaw = interaction.fields.getTextInputValue('employee_join_time').trim();
        const soRaw = interaction.fields.getTextInputValue('server_open_time').trim();

        // Validate and apply changes
        let changes = [];

        if (departure && /^[A-Z]{3}$/.test(departure) && departure !== flight.departure) {
            flight.departure = departure;
            changes.push(`Departure → ${departure}`);
        }
        if (destination && /^[A-Z]{3}$/.test(destination) && destination !== flight.destination) {
            flight.destination = destination;
            changes.push(`Destination → ${destination}`);
        }
        if (ejRaw && !isNaN(parseInt(ejRaw))) {
            const ej = parseInt(ejRaw);
            if (ej !== flight.employeeJoinTime) {
                flight.employeeJoinTime = ej;
                changes.push(`Staff Join → <t:${ej}:F>`);
            }
        }
        if (soRaw && !isNaN(parseInt(soRaw))) {
            const so = parseInt(soRaw);
            if (so !== flight.serverOpenTime) {
                flight.serverOpenTime = so;
                changes.push(`Server Open → <t:${so}:F>`);
            }
        }

        if (changes.length === 0) {
            return interaction.reply({ content: '⚠️ No changes detected.', flags: [4096] });
        }

        await flight.save();

        // Update forum embed
        try {
            if (flight.forumThreadId && flight.forumMessageId) {
                const guild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
                const thread = guild?.channels.cache.get(flight.forumThreadId)
                    || await guild?.channels.fetch(flight.forumThreadId).catch(() => null);
                if (thread) {
                    const msg = await thread.messages.fetch(flight.forumMessageId).catch(() => null);
                    if (msg) await msg.edit({ embeds: [buildFlightInfoEmbed(flight), buildAllocationEmbed(flight)] });
                }
            }
        } catch (err) { console.error('[Edit] Forum update error:', err); }

        try { await updateCalendar(interaction.client); } catch (err) { console.error('[Edit] Calendar error:', err); }
        try { await updateStaffCalendar(interaction.client); } catch (err) { console.error('[Edit] Staff calendar error:', err); }

        await interaction.reply({
            content: `✅ Flight **${flightNumber}** updated:\n${changes.map(c => `• ${c}`).join('\n')}`,
            flags: [4096],
        });
    },
};
