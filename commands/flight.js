// commands/flight.js — Flight operations subcommand router
const { SlashCommandBuilder } = require('discord.js');

const createHandler = require('./_handlers/_create');
const allocateHandler = require('./_handlers/_allocate');
const unallocateHandler = require('./_handlers/_unallocate');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('flight')
        .setDescription('Flight operations commands')
        .addSubcommand(function(sc) {
            return sc.setName('create').setDescription('Create a new flight and allocation sheet');
        })
        .addSubcommand(function(sc) {
            return sc.setName('allocate').setDescription('Allocate yourself to a position on a scheduled flight');
        })
        .addSubcommand(function(sc) {
            return sc.setName('unallocate').setDescription('Remove yourself from a flight allocation');
        }),

    async execute(interaction) {
        var sub = interaction.options.getSubcommand();
        if (sub === 'create') return createHandler.execute(interaction);
        if (sub === 'allocate') return allocateHandler.execute(interaction);
        if (sub === 'unallocate') return unallocateHandler.execute(interaction);
    },

    // Re-export all button/modal/select handlers so index.js can dispatch them
    // through client.commands.get('flight').handleX(...)
    create_handleTypeSelect: createHandler.handleTypeSelect,
    create_handleAircraftSelect: createHandler.handleAircraftSelect,
    create_handleModalSubmit: createHandler.handleModalSubmit,
    create_handleConfirm: createHandler.handleConfirm,
    create_handleCancel: createHandler.handleCancel,

    allocate_handleFlightSelect: allocateHandler.handleFlightSelect,
    allocate_handlePositionSelect: allocateHandler.handlePositionSelect,

    unallocate_handleFlightSelect: unallocateHandler.handleFlightSelect,
};
