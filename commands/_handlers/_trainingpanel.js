const { PermissionFlagsBits } = require('discord.js');
const ids = require('../../config/ids');
const trainingPanel = require('../../utils/trainingPanel');

module.exports = {
    async execute(interaction) {
        if (interaction.guildId !== ids.AVIATE_SERVER_ID) {
            return interaction.reply({ content: 'This command can only be used in the United Aviate server.', ephemeral: true });
        }
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Only server administrators can use this command.', ephemeral: true });
        }

        await interaction.deferReply();

        var embed = await trainingPanel.buildTrainingPanelEmbed();
        trainingPanel.syncTrainingPanel(interaction.client).catch(function (err) {
            console.error('[TrainingPanel] Thread sync error:', err);
        });
        return interaction.editReply({ embeds: [embed] });
    },
};
