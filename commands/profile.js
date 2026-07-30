const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const personnelProfile = require('../utils/personnelProfile');

function buildIdentityValue(profile) {
    var lines = [];
    if (profile.roblox.displayName) lines.push('**Display Name:** ' + profile.roblox.displayName);
    lines.push('**Username:** ' + (profile.roblox.username || 'Unavailable'));
    lines.push('**User ID:** ' + (profile.roblox.id || 'Unavailable'));
    if (profile.roblox.profileUrl) lines.push('**Profile:** ' + profile.roblox.profileUrl);
    if (!profile.roblox.linked) {
        lines.push('**Bloxlink:** Not linked');
    }
    return lines.join('\n');
}

function buildPerformanceValue(profile) {
    var pointsLabel = typeof profile.activePoints === 'number'
        ? profile.activePoints + ' / 9'
        : 'Unavailable';

    return [
        '**Monthly wage:** ' + profile.monthlyWage + ' R$',
        '**Flights attended:** ' + profile.flightsThisMonth + ' / ' + profile.quota,
        '**Flights attended total:** ' + profile.totalFlightsAttended,
        '**Training sessions hosted:** ' + profile.trainingWage.rows.length,
        '**Active points:** ' + pointsLabel,
    ].join('\n');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View a United Volare personnel profile')
        .addUserOption(function (opt) {
            return opt
                .setName('user')
                .setDescription('Discord user to look up')
                .setRequired(false);
        })
        .addStringOption(function (opt) {
            return opt
                .setName('username')
                .setDescription('Discord mention/ID or Roblox username')
                .setRequired(false)
                .setMaxLength(50);
        }),

    async execute(interaction) {
        if (interaction.guildId !== personnelProfile.VOLARE_GUILD_ID) {
            return interaction.reply({
                content: '<:e_decline:1397829342079483904> This command can only be used in the United Volare server.',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        var resolved = await personnelProfile.resolveProfileTarget(
            interaction.client,
            interaction.guild,
            {
                user: interaction.options.getUser('user'),
                query: interaction.options.getString('username'),
            },
            interaction.user.id
        );

        if (!resolved.ok) {
            return interaction.editReply({
                content: '<:e_decline:1397829342079483904> ' + resolved.error,
            });
        }

        var profile = await personnelProfile.buildPersonnelProfile(resolved.target);
        var displayName = profile.discord.displayName || profile.discord.username || profile.roblox.username || 'Unknown Employee';

        var embed = new EmbedBuilder()
            .setTitle('United Volare Personnel Profile')
            .setColor(0x080C96)
            .setDescription(
                profile.discord.mention + '\n' +
                '**Month:** ' + profile.monthLabel + '\n' +
                '**Discord:** ' + (profile.discord.username || 'Unavailable')
            )
            .addFields(
                { name: 'Roblox Identity', value: buildIdentityValue(profile), inline: true },
                { name: 'Performance', value: buildPerformanceValue(profile), inline: true },
                {
                    name: 'Wage Breakdown',
                    value:
                        '**Flight pay:** ' + profile.flightWage.total + ' R$\n' +
                        '**Training pay:** ' + profile.trainingWage.total + ' R$\n' +
                        '**Total:** ' + profile.monthlyWage + ' R$',
                    inline: false,
                },
                { name: 'Flight Pay Details', value: profile.flightLines, inline: false },
                { name: 'Training Pay Details', value: profile.trainingLines, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'United Volare • ' + displayName });

        if (profile.roblox.avatarUrl) {
            embed.setThumbnail(profile.roblox.avatarUrl);
        }

        await interaction.editReply({ embeds: [embed] });
    },
};
