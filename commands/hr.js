// commands/hr.js — Human Resources subcommand router
const { SlashCommandBuilder } = require('discord.js');

const addpointHandler = require('./_handlers/_addpoint');
const removepointHandler = require('./_handlers/_removepoint');
const fireHandler = require('./_handlers/_fire');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hr')
        .setDescription('Human Resources commands')
        .addSubcommand(function(sc) {
            return sc
                .setName('addpoint')
                .setDescription('Add sanction point(s) to an employee')
                .addUserOption(function(opt) {
                    return opt.setName('user').setDescription('Employee to sanction').setRequired(true);
                })
                .addIntegerOption(function(opt) {
                    return opt.setName('amount').setDescription('Number of points to add (default 1)').setRequired(false).setMinValue(1).setMaxValue(9);
                })
                .addStringOption(function(opt) {
                    return opt.setName('reason').setDescription('Reason for the sanction').setRequired(false).setMaxLength(500);
                });
        })
        .addSubcommand(function(sc) {
            return sc
                .setName('removepoint')
                .setDescription('Remove sanction point(s) from an employee')
                .addUserOption(function(opt) {
                    return opt.setName('user').setDescription('Employee to remove points from').setRequired(true);
                })
                .addIntegerOption(function(opt) {
                    return opt.setName('amount').setDescription('Number of points to remove (default 1)').setRequired(false).setMinValue(1).setMaxValue(9);
                });
        })
        .addSubcommand(function(sc) {
            return sc
                .setName('fire')
                .setDescription('Terminate an employee from United Airlines')
                .addStringOption(function(opt) {
                    return opt.setName('id').setDescription('Discord User ID of the employee').setRequired(true);
                });
        }),

    async execute(interaction) {
        var sub = interaction.options.getSubcommand();
        if (sub === 'addpoint') return addpointHandler.execute(interaction);
        if (sub === 'removepoint') return removepointHandler.execute(interaction);
        if (sub === 'fire') return fireHandler.execute(interaction);
    },

    // Re-export button/modal handlers so index.js can route them via client.commands.get('hr')
    handleConfirm: fireHandler.handleConfirm,
    handleCancel: fireHandler.handleCancel,
};
