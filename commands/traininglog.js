const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const TraineeProfile = require('../models/TraineeProfile');
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

async function logChannel(client) {
    return client.channels.fetch(ids.TRAINING_LOG_CHANNEL_ID).catch(function() { return null; });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('traininglog')
        .setDescription('Mark a trainee training as complete or incomplete')
        .addUserOption(function(opt) {
            return opt.setName('users').setDescription('The trainee to update').setRequired(true);
        })
        .addStringOption(function(opt) {
            opt.setName('trainingtype').setDescription('The training to toggle').setRequired(true);
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

        var target = interaction.options.getUser('users', true);
        var trainingType = interaction.options.getString('trainingtype', true);

        var profile = await TraineeProfile.findOne({ discordId: target.id });
        if (!profile) {
            profile = new TraineeProfile({
                discordId: target.id,
                discordUsername: target.username,
                completedTrainings: [],
            });
        } else {
            profile.discordUsername = target.username;
        }

        var completed = Array.isArray(profile.completedTrainings) ? profile.completedTrainings.slice() : [];
        var idx = completed.indexOf(trainingType);
        var action = 'completed';

        if (idx === -1) {
            completed.push(trainingType);
            completed.sort();
        } else {
            completed.splice(idx, 1);
            action = 'incomplete';
        }

        profile.completedTrainings = completed;
        await profile.save();

        var embed = new EmbedBuilder()
            .setColor(action === 'completed' ? 0x2EB860 : 0xD64545)
            .setTitle('Training Log Updated')
            .setDescription(
                '**Trainee:** <@' + target.id + '>\n' +
                '**Training:** ' + trainingLabel(trainingType) + '\n' +
                '**Status:** Marked as **' + action + '**\n' +
                '**Logged by:** <@' + interaction.user.id + '>'
            )
            .setTimestamp()
            .setFooter({ text: 'United Aviate • Training Log' });

        var channel = await logChannel(interaction.client);
        if (channel && typeof channel.send === 'function') {
            await channel.send({ embeds: [embed] }).catch(function(err) {
                console.error('[TrainingLog] Channel send error:', err);
            });
        } else {
            console.error('[TrainingLog] Log channel not reachable:', ids.TRAINING_LOG_CHANNEL_ID);
        }

        return interaction.editReply({
            content: 'Training log updated for <@' + target.id + '>: **' + trainingLabel(trainingType) + '** is now **' + action + '**.',
        });
    },
};
