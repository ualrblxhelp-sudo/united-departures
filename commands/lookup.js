const {
    SlashCommandBuilder,
    EmbedBuilder,
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
const suspensionReturns = require('../utils/suspensionReturns');
const ids = require('../config/ids');

var VOLARE_GUILD_ID = '1309560657473179679';
var MAIN_SERVER_ID = '1309560657473179679';
var LOOKUP_ROLE_ID = '1486059204534997201';
var EMBED_COLOR = 0x4D1B55;
var DISCIPLINARY_MANUAL_URL = 'https://docs.google.com/document/d/1Q38Q60kB03Un89TWlOtkN6Pl2RIPHa4GYqSerU62GS0/edit?usp=drive_link';
var COMMITMENT_POLICY_URL = 'https://drive.google.com/file/d/1MHANmDI87qfDi_76QZq84hrPRSwo4Xal/view?usp=sharing';
var SUSPENSION_DAYS = 7;

function mentionlessUsername(user) {
    return '@' + String(user && user.username ? user.username : 'employee');
}

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
            new ButtonBuilder().setCustomId(buttonId('terminate', targetId)).setLabel('Termination').setStyle(ButtonStyle.Secondary),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(buttonId('payment', targetId)).setLabel('Edit Payment').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(buttonId('points', targetId)).setLabel('Edit Points').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(buttonId('position', targetId)).setLabel('Edit Position').setStyle(ButtonStyle.Secondary),
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
    var member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(function () { return null; });
    var allowed = Boolean(member && member.roles && member.roles.cache && member.roles.cache.has(LOOKUP_ROLE_ID));
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
        color: EMBED_COLOR,
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
                    .setLabel('Internal note')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
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
                    .setCustomId('reason')
                    .setLabel('Internal note')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
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
                    .setLabel('Internal note')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
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
        await targetUser.send({ embeds: [message] });
        return true;
    } catch (err) {
        return false;
    }
}

function warningEmbed(user) {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription(
            '-# _ _\n' +
            '> ### <:volare_hammer:1408481914112835755> **This is a Warning.**\n' +
            '-# **Resignation Confirmation** — Human Resources\n\n' +
            '> <:volare_arrow:1408485394747490385>Hello, **' + mentionlessUsername(user) + '**. You have been assigned **1** warning due to your violation of a policy listed in our [**Disciplinary Manual**](<' + DISCIPLINARY_MANUAL_URL + '>). Please ensure to not commit any sort of actions that violate our regulations in the future.\n\n' +
            '<:volare_fa:1408298318861176920> **Jake Marlon**\n' +
            '> -# Executive Vice President, Human Resources'
        )
        .setTimestamp();
}

function suspensionEmbed(user) {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription(
            '-# _ _\n' +
            '> ### <:volare_hammer:1408481914112835755> **Suspension Notice.**\n' +
            '-# **You have received a Suspension** — Human Resources\n\n' +
            '> <:volare_arrow:1408485394747490385>Hello, **' + mentionlessUsername(user) + '**. You have been assigned a **7** day suspension for violating a **major** regulation(s) listed in our [**Disciplinary Manual**](<' + DISCIPLINARY_MANUAL_URL + '>) and our general [**Commitment Policy**](<' + COMMITMENT_POLICY_URL + '>). You may message your **line manager** or **department head** to appeal a suspension.\n\n' +
            '<:volare_fa:1408298318861176920> **Jake Marlon**\n' +
            '> -# Executive Vice President, Human Resources'
        )
        .setTimestamp();
}

function terminationEmbed(user) {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription(
            '-# _ _\n' +
            '> ### <:volare_hammer:1408481914112835755> **Termination Notice.**\n' +
            '-# **You have received a Termination** — Human Resources\n\n' +
            '> <:volare_arrow:1408485394747490385>Hello, **' + mentionlessUsername(user) + '**. After a thorough review, we regret to inform you that you have received an official **termination** notice from United Airlines. This decision has been made due to multiple violations and increasing reports regarding your conduct, which prompted us to assess your tenure at the company. We wish you all the best in your future endeavors.\n\n' +
            '<:volare_fa:1408298318861176920> **Jake Marlon**\n' +
            '> -# Executive Vice President, Human Resources'
        )
        .setTimestamp();
}

