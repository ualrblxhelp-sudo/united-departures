const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const commence = require('./_handlers/_trainingcommence');
const log = require('./_handlers/_traininglog');
const attendance = require('./_handlers/_trainingattendance');
const panel = require('./_handlers/_trainingpanel');

var TRAINING_TYPES = [
    { name: 'customer-service', label: 'Customer Service' },
    { name: 'flight-crew', label: 'Flight Crew' },
    { name: 'ramp-services', label: 'Ramp Services' },
];

function withTrainingType(opt, desc) {
    opt.setName('trainingtype').setDescription(desc).setRequired(true);
    TRAINING_TYPES.forEach(function (t) { opt.addChoices({ name: t.label, value: t.name }); });
    return opt;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('training')
        .setDescription('United Aviate training tools')
        .addSubcommand(function (sc) {
            return sc
                .setName('commence')
                .setDescription('Randomly assign eligible students to instructors by department and DM both sides');
        })
        .addSubcommand(function (sc) {
            return sc
                .setName('log')
                .setDescription('Mark a trainee training as complete or incomplete (graduation)')
                .addUserOption(function (opt) {
                    return opt.setName('users').setDescription('The trainee to update').setRequired(true);
                })
                .addStringOption(function (opt) {
                    return withTrainingType(opt, 'The training to toggle');
                });
        })
        .addSubcommand(function (sc) {
            return sc
                .setName('attendance')
                .setDescription('Submit a training attendance log')
                .addStringOption(function (opt) {
                    return opt
                        .setName('users')
                        .setDescription('Mentions or Discord IDs for attendees, separated by spaces or commas')
                        .setRequired(true);
                })
                .addStringOption(function (opt) {
                    return withTrainingType(opt, 'The training type for this attendance log');
                });
        })
        .addSubcommand(function (sc) {
            return sc
                .setName('panel')
                .setDescription('View trainee/instructor assignments and completion status (admin only)');
        }),

    async execute(interaction) {
        var sub = interaction.options.getSubcommand();
        if (sub === 'commence') return commence.execute(interaction);
        if (sub === 'log') return log.execute(interaction);
        if (sub === 'attendance') return attendance.execute(interaction);
        if (sub === 'panel') return panel.execute(interaction);
        return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    },
};
