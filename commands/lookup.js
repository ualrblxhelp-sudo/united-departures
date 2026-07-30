const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const permissions = require('../services/permissions');
const personnelProfile = require('../utils/personnelProfile');
const points = require('../utils/points');

var VOLARE_GUILD_ID = '1309560657473179679';
var HR_GATE_ROLE_ID = '1309564310539997196';

function buttonId(action, targetId) {
    return 'lu_btn_' + action + '_' + targetId;
}

function modalId(action, targetId) {
    return 'lu_modal_' + action + '_' + targetId;
}

function splitCustomId(value) {
    return String(value || '').split('_');
}

function buildLookupComponents(targetId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(buttonId('warn', targetId)).setLabel('Warning').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(buttonId('suspend', targetId)).setLabel('Suspension').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(buttonId('terminate', targetId)).setLabel('Termination').setStyle(ButtonStyle.Danger),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(buttonId('payment', targetId)).setLabel('Edit Payment').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(buttonId('points', targetId)).setLabel('Edit Points').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(buttonId('position', targetId)).setLabel('Edit Position').setStyle(ButtonStyle.Primary),
        ),
    ];
}

async function ensureHrAccess(interaction) {
    if (interaction.guildId !== VOLARE_GUILD_ID) {
        await interaction.reply({
            content: '<:e_decline:1397829342079483904> This command can only be used in the United Volare server.',
            ephemeral: true,
        }).catch(function () {});
        return false;
    }
    var allowed = await permissions.atOrAboveRole(interaction.client, interaction.user.id, VOLARE_GUILD_ID, HR_GATE_ROLE_ID);
    if (!allowed) {
        await interaction.reply({
            content: '<:e_decline:1397829342079483904> You do not have permission to use this command.',
            ephemeral: true,
        }).catch(function () {});
        return false;
    }
    return true;
}

async function resolveTargetByDiscordId(client, guild, discordId) {
    return personnelProfile.resolveProfileTarget(client, guild, {
        query: String(discordId),
    }, discordId);
}

async function sendLookupView(interaction, targetId, prefixText) {
    var resolved = await resolveTargetByDiscordId(interaction.client, interaction.guild, targetId);
    if (!resolved.ok) {
        return interaction.reply({
            content: '<:e_decline:1397829342079483904> ' + resolved.error,
            ephemeral: true,
        });
    }

    var profile = await personnelProfile.buildPersonnelProfile(resolved.target);
    var embed = personnelProfile.buildProfileEmbed(profile, {
        title: 'United Volare Personnel Lookup',
        color: 0x0b0fa8,
    });

    return interaction.reply({
        content: prefixText || null,
        embeds: [embed],
        components: buildLookupComponents(targetId),
        ephemeral: true,
    });
}

function buildWarnModal(targetId) {
    return new ModalBuilder()
        .setCustomId(modalId('warn', targetId))
        .setTitle('Issue Warning')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Reason')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(500)
            )
        );
}

function buildSuspendModal(targetId) {
    return new ModalBuilder()
        .setCustomId(modalId('suspend', targetId))
        .setTitle('Issue Suspension')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('days')
                    .setLabel('Suspension length in days')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(3)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Reason')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(500)
            )
        );
}

function buildTerminateModal(targetId) {
    return new ModalBuilder()
        .setCustomId(modalId('terminate', targetId))
        .setTitle('Issue Termination')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Reason')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(500)
            )
        );
}

function buildPaymentModal(targetId) {
    return new ModalBuilder()
        .setCustomId(modalId('payment', targetId))
        .setTitle('Edit Payment')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('total')
                    .setLabel('Desired total pay for this month')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(8)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Reason')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(500)
            )
        );
}

function buildPointsModal(targetId) {
    return new ModalBuilder()
        .setCustomId(modalId('points', targetId))
        .setTitle('Edit Points')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('total')
                    .setLabel('Desired active points total (0-9)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(2)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Reason')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(500)
            )
        );
}

function buildPositionModal(targetId) {
    return new ModalBuilder()
        .setCustomId(modalId('position', targetId))
        .setTitle('Edit Position')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('position')
                    .setLabel('New position title')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100)
                    .setPlaceholder('Type clear to remove the manual override')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('Reason')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(500)
            )
        );
}

async function dmEmployee(targetUser, message) {
    if (!targetUser) return false;
    try {
        await targetUser.send({ content: message });
        return true;
    } catch (err) {
        return false;
    }
}

