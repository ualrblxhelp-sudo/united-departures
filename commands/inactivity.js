const {
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');

var INACTIVITY_CHANNEL_ID = process.env.INACTIVITY_CHANNEL_ID;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('inactivity')
        .setDescription('Submit a leave of absence / inactivity notice'),

    async execute(interaction) {
        if (interaction.guildId !== '1309560657473179679') {
            return interaction.reply({ content: '\u274C This command can only be used in the United Volare server.', ephemeral: true });
        }

        var modal = new ModalBuilder()
            .setCustomId('inactivity_modal')
            .setTitle('Leave of Absence Notice');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('roblox_username').setLabel('Roblox Username').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('start_date').setLabel('Start Date').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. March 25, 2026')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('end_date').setLabel('End Date').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g. April 5, 2026')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('reason').setLabel('Reason for Leave').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setPlaceholder('Explain why you will be inactive...')
            ),
        );

        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction) {
        var robloxUsername = interaction.fields.getTextInputValue('roblox_username').trim();
        var startDate = interaction.fields.getTextInputValue('start_date').trim();
        var endDate = interaction.fields.getTextInputValue('end_date').trim();
        var reason = interaction.fields.getTextInputValue('reason').trim();

        var embed = new EmbedBuilder()
            .setTitle('Leave of Absence Notice')
            .setColor(0x45194c)
            .setDescription(
                '**Employee:** <@' + interaction.user.id + '> (' + interaction.user.username + ')\n' +
                '**Roblox:** ' + robloxUsername + '\n' +
                '**Discord ID:** ' + interaction.user.id + '\n\n' +
                '**Start Date:** ' + startDate + '\n' +
                '**End Date:** ' + endDate + '\n\n' +
                '**Reason:**\n' + reason
            )
            .setTimestamp()
            .setFooter({ text: 'Inactivity Notice \u2022 Submitted by ' + interaction.user.username });

        var row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('inactivity_approve_' + interaction.user.id).setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji({ id: '1408484391348605069', name: 'volare_check' }),
            new ButtonBuilder().setCustomId('inactivity_deny_' + interaction.user.id).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji({ id: '1408481910098890824', name: 'volare_no' }),
        );

        try {
            var guild = interaction.client.guilds.cache.get('1309560657473179679');
            var channel = null;
            if (INACTIVITY_CHANNEL_ID && guild) {
                channel = guild.channels.cache.get(INACTIVITY_CHANNEL_ID);
                if (!channel) channel = await guild.channels.fetch(INACTIVITY_CHANNEL_ID).catch(function() { return null; });
            }
            if (channel) {
                await channel.send({ embeds: [embed], components: [row] });
            } else {
                console.error('[Inactivity] Channel not found: ' + INACTIVITY_CHANNEL_ID);
            }
        } catch (err) {
            console.error('[Inactivity] Error:', err);
        }

        await interaction.reply({
            content: '<:volare_check:1408484391348605069> Your leave of absence notice has been submitted. Management will review it shortly.',
            ephemeral: true,
        });
    },

    async handleApprove(interaction, userId) {
        await interaction.deferUpdate();
        try {
            var user = await interaction.client.users.fetch(userId);
            var approveEmbed = new EmbedBuilder()
                .setTitle('<:volare_check:1408484391348605069> Leave of Absence Approved')
                .setColor(0x00CC00)
                .setDescription('Your leave of absence notice has been **approved** by <@' + interaction.user.id + '>.\n\nPlease ensure you return on the date specified in your notice.')
                .setTimestamp()
                .setFooter({ text: 'United Volare \u2022 Inactivity Management' });
            await user.send({ embeds: [approveEmbed] });
        } catch (err) {
            console.error('[Inactivity] DM error:', err);
        }

        // Update the original message
        var originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x00CC00)
            .setTitle('\u2705 Leave of Absence — Approved');
        originalEmbed.setFooter({ text: 'Approved by ' + interaction.user.username });

        await interaction.editReply({
            embeds: [originalEmbed],
            components: [],
        });
    },

    async handleDeny(interaction, userId) {
        await interaction.deferUpdate();
        try {
            var user = await interaction.client.users.fetch(userId);
            var denyEmbed = new EmbedBuilder()
                .setTitle('\u274C Leave of Absence Denied')
                .setColor(0xFF0000)
                .setDescription('Your leave of absence notice has been **denied** by <@' + interaction.user.id + '>.\n\nPlease reach out to management if you have questions.')
                .setTimestamp()
                .setFooter({ text: 'United Volare \u2022 Inactivity Management' });
            await user.send({ embeds: [denyEmbed] });
        } catch (err) {
            console.error('[Inactivity] DM error:', err);
        }

        // Update the original message
        var originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0xFF0000)
            .setTitle('\u274C Leave of Absence — Denied');
        originalEmbed.setFooter({ text: 'Denied by ' + interaction.user.username });

        await interaction.editReply({
            embeds: [originalEmbed],
            components: [],
        });
    },
};
