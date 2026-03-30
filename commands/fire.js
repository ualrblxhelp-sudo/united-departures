const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} = require('discord.js');

var MANAGEMENT_ROLE_ID = '1309724300156207216';
var VOLARE_SERVER_ID = '1309560657473179679';

var pendingFires = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fire')
        .setDescription('Terminate an employee from United Airlines')
        .addUserOption(function(opt) {
            return opt.setName('employee').setDescription('The employee to terminate').setRequired(true);
        })
        .addStringOption(function(opt) {
            return opt.setName('reason').setDescription('Reason for termination').setRequired(true);
        }),

    async execute(interaction) {
        if (interaction.guildId !== VOLARE_SERVER_ID) {
            return interaction.reply({ content: '\u274C This command can only be used in the United Volare server.', ephemeral: true });
        }
        if (!interaction.member.roles.cache.has(MANAGEMENT_ROLE_ID)) {
            return interaction.reply({ content: '\u274C You do not have permission to use this command.', ephemeral: true });
        }

        var target = interaction.options.getUser('employee');
        var reason = interaction.options.getString('reason');

        if (target.id === interaction.user.id) {
            return interaction.reply({ content: '\u274C You cannot terminate yourself.', ephemeral: true });
        }
        if (target.bot) {
            return interaction.reply({ content: '\u274C You cannot terminate a bot.', ephemeral: true });
        }

        pendingFires.set(interaction.user.id, {
            targetId: target.id,
            targetTag: target.username,
            reason: reason,
        });

        var embed = new EmbedBuilder()
            .setTitle('Confirm Termination')
            .setColor(0xFF0000)
            .setDescription(
                '**Employee:** <@' + target.id + '> (' + target.username + ')\n' +
                '**Reason:** ' + reason + '\n\n' +
                'This will:\n' +
                '\u2022 Send a termination notice to the employee via DM\n' +
                '\u2022 Kick them from the server\n\n' +
                '**This action cannot be undone.**'
            );

        var row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fire_confirm').setLabel('Confirm Termination').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('fire_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    },

    async handleConfirm(interaction) {
        var pending = pendingFires.get(interaction.user.id);
        if (!pending) return interaction.update({ content: '\u274C Session expired.', embeds: [], components: [] });

        await interaction.deferUpdate();

        var guild = interaction.client.guilds.cache.get(VOLARE_SERVER_ID);
        if (!guild) {
            pendingFires.delete(interaction.user.id);
            return interaction.editReply({ content: '\u274C Server not found.', embeds: [], components: [] });
        }

        var member = await guild.members.fetch(pending.targetId).catch(function() { return null; });
        if (!member) {
            pendingFires.delete(interaction.user.id);
            return interaction.editReply({ content: '\u274C Employee is no longer in the server.', embeds: [], components: [] });
        }

        // DM the employee
        try {
            var dmEmbed = new EmbedBuilder()
                .setTitle('United Airlines \u2014 Termination Notice')
                .setColor(0xFF0000)
                .setDescription(
                    'We regret to inform you that your employment with **United Airlines** has been terminated.\n\n' +
                    '**Reason:** ' + pending.reason + '\n\n' +
                    '**Issued by:** ' + interaction.user.username + '\n\n' +
                    'If you believe this was a mistake, you may reach out to management.'
                )
                .setTimestamp()
                .setFooter({ text: 'United Airlines \u2022 Human Resources' });

            await member.user.send({ embeds: [dmEmbed] });
        } catch (err) {
            console.error('[Fire] DM error:', err);
        }

        // Kick from server
        try {
            await member.kick('Terminated by ' + interaction.user.username + ': ' + pending.reason);
        } catch (err) {
            console.error('[Fire] Kick error:', err);
            pendingFires.delete(interaction.user.id);
            return interaction.editReply({ content: '\u274C Failed to kick the employee. Make sure the bot has Kick Members permission and the employee is not a higher role.', embeds: [], components: [] });
        }

        pendingFires.delete(interaction.user.id);
        await interaction.editReply({
            content: '<:volare_check:1408484391348605069> **' + pending.targetTag + '** has been terminated from United Airlines.',
            embeds: [],
            components: [],
        });
    },

    async handleCancel(interaction) {
        pendingFires.delete(interaction.user.id);
        await interaction.update({ content: '\u274C Termination cancelled.', embeds: [], components: [] });
    },
};
