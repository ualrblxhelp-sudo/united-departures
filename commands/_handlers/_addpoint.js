const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const points = require('../../../utils/points');

var VOLARE_GUILD_ID = '1309560657473179679';
var MANAGEMENT_ROLE_ID = '1309724300156207216';

module.exports = {
    data: new SlashCommandBuilder()
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
        var reason = interaction.options.getString('reason') || 'No reason provided';

        if (target.bot) {
            return interaction.reply({ content: '<:e_decline:1397829342079483904> Cannot sanction a bot.', ephemeral: true });
        }
        if (target.id === interaction.user.id) {
            return interaction.reply({ content: '<:e_decline:1397829342079483904> You cannot sanction yourself.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        var result = await points.addPoint(interaction.client, target.id, {
            amount: amount,
            reason: reason,
            addedBy: interaction.user.id,
            addedByUsername: interaction.user.username,
        });

        if (!result.ok) {
            return interaction.editReply({
                content: '<:e_decline:1397829342079483904> Failed to add point: `' + (result.error || 'unknown error') + '`',
            });
        }

        var embed = new EmbedBuilder()
            .setTitle('<:e_accept:1397829338367393853> Point Added')
            .setColor(0x080C96)
            .setDescription(
                '**Employee:** <@' + target.id + '> (`' + (result.robloxUsername || target.username) + '`)\n' +
                '**Points added:** ' + amount + '\n' +
                '**Active points now:** ' + result.total + ' / 9\n' +
                '**Reason:** ' + reason
            )
            .setTimestamp()
            .setFooter({ text: 'Added by ' + interaction.user.username });

        await interaction.editReply({ embeds: [embed] });
    },
};
