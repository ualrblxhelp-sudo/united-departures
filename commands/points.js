// commands/points.js — View an employee's active sanction points
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const points = require('../utils/points');

var VOLARE_GUILD_ID = '1309560657473179679';
var MANAGEMENT_ROLE_ID = '1309724300156207216';

function formatDate(d) {
    if (!d) return '?';
    return '<t:' + Math.floor(new Date(d).getTime() / 1000) + ':D>';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('points')
        .setDescription('View an employee\'s active sanction points')
        .addUserOption(function(opt) {
            return opt.setName('user').setDescription('Employee (defaults to you)').setRequired(false);
        }),

    async execute(interaction) {
        if (interaction.guildId !== VOLARE_GUILD_ID) {
            return interaction.reply({ content: '<:e_decline:1397829342079483904> This command can only be used in the United Volare server.', ephemeral: true });
        }

        var target = interaction.options.getUser('user') || interaction.user;
        var selfCheck = target.id === interaction.user.id;

        if (!selfCheck && !interaction.member.roles.cache.has(MANAGEMENT_ROLE_ID)) {
            return interaction.reply({ content: '<:e_decline:1397829342079483904> You can only view your own points.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        var records = await points.getActiveRecords(target.id);
        var count = records.length;

        var lines = [];
        lines.push('**Employee:** <@' + target.id + '>');
        lines.push('**Active points:** ' + count + ' / 9');
        lines.push('');
        lines.push('Thresholds: **3** = First Suspension \u00B7 **6** = Second Suspension \u00B7 **9** = Termination');

        if (count > 0) {
            lines.push('');
            lines.push('**Active records:**');
            for (var i = 0; i < Math.min(records.length, 10); i++) {
                var r = records[i];
                var addedBy = r.addedBy === 'system' ? 'system' : (r.addedByUsername || '<@' + r.addedBy + '>');
                lines.push('\u2022 Added ' + formatDate(r.addedAt) + ' \u2014 expires ' + formatDate(r.expiresAt) + ' \u2014 _' + r.reason + '_ (by ' + addedBy + ')');
            }
            if (records.length > 10) {
                lines.push('_\u2026 and ' + (records.length - 10) + ' more_');
            }
        }

        var embed = new EmbedBuilder()
            .setTitle('Sanction Points \u2014 ' + target.username)
            .setColor(count >= 9 ? 0xC41E3A : count >= 6 ? 0xE67E22 : count >= 3 ? 0xF1C40F : 0x080C96)
            .setDescription(lines.join('\n'))
            .setTimestamp()
            .setFooter({ text: 'United Volare \u2022 Sanction System' });

        await interaction.editReply({ embeds: [embed] });
    },
};
