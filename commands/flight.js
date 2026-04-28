// commands/flight.js — Flight operations subcommand router
const { SlashCommandBuilder } = require('discord.js');

const createHandler = require('./_handlers/_create');
const editHandler = require('./_handlers/_edit');
const endHandler = require('./_handlers/_end');
const deleteHandler = require('./_handlers/_delete');
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
            return sc.setName('edit').setDescription('Edit an existing flight\'s details');
        })
        .addSubcommand(function(sc) {
            return sc.setName('end').setDescription('End a scheduled flight');
        })
        .addSubcommand(function(sc) {
            return sc.setName('delete').setDescription('Delete a scheduled flight and archive its allocation sheet');
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
        if (sub === 'edit') return editHandler.execute(interaction);
        if (sub === 'end') return endHandler.execute(interaction);
        if (sub === 'delete') return deleteHandler.execute(interaction);
        if (sub === 'allocate') return allocateHandler.execute(interaction);
        if (sub === 'unallocate') return unallocateHandler.execute(interaction);
    },

    // Re-export all button/modal/select handlers so index.js can dispatch them
    // through client.commands.get('flight').handleX(...)
    create_handleModalSubmit: createHandler.handleModalSubmit,
    create_handleConfirm: createHandler.handleConfirm,
    create_handleCancel: createHandler.handleCancel,

    edit_handleFlightSelect: editHandler.handleFlightSelect,
    edit_handleActionSelect: editHandler.handleActionSelect,
    edit_handleModalSubmit: editHandler.handleModalSubmit,
    edit_handleTransferModal: editHandler.handleTransferModal,
    edit_handleReplaceModal: editHandler.handleReplaceModal,
    edit_handleUnallocateCrew: editHandler.handleUnallocateCrew,
    edit_handleReplaceYes: editHandler.handleReplaceYes,
    edit_handleReplaceNo: editHandler.handleReplaceNo,
    edit_handleReplaceCancel: editHandler.handleReplaceCancel,

    end_handleFlightSelect: endHandler.handleFlightSelect,
    end_handleConfirm: endHandler.handleConfirm,
    end_handleCancel: endHandler.handleCancel,

    delete_handleFlightSelect: deleteHandler.handleFlightSelect,
    delete_handleConfirm: deleteHandler.handleConfirm,
    delete_handleCancel: deleteHandler.handleCancel,
};
