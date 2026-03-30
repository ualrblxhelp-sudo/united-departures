const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');

var MANAGEMENT_ROLE_ID = '1309724300156207216';
var VOLARE_SERVER_ID = '1309560657473179679';

var pendingFires = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fire')
        .setDescription('Terminate an employee from United Airlines')
        .addStringOption(function(opt) {
            return opt.setName('id').setDescription('Discord User ID of the employee').setRequired(true);
        }),

    async execute(interaction) {
        if (interaction.guildId !== VOLARE_SERVER_ID) {
            return interaction.reply({ content: '\u274C This command can only be used in the United Volare server.', ephemeral: true });
        }
        if (!interaction.member.roles.cache.has(MANAGEMENT_ROLE_ID)) {
            return interaction.reply({ content: '\u274C You do not have permission to use this command.', ephemeral: true });
        }

        var targetId = interaction.options.getString('id').trim();
        var match = targetId.match(/(\d{17,20})/);
        if (!match) {
            return interaction.reply({ content: '\u274C Invalid Discord User ID.', ephemeral: true });
        }
        targetId = match[1];

        if (targetId === interaction.user.id) {
            return interaction.reply({ content: '\u274C You cannot terminate yourself.', ephemeral: true });
        }

        var guild = interaction.client.guilds.cache.get(VOLARE_SERVER_ID);
        var member = await guild.members.fetch(targetId).catch(function() { return null; });
        if (!member) {
            return interaction.reply({ content: '\u274C User not found in the server.', ephemeral: true });
        }

        pendingFires.set(interaction.user.id, {
            targetId: targetId,
            targetTag: member.user.username,
        });

        var row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fire_confirm').setLabel('Confirm Termination').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('fire_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({
            content: '\u26A0\uFE0F Are you sure you want to terminate **' + member.user.username + '** (<@' + targetId + '>)?\n\nThis will DM them a termination notice and kick them from the server. **This cannot be undone.**',
            components: [row],
            ephemeral: true,
        });
    },

    async handleConfirm(interaction) {
        var pending = pendingFires.get(interaction.user.id);
        if (!pending) return interaction.update({ content: '\u274C Session expired.', components: [] });

        await interaction.deferUpdate();

        var guild = interaction.client.guilds.cache.get(VOLARE_SERVER_ID);
        var member = await guild.members.fetch(pending.targetId).catch(function() { return null; });
        if (!member) {
            pendingFires.delete(interaction.user.id);
            return interaction.editReply({ content: '\u274C Employee is no longer in the server.', components: [] });
        }

        // DM the employee
        try {
            var dmContent =
                '<:volare_hammer:1408484978362290287> **Official Termination Notice**\n' +
                '`Alejandro Garnacho \u2022 Human Resources`\n' +
                '> <:volare_arrow:1408298312448086056> To the intended employee, this message serves as an official termination notice of your employment with United Airlines, effective immediately.\n' +
                '> \n' +
                '> This decision has been made after careful consideration and could be based on performance concerns, policy violations, or future business needs. Despite prior discussions and opportunities for improvement, the necessary changes may have not been achieved.\n' +
                '<:volare_tail:1076723231391744050> You will be removed from all United Airlines\' internal servers and communications platforms. We appreciate your contributions during your time with United Airlines and wish you the best in your future endeavors.\n' +
                '-# <:volare_fa:1408481918177251438> Sent from the Human Resources Department\n' +
                '-# <:d_staralliance:1297074894164463628> \u1D00 \uA731\u1D1B\u1D00\u0280 \u1D00\u029F\u029F\u026A\u1D00\u0274\u1D04\u1D07 \u1D0D\u1D07\u1D0D\u1D03\u1D07\u0280';

            await member.user.send({ content: dmContent });
        } catch (err) {
            console.error('[Fire] DM error:', err);
        }

        // Kick from server
        try {
            await member.kick('Terminated by ' + interaction.user.username);
        } catch (err) {
            console.error('[Fire] Kick error:', err);
            pendingFires.delete(interaction.user.id);
            return interaction.editReply({ content: '\u274C Failed to kick the employee. Make sure the bot has Kick Members permission and the employee is not a higher role.', components: [] });
        }

        pendingFires.delete(interaction.user.id);
        await interaction.editReply({
            content: '<:volare_check:1408484391348605069> **' + pending.targetTag + '** has been terminated from United Airlines.',
            components: [],
        });
    },

    async handleCancel(interaction) {
        pendingFires.delete(interaction.user.id);
        await interaction.update({ content: '\u274C Termination cancelled.', components: [] });
    },
};
