// commands/create.js
const {
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} = require('discord.js');
const Flight = require('../models/Flight');
const { getAircraftChoices, AIRCRAFT } = require('../config/aircraft');
const { buildFlightInfoEmbed, buildAllocationEmbed } = require('../utils/embed');
const { updateCalendar, updateStaffCalendar, announceNewFlight } = require('../utils/calendar');const ids = require('../config/ids');
const pendingCreations = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('create')
        .setDescription('Create a new flight and allocation sheet'),
    pendingCreations,

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ids.FLIGHT_HOST_ROLE_ID)) {
            return interaction.reply({ content: '❌ You need the Flight Host role to create flights.', ephemeral: true });
        }
        const choices = getAircraftChoices();
        const select = new StringSelectMenuBuilder()
            .setCustomId('create_aircraft')
            .setPlaceholder('Select an aircraft')
            .addOptions(choices.map(c => ({ label: c.name, value: c.value })));
        await interaction.reply({
            content: '**Step 1/3** — Select the aircraft for this flight:',
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral: true,
        });
    },

    async handleAircraftSelect(interaction) {
        pendingCreations.set(interaction.user.id, { aircraft: interaction.values[0] });
        const modal = new ModalBuilder().setCustomId('create_modal').setTitle('Create Flight');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('flight_number').setLabel('Flight Number (e.g. UA 1234)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('departure').setLabel('IATA Departure (e.g. EWR)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('destination').setLabel('IATA Destination (e.g. LAX)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('employee_join_time').setLabel('Employee Join Time (Unix timestamp)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Use discordtimestamp.com to generate')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('server_open_time').setLabel('Server Open Time (Unix timestamp)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Use discordtimestamp.com to generate')),
        );
        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction) {
        const pending = pendingCreations.get(interaction.user.id);
        if (!pending?.aircraft) return interaction.reply({ content: '❌ Session expired. Use `/create` again.', ephemeral: true });

        const flightNumber = interaction.fields.getTextInputValue('flight_number').toUpperCase().trim();
        const departure = interaction.fields.getTextInputValue('departure').toUpperCase().trim();
        const destination = interaction.fields.getTextInputValue('destination').toUpperCase().trim();
        const employeeJoinTime = parseInt(interaction.fields.getTextInputValue('employee_join_time').trim());
        const serverOpenTime = parseInt(interaction.fields.getTextInputValue('server_open_time').trim());

        if (isNaN(employeeJoinTime) || isNaN(serverOpenTime)) {
            return interaction.reply({ content: '❌ Invalid timestamps. Use Unix timestamps (numbers). Try [discordtimestamp.com](https://discordtimestamp.com).', ephemeral: true });
        }
        if (!/^[A-Z]{3}$/.test(departure) || !/^[A-Z]{3}$/.test(destination)) {
            return interaction.reply({ content: '❌ IATA codes must be exactly 3 letters.', ephemeral: true });
        }
        const existing = await Flight.findOne({ flightNumber, status: 'scheduled' });
        if (existing) return interaction.reply({ content: `❌ Flight **${flightNumber}** already exists.`, ephemeral: true });

        pendingCreations.set(interaction.user.id, { ...pending, flightNumber, departure, destination, employeeJoinTime, serverOpenTime });

        const acName = AIRCRAFT[pending.aircraft]?.name || pending.aircraft;
        const embed = new EmbedBuilder().setTitle('✈️ Confirm Flight Creation').setColor(ids.EMBED_COLOR)
            .setDescription(`**Flight Number:** ${flightNumber}\n**Route:** ${departure} ➜ ${destination}\n**Aircraft:** ${acName}\n**Staff Join Time:** <t:${employeeJoinTime}:F>\n**Server Open Time:** <t:${serverOpenTime}:F>\n**Dispatcher:** <@${interaction.user.id}>`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('create_confirm').setLabel('Confirm & Create').setStyle(ButtonStyle.Success).setEmoji('✅'),
            new ButtonBuilder().setCustomId('create_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger).setEmoji('❌'),
        );
        await interaction.reply({ content: '**Step 3/3** — Review and confirm:', embeds: [embed], components: [row], ephemeral: true });
    },

    async handleConfirm(interaction) {
        const p = pendingCreations.get(interaction.user.id);
        if (!p?.flightNumber) return interaction.update({ content: '❌ Session expired.', embeds: [], components: [] });
        await interaction.deferUpdate();

        const flight = new Flight({
            flightNumber: p.flightNumber, departure: p.departure, destination: p.destination,
            aircraft: p.aircraft, employeeJoinTime: p.employeeJoinTime, serverOpenTime: p.serverOpenTime,
            dispatcherId: interaction.user.id, dispatcherUsername: interaction.user.username, allocations: [],
        });
        try { await flight.save(); } catch (err) {
            if (err.code === 11000) return interaction.editReply({ content: `❌ Flight **${p.flightNumber}** already exists.`, embeds: [], components: [] });
            console.error('[Create] DB error:', err);
            return interaction.editReply({ content: '❌ Database error.', embeds: [], components: [] });
        }

        // Post to forum
        try {
            const guild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
            const forum = guild?.channels.cache.get(ids.FORUM_CHANNEL_ID);
            if (forum) {
                const thread = await forum.threads.create({
                    name: `${flight.flightNumber} - Crew Allocation`,
                    message: { content: '@everyone', embeds: [buildFlightInfoEmbed(flight), buildAllocationEmbed(flight)] },
                });
                const starter = await thread.fetchStarterMessage();
                flight.forumThreadId = thread.id;
                flight.forumMessageId = starter?.id;
                await flight.save();
            }
        } catch (err) { console.error('[Create] Forum error:', err); }

        try { await updateCalendar(interaction.client); } catch (err) { console.error('[Create] Calendar error:', err); }
        try { await updateStaffCalendar(interaction.client); } catch (err) { console.error('[Create] Staff calendar error:', err); }
        try { await announceNewFlight(interaction.client, flight); } catch (err) { console.error('[Create] Announce error:', err); }

        // Create Discord scheduled event in calendar server
        try {
            var calGuild = interaction.client.guilds.cache.get(ids.CALENDAR_SERVER_ID);
            if (calGuild) {
                var startTime = new Date(flight.serverOpenTime * 1000);
                var endTime = new Date((flight.serverOpenTime + 3600) * 1000);
                await calGuild.scheduledEvents.create({
                    name: flight.flightNumber + ' | ' + flight.departure + ' \u27A1 ' + flight.destination,
                    scheduledStartTime: startTime,
                    scheduledEndTime: endTime,
                    privacyLevel: 2,
                    entityType: 3,
                    entityMetadata: { location: 'https://www.roblox.com/games/95918419045248/Terminal-A-Newark-Liberty-Intl-Airport' },
                    description: 'Dispatcher - <@' + flight.dispatcherId + '>\nFlight Number - ' + flight.flightNumber + '\nIATA Route - ' + flight.departure + ' to ' + flight.destination + '\nAircraft - ' + flight.aircraft,
                });
                console.log('[Create] Discord event created for ' + flight.flightNumber);
            }
        } catch (err) { console.error('[Create] Event creation error:', err); }

        pendingCreations.delete(interaction.user.id);
        await interaction.editReply({ content: `✅ Flight **${p.flightNumber}** (${p.departure} ➜ ${p.destination}) created and posted!`, embeds: [], components: [] });
    },

    async handleCancel(interaction) {
        pendingCreations.delete(interaction.user.id);
        await interaction.update({ content: '❌ Cancelled.', embeds: [], components: [] });
    },
};
