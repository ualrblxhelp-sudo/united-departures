const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const TraineeProfile = require('../../models/TraineeProfile');
const TrainingAssignment = require('../../models/TrainingAssignment');
const ids = require('../../config/ids');
const trainingPanel = require('../../utils/trainingPanel');

var TRAINING_TYPES = [
    { name: 'customer-service', label: 'Customer Service' },
    { name: 'flight-crew', label: 'Flight Crew' },
    { name: 'ramp-services', label: 'Ramp Services' },
];

function trainingLabel(value) {
    var found = TRAINING_TYPES.find(function(item) { return item.name === value; });
    return found ? found.label : value;
}

async function logThread(client) {
    return client.channels.fetch(ids.TRAINING_COMPLETION_THREAD_ID).catch(function() { return null; });
}

module.exports = {
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

        // Close-out link with /commencetraining: if this trainee has an ACTIVE
        // assignment for this department, only their assigned instructor (or a
        // server admin) may log it. The most recent record for the pair is used.
        var assignment = await TrainingAssignment
            .findOne({ studentId: target.id, department: trainingType })
            .sort({ assignedAt: -1 });

        var isAdmin = interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
        if (assignment && assignment.status === 'active' && assignment.instructorId !== interaction.user.id && !isAdmin) {
            return interaction.editReply({
                content: 'This trainee is assigned to <@' + assignment.instructorId + '> for **' + trainingLabel(trainingType) + '**. Only their assigned instructor (or an admin) can log this training.',
            });
        }

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

        // Sync the assignment + the in-training role.
        var roleNote = '';
        if (assignment) {
            var member = await interaction.guild.members.fetch(target.id).catch(function() { return null; });
            if (action === 'completed' && assignment.status === 'active') {
                assignment.status = 'completed';
                assignment.completedAt = new Date();
                assignment.completedBy = interaction.user.id;
                assignment.completedByUsername = interaction.user.username;
                await assignment.save();
                if (member) {
                    var removed = await member.roles.remove(ids.TRAINING_INTRAINING_ROLE_ID)
                        .then(function() { return true; })
                        .catch(function() { return false; });
                    if (!removed) roleNote = '\n(Note: could not remove the in-training role \u2014 check the bot\'s role position.)';
                }
            } else if (action === 'incomplete' && assignment.status === 'completed') {
                // Undo a completion: reopen the assignment and restore the role.
                assignment.status = 'active';
                assignment.completedAt = null;
                assignment.completedBy = null;
                assignment.completedByUsername = '';
                await assignment.save();
                if (member) {
                    await member.roles.add(ids.TRAINING_INTRAINING_ROLE_ID).catch(function() {});
                }
            }
        }

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
            .setFooter({ text: 'United Aviate \u2022 Training Log' });

        var thread = await logThread(interaction.client);
        if (thread && typeof thread.send === 'function') {
            await thread.send({ embeds: [embed] }).catch(function(err) {
                console.error('[TrainingLog] Thread send error:', err);
            });
        } else {
            console.error('[TrainingLog] Completion thread not reachable:', ids.TRAINING_COMPLETION_THREAD_ID);
        }

        trainingPanel.syncTrainingPanel(interaction.client).catch(function (err) {
            console.error('[TrainingLog] Panel sync error:', err);
        });

        return interaction.editReply({
            content: 'Training log updated for <@' + target.id + '>: **' + trainingLabel(trainingType) + '** is now **' + action + '**.' + roleNote,
        });
    },
};
