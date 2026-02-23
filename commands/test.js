const {
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} = require('discord.js');
const Flight = require('../models/Flight');
const { getAircraftChoices, AIRCRAFT } = require('../config/aircraft');
const { buildFlightInfoEmbed, buildAllocationEmbed } = require('../utils/embed');
const { updateStaffCalendar } = require('../utils/calendar');
const ids = require('../config/ids');

var pendingTests = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('test')
        .setDescription('Create a test flight'),
    pendingTests: pendingTests,

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ids.FLIGHT_HOST_ROLE_ID)) {
            return interaction.reply({ content: '\u274C You need a Dispatcher qualification.', flags: [4096] });
        }
        var choices = getAircraftChoices();
        var select = new StringSelectMenuBuilder()
            .setCustomId('test_aircraft')
            .setPlaceholder('Select an aircraft')
            .addOptions(choices.map(function(c) { return { label: c.name, value: c.value }; }));
        await interaction.reply({
            content: '**[TEST FLIGHT]** Step 1/3 \u2014 Select the aircraft:',
            components: [new ActionRowBuilder().addComponents(select)],
            flags: [4096],
        });
    },

    async handleAircraftSelect(interaction) {
        pendingTests.set(interaction.user.id, { aircraft: interaction.values[0] });
        var modal = new ModalBuilder().setCustomId('test_modal').setTitle('Create Test Flight');
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
        var pending = pendingTests.get(interaction.user.id);
        if (!pending || !pending.aircraft) return interaction.reply({ content: '\u274C Session expired. Use `/test` again.', flags: [4096] });

        var flightNumber = interaction.fields.getTextInputValue('flight_number').toUpperCase().trim();
        var departure = interaction.fields.getTextInputValue('departure').toUpperCase().trim();
        var destination = interaction.fields.getTextInputValue('destination').toUpperCase().trim();
        var employeeJoinTime = parseInt(interaction.fields.getTextInputValue('employee_join_time').trim());
        var serverOpenTime = parseInt(interaction.fields.getTextInputValue('server_open_time').trim());

        if (isNaN(employeeJoinTime) || isNaN(serverOpenTime)) {
            return interaction.reply({ content: '\u274C Invalid timestamps.', flags: [4096] });
        }
        if (!/^[A-Z]{3}$/.test(departure) || !/^[A-Z]{3}$/.test(destination)) {
            return interaction.reply({ content: '\u274C IATA codes must be exactly 3 letters.', flags: [4096] });
        }
        var existing = await Flight.findOne({ flightNumber: flightNumber, status: 'scheduled' });
        if (existing) return interaction.reply({ content: '\u274C Flight **' + flightNumber + '** already exists.', flags: [4096] });

        pendingTests.set(interaction.user.id, {
            aircraft: pending.aircraft, flightNumber: flightNumber, departure: departure,
            destination: destination, employeeJoinTime: employeeJoinTime, serverOpenTime: serverOpenTime,
        });

        var acName = AIRCRAFT[pending.aircraft] ? AIRCRAFT[pending.aircraft].name : pending.aircraft;
        var embed = new EmbedBuilder().setTitle('\u2708\uFE0F Confirm Test Flight').setColor(0x1414d2)
            .setDescription('**\u26A0\uFE0F TEST FLIGHT \u2014 Volare Server Only**\n\n**Flight Number:** ' + flightNumber + '\n**Route:** ' + departure + ' \u27A1 ' + destination + '\n**Aircraft:** ' + acName + '\n**Staff Join Time:** <t:' + employeeJoinTime + ':F>\n**Server Open Time:** <t:' + serverOpenTime + ':F>\n**Dispatcher:** <@' + interaction.user.id + '>');

        var row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('test_confirm').setLabel('Confirm Test Flight').setStyle(ButtonStyle.Success).setEmoji('\u2705'),
            new ButtonBuilder().setCustomId('test_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger).setEmoji('\u274C'),
        );
        await interaction.reply({ content: '**[TEST FLIGHT]** Step 3/3 \u2014 Review:', embeds: [embed], components: [row], flags: [4096] });
    },

    async handleConfirm(interaction) {
        var p = pendingTests.get(interaction.user.id);
        if (!p || !p.flightNumber) return interaction.update({ content: '\u274C Session expired.', embeds: [], components: [] });
        await interaction.deferUpdate();

        var flight = new Flight({
            flightNumber: p.flightNumber, departure: p.departure, destination: p.destination,
            aircraft: p.aircraft, employeeJoinTime: p.employeeJoinTime, serverOpenTime: p.serverOpenTime,
            dispatcherId: interaction.user.id, dispatcherUsername: interaction.user.username,
            allocations: [], status: 'scheduled',
        });
        try { await flight.save(); } catch (err) {
            if (err.code === 11000) return interaction.editReply({ content: '\u274C Flight already exists.', embeds: [], components: [] });
            return interaction.editReply({ content: '\u274C Database error.', embeds: [], components: [] });
        }

        // Post ONLY to staff server forum
        try {
            var guild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
            var forum = guild ? guild.channels.cache.get(ids.FORUM_CHANNEL_ID) : null;
            if (forum) {
                var infoEmbed = buildFlightInfoEmbed(flight);
                infoEmbed.setTitle('<:volare_click:1408484978362290287> Test Flight Information');
                infoEmbed.setColor(0x1414d2);
                var allocEmbed = buildAllocationEmbed(flight);
                allocEmbed.setColor(0x1414d2);
                var thread = await forum.threads.create({
                    name: '[TEST] ' + flight.flightNumber + ' - Crew Allocation',
                    message: { content: '@everyone', embeds: [infoEmbed, allocEmbed] },
                });
                var starter = await thread.fetchStarterMessage();
                flight.forumThreadId = thread.id;
                flight.forumMessageId = starter ? starter.id : null;
                await flight.save();
            }
        } catch (err) { console.error('[Test] Forum error:', err); }

        // Update ONLY staff server calendar
        try { await updateStaffCalendar(interaction.client); } catch (err) { console.error('[Test] Staff calendar error:', err); }

        // Announce in staff calendar channel only
        try {
            var staffGuild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
            var staffCalChannel = staffGuild ? staffGuild.channels.cache.get(ids.STAFF_CALENDAR_CHANNEL_ID) : null;
            if (staffCalChannel) {
                await staffCalChannel.send('@everyone A **test flight** has been scheduled. You may allocate accordingly in the <#' + ids.FORUM_CHANNEL_ID + '> forum.');
            }
        } catch (err) { console.error('[Test] Announce error:', err); }

        // NO main server calendar update
        // NO Discord scheduled event

        pendingTests.delete(interaction.user.id);
        await interaction.editReply({
            content: '\u2705 **Test flight** ' + p.flightNumber + ' (' + p.departure + ' \u27A1 ' + p.destination + ') created! Posted to Volare server only.',
            embeds: [], components: [],
        });
    },

    async handleCancel(interaction) {
        pendingTests.delete(interaction.user.id);
        await interaction.update({ content: '\u274C Test flight cancelled.', embeds: [], components: [] });
    },
};