async function handleWarning(interaction, targetId) {
    var reason = interaction.fields.getTextInputValue('reason').trim();
    var member = await interaction.guild.members.fetch(targetId).catch(function () { return null; });
    var user = member ? member.user : await interaction.client.users.fetch(targetId).catch(function () { return null; });

    await personnelProfile.appendPersonnelAction(targetId, {
        type: 'warning',
        reason: reason,
        issuedBy: interaction.user.id,
        issuedByUsername: interaction.user.username,
    });

    await dmEmployee(
        user,
        '<:volare_hammer:1408484978362290287> **Official Warning Notice**\n' +
        '> You have received a formal warning from United Volare Human Resources.\n' +
        '> **Reason:** ' + reason + '\n' +
        '-# Issued by ' + interaction.user.username
    );

    return sendLookupView(interaction, targetId, '<:volare_check:1408484391348605069> Warning issued.');
}

async function handleSuspension(interaction, targetId) {
    var reason = interaction.fields.getTextInputValue('reason').trim();
    var days = Number(interaction.fields.getTextInputValue('days').trim());
    if (!Number.isFinite(days) || days < 1 || days > 365) {
        return interaction.reply({
            content: '<:e_decline:1397829342079483904> Suspension length must be between 1 and 365 days.',
            ephemeral: true,
        });
    }

    var member = await interaction.guild.members.fetch(targetId).catch(function () { return null; });
    var timeoutNote = 'logged only';
    if (member && member.moderatable && days <= 28) {
        try {
            await member.timeout(days * 24 * 60 * 60 * 1000, 'Suspended by ' + interaction.user.username + ': ' + reason);
            timeoutNote = 'Discord timeout applied';
        } catch (err) {
            timeoutNote = 'recorded, but timeout failed';
        }
    } else if (days > 28) {
        timeoutNote = 'recorded only (Discord timeout max is 28 days)';
    }

    var user = member ? member.user : await interaction.client.users.fetch(targetId).catch(function () { return null; });

    await personnelProfile.appendPersonnelAction(targetId, {
        type: 'suspension',
        reason: reason,
        issuedBy: interaction.user.id,
        issuedByUsername: interaction.user.username,
        durationDays: days,
        meta: timeoutNote,
    });

    await dmEmployee(
        user,
        '<:volare_hammer:1408484978362290287> **Official Suspension Notice**\n' +
        '> You have been suspended by United Volare Human Resources.\n' +
        '> **Length:** ' + days + ' day(s)\n' +
        '> **Reason:** ' + reason + '\n' +
        '-# Issued by ' + interaction.user.username
    );

    return sendLookupView(interaction, targetId, '<:volare_check:1408484391348605069> Suspension issued: ' + timeoutNote + '.');
}

async function handleTermination(interaction, targetId) {
    var reason = interaction.fields.getTextInputValue('reason').trim();
    if (String(targetId) === String(interaction.user.id)) {
        return interaction.reply({
            content: '<:e_decline:1397829342079483904> You cannot terminate yourself.',
            ephemeral: true,
        });
    }

    var member = await interaction.guild.members.fetch(targetId).catch(function () { return null; });
    if (!member) {
        return interaction.reply({
            content: '<:e_decline:1397829342079483904> Employee is no longer in the server.',
            ephemeral: true,
        });
    }

    await personnelProfile.appendPersonnelAction(targetId, {
        type: 'termination',
        reason: reason,
        issuedBy: interaction.user.id,
        issuedByUsername: interaction.user.username,
    });

    await dmEmployee(
        member.user,
        '<:volare_hammer:1408484978362290287> **Official Termination Notice**\n' +
        '> Your employment with United Volare has been terminated effective immediately.\n' +
        '> **Reason:** ' + reason + '\n' +
        '-# Issued by ' + interaction.user.username
    );

    try {
        await member.kick('Terminated by ' + interaction.user.username + ': ' + reason);
    } catch (err) {
        return interaction.reply({
            content: '<:e_decline:1397829342079483904> Failed to kick the employee. Check the bot role position and permissions.',
            ephemeral: true,
        });
    }

    return interaction.reply({
        content: '<:volare_check:1408484391348605069> Termination completed for <@' + targetId + '>.',
        ephemeral: true,
    });
}

async function handlePaymentEdit(interaction, targetId) {
    var total = Number(interaction.fields.getTextInputValue('total').trim());
    var reason = interaction.fields.getTextInputValue('reason').trim();
    if (!Number.isFinite(total) || total < 0) {
        return interaction.reply({
            content: '<:e_decline:1397829342079483904> Payment total must be 0 or greater.',
            ephemeral: true,
        });
    }

    var resolved = await resolveTargetByDiscordId(interaction.client, interaction.guild, targetId);
    if (!resolved.ok) {
        return interaction.reply({ content: '<:e_decline:1397829342079483904> ' + resolved.error, ephemeral: true });
    }

    var profile = await personnelProfile.buildPersonnelProfile(resolved.target);
    var delta = total - profile.monthlyWage;
    if (delta !== 0) {
        await personnelProfile.addPaymentAdjustment(targetId, {
            amount: delta,
            reason: reason,
            editedBy: interaction.user.id,
            editedByUsername: interaction.user.username,
        });
    }

    return sendLookupView(
        interaction,
        targetId,
        '<:volare_check:1408484391348605069> Payment updated. Adjustment applied: ' + delta + ' R$.'
    );
}

