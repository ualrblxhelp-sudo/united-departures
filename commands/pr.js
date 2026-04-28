// commands/pr.js — PR management subcommand router
const { SlashCommandBuilder } = require('discord.js');

const regenerateweekHandler = require('./_handlers/_regenerateweek');
const prteamHandler = require('./_handlers/_prteam');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pr')
        .setDescription('Public Relations management commands')
        .addSubcommand(function(sc) {
            return sc
                .setName('regenerateweek')
                .setDescription('Regenerate this week\'s PR rotation (only affects unassigned days)');
        })
        .addSubcommand(function(sc) {
            return sc
                .setName('team')
                .setDescription('Diagnostic: show all members the bot currently sees with the PR role');
        }),

    async execute(interaction) {
        var sub = interaction.options.getSubcommand();
        if (sub === 'regenerateweek') return regenerateweekHandler.execute(interaction);
        if (sub === 'team') return prteamHandler.execute(interaction);
    },
};