async function kickFromGuild(client, guildId, targetId, reason) {
    if (!guildId) return { ok: false, reason: 'guild_not_configured' };
    var guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(function () { return null; });
    if (!guild) return { ok: false, reason: 'guild_not_found' };
    var member = await guild.members.fetch(targetId).catch(function () { return null; });
    if (!member) return { ok: true, skipped: true };
    try {
        await member.kick(reason);
        return { ok: true };
    } catch (err) {
        return { ok: false, reason: err && err.message ? err.message : 'kick_failed' };
    }
}

async function handleWarning(interaction, targetId) {
    var reason = interaction.fields.getTextInputValue('reason').trim();
    var member = await interaction.guild.members.fetch(targetId).catch(function () { return null; });
    var user = member ? member.user : await interaction.client.users.fetch(targetId).catch(function () { return null; });

    var warned = await dmEmployee(user, warningEmbed(user));
    if (!warned) {
        return interaction.reply({
            content: '<:e_decline:1397829342079483904> I could not DM this employee the warning notice.',
            ephemeral: true,
        });
    }

    await personnelProfile.appendPersonnelAction(targetId, {
        type: 'warning',
        reason: reason,
        issuedBy: interaction.user.id,
        issuedByUsername: interaction.user.username,
    });

    return sendLookupView(interaction, targetId, '<:volare_check:1408484391348605069> Warning issued.');
}

async function handleSuspension(interaction, targetId) {
    var reason = interaction.fields.getTextInputValue('reason').trim();
    var member = await interaction.guild.members.fetch(targetId).catch(function () { return null; });
    if (!member) {
        return interaction.reply({
            content: '<:e_decline:1397829342079483904> Employee is no longer in the server.',
            ephemeral: true,
        });
    }

    var timeoutNote = 'timeout applied';
    var returnAt = new Date(Date.now() + (SUSPENSION_DAYS * 24 * 60 * 60 * 1000));
    var user = member.user || await interaction.client.users.fetch(targetId).catch(function () { return null; });

    var notified = await dmEmployee(user, suspensionEmbed(user));
    if (!notified) {
        return interaction.reply({
            content: '<:e_decline:1397829342079483904> I could not DM this employee the suspension notice.',
            ephemeral: true,
        });
    }

    if (member.moderatable) {
        try {
            await member.timeout(SUSPENSION_DAYS * 24 * 60 * 60 * 1000, 'Suspended by ' + interaction.user.username + (reason ? ': ' + reason : ''));
        } catch (err) {
            timeoutNote = 'kick fallback scheduled';
        }
    }

    if (timeoutNote !== 'timeout applied') {
        var kickResult = await kickFromGuild(interaction.client, VOLARE_GUILD_ID, targetId, 'Suspended by ' + interaction.user.username + (reason ? ': ' + reason : ''));
        if (!kickResult.ok) {
            return interaction.reply({
                content: '<:e_decline:1397829342079483904> I could not timeout or kick this employee for the suspension.',
                ephemeral: true,
            });
        }
        await suspensionReturns.queueReturnInvite(VOLARE_GUILD_ID, targetId, user ? user.username : '', returnAt);
    }

    await personnelProfile.appendPersonnelAction(targetId, {
        type: 'suspension',
        reason: reason,
        issuedBy: interaction.user.id,
        issuedByUsername: interaction.user.username,
        durationDays: SUSPENSION_DAYS,
        meta: timeoutNote,
    });

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

    var terminatedNotified = await dmEmployee(member.user, terminationEmbed(member.user));
    if (!terminatedNotified) {
        return interaction.reply({
            content: '<:e_decline:1397829342079483904> I could not DM this employee the termination notice.',
            ephemeral: true,
        });
    }

    var volareKick = await kickFromGuild(interaction.client, VOLARE_GUILD_ID, targetId, 'Terminated by ' + interaction.user.username + (reason ? ': ' + reason : ''));
    var mainKick = await kickFromGuild(interaction.client, ids.CALENDAR_SERVER_ID, targetId, 'Terminated by ' + interaction.user.username + (reason ? ': ' + reason : ''));
    if (!volareKick.ok || !mainKick.ok) {
        return interaction.reply({
            content: '<:e_decline:1397829342079483904> Failed to remove the employee from one or more United servers.',
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
            color: EMBED_COLOR,
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