async function handlePointsEdit(interaction, targetId) {
    var total = Number(interaction.fields.getTextInputValue('total').trim());
    var reason = interaction.fields.getTextInputValue('reason').trim();
    if (!Number.isFinite(total) || total < 0 || total > 9) {
        return interaction.reply({
            content: '<:e_decline:1397829342079483904> Points total must be between 0 and 9.',
            ephemeral: true,
        });
    }

    var current = await points.getActiveCount(targetId).catch(function () { return 0; });
    if (total > current) {
        await points.addPoint(interaction.client, targetId, {
            amount: total - current,
            reason: 'Lookup edit: ' + reason,
            addedBy: interaction.user.id,
            addedByUsername: interaction.user.username,
        });
    } else if (total < current) {
        await points.removePoint(interaction.client, targetId, {
            amount: current - total,
            removedBy: interaction.user.id,
        });
    }

    await personnelProfile.appendPersonnelAction(targetId, {
        type: 'points_edit',
        reason: reason,
        issuedBy: interaction.user.id,
        issuedByUsername: interaction.user.username,
        meta: 'from=' + current + ',to=' + total,
    });

    return sendLookupView(interaction, targetId, '<:volare_check:1408484391348605069> Points updated.');
}

async function handlePositionEdit(interaction, targetId) {
    var input = interaction.fields.getTextInputValue('position').trim();
    var reason = interaction.fields.getTextInputValue('reason').trim();
    var value = /^(clear|default|reset)$/i.test(input) ? '' : input;

    await personnelProfile.setPositionOverride(targetId, {
        position: value,
        reason: reason,
        editedBy: interaction.user.id,
        editedByUsername: interaction.user.username,
    });

    return sendLookupView(
        interaction,
        targetId,
        '<:volare_check:1408484391348605069> Position ' + (value ? 'updated.' : 'reset to default role name.')
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lookup')
        .setDescription('HR personnel lookup and action panel')
        .addStringOption(function (opt) {
            return opt
                .setName('username')
                .setDescription('Discord mention/ID or Roblox username')
                .setRequired(true)
                .setMaxLength(50);
        }),

    async execute(interaction) {
        if (!await ensureHrAccess(interaction)) return;

        await interaction.deferReply({ ephemeral: true });

        var resolved = await personnelProfile.resolveProfileTarget(
            interaction.client,
            interaction.guild,
            { query: interaction.options.getString('username') },
            interaction.user.id
        );

        if (!resolved.ok) {
            return interaction.editReply({
                content: '<:e_decline:1397829342079483904> ' + resolved.error,
            });
        }

        var profile = await personnelProfile.buildPersonnelProfile(resolved.target);
        var embed = personnelProfile.buildProfileEmbed(profile, {
            title: 'United Volare Personnel Lookup',
            color: 0x0b0fa8,
        });

        await interaction.editReply({
            embeds: [embed],
            components: buildLookupComponents(resolved.target.discordId),
        });
    },

    async handleButton(interaction) {
        if (!await ensureHrAccess(interaction)) return;
        var parts = splitCustomId(interaction.customId);
        var action = parts[2];
        var targetId = parts[3];
        if (!action || !targetId) return;

        if (action === 'warn') return interaction.showModal(buildWarnModal(targetId));
        if (action === 'suspend') return interaction.showModal(buildSuspendModal(targetId));
        if (action === 'terminate') return interaction.showModal(buildTerminateModal(targetId));
        if (action === 'payment') return interaction.showModal(buildPaymentModal(targetId));
        if (action === 'points') return interaction.showModal(buildPointsModal(targetId));
        if (action === 'position') return interaction.showModal(buildPositionModal(targetId));
    },

    async handleModal(interaction) {
        if (!await ensureHrAccess(interaction)) return;
        var parts = splitCustomId(interaction.customId);
        var action = parts[2];
        var targetId = parts[3];
        if (!action || !targetId) return;

        if (action === 'warn') return handleWarning(interaction, targetId);
        if (action === 'suspend') return handleSuspension(interaction, targetId);
        if (action === 'terminate') return handleTermination(interaction, targetId);
        if (action === 'payment') return handlePaymentEdit(interaction, targetId);
        if (action === 'points') return handlePointsEdit(interaction, targetId);
        if (action === 'position') return handlePositionEdit(interaction, targetId);
    },
};
