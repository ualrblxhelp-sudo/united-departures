const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const engagement = require('../utils/engagement');

var VOLARE_GUILD_ID = '1309560657473179679';
var MANAGEMENT_ROLE_ID = '1309724300156207216';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('regenerateweek')
        .setDescription('Regenerate this week\'s PR rotation (only affects days that haven\'t been assigned yet)'),

    async execute(interaction) {
        if (interaction.guildId !== VOLARE_GUILD_ID) {
            return interaction.reply({ content: '<:e_decline:1397829342079483904> This command can only be used in the United Volare server.', ephemeral: true });
        }
        if (!interaction.member.roles.cache.has(MANAGEMENT_ROLE_ID)) {
            return interaction.reply({ content: '<:e_decline:1397829342079483904> You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            var weekStart = engagement.centralWeekStartString(new Date());
            var result = await engagement.regenerateWeek(interaction.client, weekStart);

            if (!result.ok) {
                return interaction.editReply({
                    content: '<:e_decline:1397829342079483904> Regeneration failed: ' + (result.error || 'unknown error'),
                });
            }

            var lines = [];
            lines.push('**Week starting:** ' + weekStart);
            lines.push('');
            if (result.lockedDates.length > 0) {
                lines.push('**Locked (already assigned, untouched):** ' + result.lockedDates.length + ' day(s)');
                for (var i = 0; i < result.lockedDates.length; i++) {
                    lines.push('\u2022 ' + result.lockedDates[i]);
                }
                lines.push('');
            }
            if (result.regeneratedDates.length > 0) {
                lines.push('**Regenerated:** ' + result.regeneratedDates.length + ' day(s)');
                for (var d = 0; d < result.rotation.assignments.length; d++) {
                    var a = result.rotation.assignments[d];
                    if (result.regeneratedDates.indexOf(a.date) !== -1) {
                        lines.push('\u2022 ' + a.date + ' \u2192 ' + (a.userId ? '<@' + a.userId + '>' : '_(none — no available members)_'));
                    }
                }
            } else {
                lines.push('_All 7 days were already assigned. No changes made._');
            }

            var embed = new EmbedBuilder()
                .setTitle('<:e_accept:1397829338367393853> Weekly Rotation Regenerated')
                .setColor(0x080C96)
                .setDescription(lines.join('\n'))
                .setTimestamp()
                .setFooter({ text: 'Triggered by ' + interaction.user.username });

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('[regenerateweek] Error:', err);
            try {
                await interaction.editReply({
                    content: '<:e_decline:1397829342079483904> An error occurred: `' + (err && err.message ? err.message : String(err)).slice(0, 1500) + '`\n\nCheck the bot logs for details.',
                });
            } catch (e) {}
        }
    },
};
