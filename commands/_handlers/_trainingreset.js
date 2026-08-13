const ids = require('../../config/ids');
const TrainingAssignment = require('../../models/TrainingAssignment');
const trainingPanel = require('../../utils/trainingPanel');
const commence = require('./_trainingcommence');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
    async execute(interaction) {
        if (interaction.guildId !== ids.AVIATE_SERVER_ID) {
            return interaction.reply({ content: 'This command can only be used in the United Aviate server.', flags: MessageFlags.Ephemeral });
        }
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Only server administrators can use this command.', flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ content: 'Resetting active training assignments...', flags: MessageFlags.Ephemeral });

        var active = await TrainingAssignment.find({ status: 'active' }).lean().catch(function () { return []; });
        var clearedStudents = {};

        for (var i = 0; i < active.length; i++) {
            clearedStudents[active[i].studentId] = true;
        }

        var studentIds = Object.keys(clearedStudents);
        for (var s = 0; s < studentIds.length; s++) {
            var member = interaction.guild.members.cache.get(studentIds[s]) || await interaction.guild.members.fetch(studentIds[s]).catch(function () { return null; });
            if (!member) continue;
            await member.roles.remove(ids.TRAINING_INTRAINING_ROLE_ID).catch(function () {});
        }

        await TrainingAssignment.deleteMany({ status: 'active' }).catch(function (err) {
            console.error('[TrainingReset] deleteMany failed:', err);
        });

        await trainingPanel.syncTrainingPanel(interaction.client).catch(function (err) {
            console.error('[TrainingReset] Panel sync error before recommence:', err);
        });

        var note = 'Cleared **' + active.length + '** active assignment(s) across **' + studentIds.length + '** trainee(s), then rebuilt the assignment set.';
        return commence.runAssignmentPass(interaction, {
            skipDefer: true,
            summaryTitle: 'Training Reset Complete',
            summaryNote: note,
        });
    },
};
