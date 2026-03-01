const {
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} = require('discord.js');
var Flight = require('../models/Flight');
var { getAircraftChoices, AIRCRAFT } = require('../config/aircraft');
var { buildFlightInfoEmbed, buildAllocationEmbed } = require('../utils/embed');
var { updateAllCalendars, announceNewFlight } = require('../utils/calendar');
var ids = require('../config/ids');

function parseTimestamp(input) {
    var match = input.match(/<t:(\d+)(?::[tTdDfFR])?>/);
    if (match) return parseInt(match[1]);
    var num = parseInt(input);
    if (!isNaN(num)) return num;
    return NaN;
}

var pendingCreations = new Map();

var FLIGHT_TYPES = {
    regular: { label: 'Regular Flight', emoji: '\u2708\uFE0F', color: null, threadPrefix: '', description: 'Normal scheduled flight' },
    premium: { label: 'Premium Flight', emoji: '\u2B50', color: 0xDAA520, threadPrefix: '[PREMIUM] ', description: 'Global Services, partners, and honoraries only' },
    test: { label: 'Test Flight', emoji: '\uD83E\uDDEA', color: 0x1414d2, threadPrefix: '[TEST] ', description: 'Staff test flight (Volare server only)' },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('create')
        .setDescription('Create a new flight and allocation sheet'),
    pendingCreations: pendingCreations,

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ids.FLIGHT_HOST_ROLE_ID)) {
            return interaction.reply({ content: '\u274C You need the Flight Host role.', ephemeral: true });
        }
        var select = new StringSelectMenuBuilder()
            .setCustomId('create_type')
            .setPlaceholder('Select flight type')
            .addOptions([
                { label: 'Regular Flight', value: 'regular', description: 'Normal scheduled flight', emoji: { id: '1408481918177251438', name: 'volare_calendar' } },
                { label: 'Premium Flight', value: 'premium', description: 'Global Services, partners, honoraries', emoji: { id: '1298320156342358088', name: 'UnitedGlobalServices' } },
                { label: 'Test Flight', value: 'test', description: 'Staff test flight (Volare only)', emoji: { id: '1408298312448086056', name: 'volare_plane' } },
            ]);
        await interaction.reply({
            content: '**Step 1/4** \u2014 Select the flight type:',
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral: true,
        });
    },

    async handleTypeSelect(interaction) {
        var flightType = interaction.values[0];
        pendingCreations.set(interaction.user.id, { flightType: flightType });

        var choices = getAircraftChoices();
        var select = new StringSelectMenuBuilder()
            .setCustomId('create_aircraft')
            .setPlaceholder('Select an aircraft')
            .addOptions(choices.map(function(c) { return { label: c.name, value: c.value }; }));
        await interaction.update({
            content: '**Step 2/4** \u2014 Select the aircraft (' + FLIGHT_TYPES[flightType].label + '):',
            components: [new ActionRowBuilder().addComponents(select)],
        });
    },

    async handleAircraftSelect(interaction) {
        var pending = pendingCreations.get(interaction.user.id);
        if (!pending) return interaction.update({ content: '\u274C Session expired. Use `/create` again.', components: [] });
        pending.aircraft = interaction.values[0];
        pendingCreations.set(interaction.user.id, pending);

        var modal = new ModalBuilder().setCustomId('create_modal').setTitle('Create Flight');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('flight_number').setLabel('Flight Number (e.g. UA 1234)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('departure').setLabel('IATA Departure (e.g. EWR)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('destination').setLabel('IATA Destination (e.g. LAX)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('employee_join_time').setLabel('Employee Join Time').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. <t:1772089560:f> or 1772089560')),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('server_open_time').setLabel('Server Open Time').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. <t:1772089560:f> or 1772089560')),
        );
        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction) {
        var pending = pendingCreations.get(interaction.user.id);
        if (!pending || !pending.aircraft) return interaction.reply({ content: '\u274C Session expired. Use `/create` again.', ephemeral: true });

        var flightNumber = interaction.fields.getTextInputValue('flight_number').toUpperCase().trim();
        var departure = interaction.fields.getTextInputValue('departure').toUpperCase().trim();
        var destination = interaction.fields.getTextInputValue('destination').toUpperCase().trim();
        var employeeJoinTime = parseTimestamp(interaction.fields.getTextInputValue('employee_join_time').trim());
        var serverOpenTime = parseTimestamp(interaction.fields.getTextInputValue('server_open_time').trim());

        if (isNaN(employeeJoinTime) || isNaN(serverOpenTime)) {
            return interaction.reply({ content: '\u274C Invalid timestamps. Use Unix timestamps.', ephemeral: true });
        }
        if (!/^[A-Z]{3}$/.test(departure) || !/^[A-Z]{3}$/.test(destination)) {
            return interaction.reply({ content: '\u274C IATA codes must be exactly 3 letters.', ephemeral: true });
        }

        pending.flightNumber = flightNumber;
        pending.departure = departure;
        pending.destination = destination;
        pending.employeeJoinTime = employeeJoinTime;
        pending.serverOpenTime = serverOpenTime;
        pendingCreations.set(interaction.user.id, pending);

        var typeInfo = FLIGHT_TYPES[pending.flightType];
        var acName = AIRCRAFT[pending.aircraft] ? AIRCRAFT[pending.aircraft].name : pending.aircraft;
        var embedColor = typeInfo.color || ids.EMBED_COLOR;

        var embed = new EmbedBuilder()
            .setTitle(typeInfo.emoji + ' Confirm ' + typeInfo.label)
            .setColor(embedColor)
            .setDescription(
                '**Flight Number:** ' + flightNumber + '\n' +
                '**Route:** ' + departure + ' \u27A1 ' + destination + '\n' +
                '**Aircraft:** ' + acName + '\n' +
                '**Staff Join Time:** <t:' + employeeJoinTime + ':F>\n' +
                '**Server Open Time:** <t:' + serverOpenTime + ':F>\n' +
                '**Dispatcher:** <@' + interaction.user.id + '>\n' +
                '**Type:** ' + typeInfo.label
            );

        var row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('create_confirm').setLabel('Confirm & Create').setStyle(ButtonStyle.Success).setEmoji('\u2705'),
            new ButtonBuilder().setCustomId('create_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger).setEmoji('\u274C'),
        );
        await interaction.reply({ content: '**Step 4/4** \u2014 Review and confirm:', embeds: [embed], components: [row], ephemeral: true });
    },

    async handleConfirm(interaction) {
        var p = pendingCreations.get(interaction.user.id);
        if (!p || !p.flightNumber) return interaction.update({ content: '\u274C Session expired.', embeds: [], components: [] });
        await interaction.deferUpdate();

        var typeInfo = FLIGHT_TYPES[p.flightType];

        var flight = new Flight({
            flightNumber: p.flightNumber, departure: p.departure, destination: p.destination,
            aircraft: p.aircraft, employeeJoinTime: p.employeeJoinTime, serverOpenTime: p.serverOpenTime,
            dispatcherId: interaction.user.id, dispatcherUsername: interaction.user.username,
            allocations: [], flightType: p.flightType,
        });
        try { await flight.save(); } catch (err) {
            if (err.code === 11000) return interaction.editReply({ content: '\u274C Flight already exists.', embeds: [], components: [] });
            return interaction.editReply({ content: '\u274C Database error.', embeds: [], components: [] });
        }

        // Post to forum
        try {
            var guild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
            var forum = guild ? guild.channels.cache.get(ids.FORUM_CHANNEL_ID) : null;
            if (forum) {
                var infoEmbed = buildFlightInfoEmbed(flight);
                var allocEmbed = buildAllocationEmbed(flight);
                if (typeInfo.color) {
                    infoEmbed.setColor(typeInfo.color);
                    allocEmbed.setColor(typeInfo.color);
                }
                var threadName = typeInfo.threadPrefix + flight.flightNumber + ' - Crew Allocation';
                var thread = await forum.threads.create({
                    name: threadName,
                    message: { content: '@everyone', embeds: [infoEmbed, allocEmbed] },
                });
                var starter = await thread.fetchStarterMessage();
                flight.forumThreadId = thread.id;
                flight.forumMessageId = starter ? starter.id : null;
                await flight.save();
            }
        } catch (err) { console.error('[Create] Forum error:', err); }

        // Update all calendars (each filters by type internally)
        try { await updateAllCalendars(interaction.client); } catch (err) { console.error('[Create] Calendar error:', err); }

        // Announce
        try { await announceNewFlight(interaction.client, flight); } catch (err) { console.error('[Create] Announce error:', err); }

        // Create Discord scheduled event
        // Regular + Premium -> main server, Test -> staff server only
        try {
            if (p.flightType === 'premium') throw 'skip';
            var eventServerId = (p.flightType === 'test') ? ids.STAFF_SERVER_ID : ids.CALENDAR_SERVER_ID;
            var eventGuild = interaction.client.guilds.cache.get(eventServerId);
            if (eventGuild) {
                var fs = require('fs');
                var path = require('path');
                var startTime = new Date(flight.serverOpenTime * 1000);
                var endTime = new Date((flight.serverOpenTime + 3600) * 1000);
                var eventName = typeInfo.threadPrefix + flight.flightNumber + ' | ' + flight.departure + ' \u27A1 ' + flight.destination;
                var eventOptions = {
                    name: eventName,
                    scheduledStartTime: startTime,
                    scheduledEndTime: endTime,
                    privacyLevel: 2,
                    entityType: 3,
                    entityMetadata: { location: 'https://www.roblox.com/games/95918419045248/Terminal-A-Newark-Liberty-Intl-Airport' },
                    description: 'Dispatcher - <@' + flight.dispatcherId + '>\nFlight Number - ' + flight.flightNumber + '\nIATA Route - ' + flight.departure + ' to ' + flight.destination + '\nAircraft - ' + flight.aircraft,
                };
                if (p.flightType === 'test') eventOptions.description += '\n\nThis is a test flight.';
                if (p.flightType === 'premium') eventOptions.description += '\n\nPremium flight - Global Services, partners, and honoraries.';
                var aircraftImages = { '737-800 NEXT': '737-800.png' };
                var imageFile = aircraftImages[flight.aircraft];
                if (imageFile) {
                    try { eventOptions.image = fs.readFileSync(path.join(__dirname, '..', imageFile)); } catch (imgErr) {}
                }
                var event = await eventGuild.scheduledEvents.create(eventOptions);
                flight.discordEventId = event.id;
                await flight.save();
            }
        } catch (err) { console.error('[Create] Event error:', err); }

        pendingCreations.delete(interaction.user.id);
        await interaction.editReply({
            content: '\u2705 ' + typeInfo.label + ' **' + p.flightNumber + '** (' + p.departure + ' \u27A1 ' + p.destination + ') created!',
            embeds: [], components: [],
        });
    },

    async handleCancel(interaction) {
        pendingCreations.delete(interaction.user.id);
        await interaction.update({ content: '\u274C Cancelled.', embeds: [], components: [] });
    },
};
