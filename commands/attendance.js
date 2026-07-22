const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const TrainingAttendanceLog = require('../models/TrainingAttendanceLog');
const ids = require('../config/ids');

var TRAINING_TYPES = [
    { name: 'customer-service', label: 'Customer Service' },
    { name: 'flight-crew', label: 'Flight Crew' },
    { name: 'ramp-services', label: 'Ramp Services' },
];

function trainingLabel(value) {
    var found = TRAINING_TYPES.find(function(item) { return item.name === value; });
    return found ? found.label : value;
}

function parseUserIds(raw) {
    var text = String(raw || '');
    var idsFound = [];
    var seen = new Set();
    var mentionMatches = text.match(/<@!?(\d{15,21})>/g) || [];

    mentionMatches.forEach(function(match) {
        var id = match.replace(/[<@!>]/g, '');
        if (!seen.has(id)) {
            seen.add(id);
            idsFound.push(id);
        }
    });

    var idMatches = text.match(/\b\d{15,21}\b/g) || [];
    idMatches.forEach(function(id) {
        if (!seen.has(id)) {
            seen.add(id);
            idsFound.push(id);
        }
    });

    return idsFound;
}

async function resolveUsers(client, guild, idsList) {
    var resolved = [];
    for (var i = 0; i < idsList.length; i++) {
        var id = idsList[i];
        var user = client.users.cache.get(id);
        if (!user) user = await client.users.fetch(id).catch(function() { return null; });

        if (!user && guild) {
            var member = guild.members.cache.get(id);
            if (!member) member = await guild.members.fetch(id).catch(function() { return null; });
            user = member ? member.user : null;
        }

        resolved.push({
            discordId: id,
            discordUsername: user ? user.username : 'Unknown User',
        });
    }
    return resolved;
}

async function logChannel(client) {
    return client.channels.fetch(ids.TRAINING_LOG_CHANNEL_ID).catch(function() { return null; });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('attendance')
        .setDescription('Submit a training attendance log')
        .addStringOption(function(opt) {
            return opt
                .setName('users')
                .setDescription('Mentions or Discord IDs for attendees, separated by spaces or commas')
                .setRequired(true);
        })
        .addStringOption(function(opt) {
            opt.setName('trainingtype').setDescription('The training type for this attendance log').setRequired(true);
            TRAINING_TYPES.forEach(function(item) {
                opt.addChoices({ name: item.label, value: item.name });
            });
            return opt;
        }),

    async execute(interaction) {
        if (interaction.guildId !== ids.AVIATE_SERVER_ID) {
            return interaction.reply({ content: 'This command can only be used in the United Aviate server.', ephemeral: true });
        }
        if (!interaction.member.roles.cache.has(ids.TRAINING_STAFF_ROLE_ID)) {
            return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        var rawUsers = interaction.options.getString('users', true);
        var trainingType = interaction.options.getString('trainingtype', true);
        var guild = interaction.guild;

        var attendeeIds = parseUserIds(rawUsers);
        if (attendeeIds.indexOf(interaction.user.id) === -1) attendeeIds.unshift(interaction.user.id);

        if (!attendeeIds.length) {
            return interaction.editReply('No valid attendees were found. Use Discord mentions or Discord IDs.');
        }

        var attendees = await resolveUsers(interaction.client, guild, attendeeIds);
        var attendeeLines = attendees.map(function(item) {
            return '<@' + item.discordId + '>';
        });

        var embed = new EmbedBuilder()
            .setColor(0x080C96)
            .setTitle('Training Attendance Submitted')
            .setDescription(
                '**Training:** ' + trainingLabel(trainingType) + '\n' +
                '**Host:** <@' + interaction.user.id + '>\n' +
                '**Attendees (' + attendees.length + '):**\n' + attendeeLines.join('\n')
            )
            .setTimestamp()
            .setFooter({ text: 'United Aviate • Training Attendance' });

        var channel = await logChannel(interaction.client);
        var sent = null;
        if (channel && typeof channel.send === 'function') {
            sent = await channel.send({ embeds: [embed] }).catch(function(err) {
                console.error('[AttendanceCommand] Channel send error:', err);
                return null;
            });
        } else {
            console.error('[AttendanceCommand] Log channel not reachable:', ids.TRAINING_LOG_CHANNEL_ID);
        }

        await TrainingAttendanceLog.create({
            trainingType: trainingType,
            hostId: interaction.user.id,
            hostUsername: interaction.user.username,
            attendees: attendees,
            channelId: sent ? sent.channelId : ids.TRAINING_LOG_CHANNEL_ID,
            messageId: sent ? sent.id : null,
        });

        return interaction.editReply(
            'Attendance submitted for **' + trainingLabel(trainingType) + '** with **' + attendees.length + '** attendee(s), including you as host.'
        );
    },
};
