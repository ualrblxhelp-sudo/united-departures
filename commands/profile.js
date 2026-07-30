const { SlashCommandBuilder } = require('discord.js');
const personnelProfile = require('../utils/personnelProfile');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your United Volare personnel profile'),

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
            {},
            interaction.user.id
        );

        if (!resolved.ok) {
            return interaction.editReply({
                content: '<:e_decline:1397829342079483904> ' + resolved.error,
            });
        }

        var profile = await personnelProfile.buildPersonnelProfile(resolved.target);
        var embed = personnelProfile.buildProfileEmbed(profile, {
            title: 'United Volare Personnel Profile',
        });
        await interaction.editReply({ embeds: [embed] });
    },
};
