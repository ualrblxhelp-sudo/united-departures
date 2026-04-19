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
            return interaction.reply({ content: '<:e_decline:1397829342079483904> This command can only be used in the United Volare server.', ephemeral: true });
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
            new ButtonBuilder().setCustomId('inactivity_approve_' + interaction.user.id).setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji({ id: '1397829338367393853', name: 'e_accept' }),
            new ButtonBuilder().setCustomId('inactivity_deny_' + interaction.user.id).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji({ id: '1397829342079483904', name: 'e_decline' }),
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
            content: '<:e_accept:1397829338367393853> Your leave of absence notice has been submitted. Management will review it shortly.',
            ephemeral: true,
        });
    },

    async handleApprove(interaction, userId) {
        await interaction.deferUpdate();
        try {
            var user = await interaction.client.users.fetch(userId);
            var approveEmbed = new EmbedBuilder()
                .setTitle('<:e_accept:1397829338367393853> Leave of Absence Approved')
                .setColor(0x080C96)
                .setDescription(
                    '> <:e_arrow:1406847964655259710> Thank you for contacting United Volare regarding your request for a Leave of Absence. Your line supervisor, in conjunction with Human Resources, has reviewed your request and has made the decision to **approve** your notice of inactivity. Based on the duration of this absence, your monthly quota will be reduced or set to zero for the month.\n' +
                    '> \n' +
                    '> United Airlines wishes you the best on your Leave of Absence.\n' +
                    '<:UnitedPolaris:1298320157424488479> \u0262\u1D0F\u1D0F\u1D05 \u029F\u1D07\u1D00\u1D05\ua731 \u1D1B\u029C\u1D07 \u1D21\u1D00\u028F\n' +
                    '<:d_staralliance:1397830727919337493> \u1D00 \ua731\u1D1B\u1D00\u0280 \u1D00\u029F\u029F\u026A\u1D00\u0274\u1D04\u1D07 \u1D0D\u1D07\u1D0D\u0299\u1D07\u0280'
                )
                .setTimestamp()
                .setFooter({ text: 'United Volare \u2022 Human Resources' });
            await user.send({ embeds: [approveEmbed] });
        } catch (err) {
            console.error('[Inactivity] DM error:', err);
        }

        // Update the original message
        var originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x080C96)
            .setTitle('<:e_accept:1397829338367393853> Leave of Absence \u2014 Approved');
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
                .setTitle('<:e_decline:1397829342079483904> Leave of Absence Denied')
                .setColor(0x080C96)
                .setDescription(
                    '> <:e_arrow:1406847964655259710> Thank you for contacting United Volare regarding your request for a Leave of Absence. Your line supervisor, in conjunction with Human Resources, has reviewed your request and has made the decision to **reject** your notice of inactivity.\n' +
                    '> \n' +
                    '> This can be due to **poor timing**, **invalid reasoning**, or **many more** reasons. We apologize for your frustration; however, our decision is final, and can only be re evaluated upon a valid request.\n' +
                    '<:UnitedPolaris:1298320157424488479> \u0262\u1D0F\u1D0F\u1D05 \u029F\u1D07\u1D00\u1D05\ua731 \u1D1B\u029C\u1D07 \u1D21\u1D00\u028F\n' +
                    '<:d_staralliance:1397830727919337493> \u1D00 \ua731\u1D1B\u1D00\u0280 \u1D00\u029F\u029F\u026A\u1D00\u0274\u1D04\u1D07 \u1D0D\u1D07\u1D0D\u0299\u1D07\u0280'
                )
                .setTimestamp()
                .setFooter({ text: 'United Volare \u2022 Human Resources' });
            await user.send({ embeds: [denyEmbed] });
        } catch (err) {
            console.error('[Inactivity] DM error:', err);
        }

        // Update the original message
        var originalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x080C96)
            .setTitle('<:e_decline:1397829342079483904> Leave of Absence \u2014 Denied');
        originalEmbed.setFooter({ text: 'Denied by ' + interaction.user.username });

        await interaction.editReply({
            embeds: [originalEmbed],
            components: [],
        });
    },
};
