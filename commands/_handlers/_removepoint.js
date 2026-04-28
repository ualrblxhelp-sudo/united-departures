const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const points = require('../../utils/points');

var VOLARE_GUILD_ID = '1309560657473179679';
var MANAGEMENT_ROLE_ID = '1309724300156207216';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removepoint')
        .setDescription('Remove sanction point(s) from an employee')
        .addUserOption(function(opt) {
            return opt.setName('user').setDescription('Employee to remove points from').setRequired(true);
        })
        .addIntegerOption(function(opt) {
            return opt.setName('amount').setDescription('Number of points to remove (default 1)').setRequired(false).setMinValue(1).setMaxValue(9);
        }),

    async execute(interaction) {
        if (interaction.guildId !== VOLARE_GUILD_ID) {
            return interaction.reply({ content: '<:e_decline:1397829342079483904> This command can only be used in the United Volare server.', ephemeral: true });
        }
        if (!interaction.member.roles.cache.has(MANAGEMENT_ROLE_ID)) {
            return interaction.reply({ content: '<:e_decline:1397829342079483904> You do not have permission to use this command.', ephemeral: true });
        }

        var target = interaction.options.getUser('user');
        var amount = interaction.options.getInteger('amount') || 1;

        await interaction.deferReply({ ephemeral: true });

        var result = await points.removePoint(interaction.client, target.id, {
            amount: amount,
            removedBy: interaction.user.id,
        });

        if (!result.ok) {
            var msg = result.error === 'no active points'
                ? '<:e_decline:1397829342079483904> <@' + target.id + '> has no active points to remove.'
                : '<:e_decline:1397829342079483904> Failed to remove point: `' + (result.error || 'unknown error') + '`';
            return interaction.editReply({ content: msg });
        }

        var embed = new EmbedBuilder()
            .setTitle('<:e_accept:1397829338367393853> Points Removed')
            .setColor(0x080C96)
            .setDescription(
                '**Employee:** <@' + target.id + '> (`' + (result.robloxUsername || target.username) + '`)\n' +
                '**Points removed:** ' + result.removed + '\n' +
                '**Active points now:** ' + result.total + ' / 9'
            )
            .setTimestamp()
            .setFooter({ text: 'Removed by ' + interaction.user.username });

        await interaction.editReply({ embeds: [embed] });
    },
};
