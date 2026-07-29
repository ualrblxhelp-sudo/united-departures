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

        var view = await trainingPanel.buildTrainingPanelView(1);
        trainingPanel.syncTrainingPanel(interaction.client).catch(function (err) {
            console.error('[TrainingPanel] Thread sync error:', err);
        });
        return interaction.editReply({ embeds: [view.embed], components: view.components });
    },

    async handleButton(interaction) {
        if (interaction.guildId !== ids.AVIATE_SERVER_ID) {
            return interaction.reply({ content: 'This button can only be used in the United Aviate server.', ephemeral: true });
        }

        if (interaction.customId === 'tp_info') {
            return interaction.deferUpdate();
        }

        var match = interaction.customId.match(/^tp_(?:prev|next)_(\d+)$/);
        if (!match) return;

        var requestedPage = Number(match[1]) || 1;
        var view = await trainingPanel.buildTrainingPanelView(requestedPage);
        return interaction.update({ embeds: [view.embed], components: view.components });
    },
};
