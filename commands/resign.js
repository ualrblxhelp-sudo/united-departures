const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');

const ResignationRequest = require('../models/ResignationRequest');
const ids = require('../config/ids');

var VOLARE_GUILD_ID = '1309560657473179679';
var RESIGN_APPROVER_ROLE_ID = '1486059204534997201';
var APPROVE_EMOJI = { id: '1408484391348605069', name: 'volare_check' };
var DENY_EMOJI = { id: '1408484388681027614', name: 'volare_reject' };
var EMBED_COLOR = 0x4D1B55;

function mentionlessUsername(user) {
    return '@' + String(user && user.username ? user.username : 'employee');
}

function pendingDmEmbed(user) {
    return new EmbedBuilder()
        .setColor(0x080C96)
        .setColor(EMBED_COLOR)
        .setDescription(
            '-# _ _\n' +
            '> ### <:volare_hammer:1408481914112835755> **Your Resignation is in the Works.**\n' +
            '-# **Resignation Confirmation** — The Presidency\n\n' +
            '> <:volare_arrow:1408485394747490385>Hello, **' + mentionlessUsername(user) + '**! We are very sorry to see you leave United Airlines; however, you should be proud of what you have accomplished here. Currently, our Human Resources team is finalizing your resignation. If approved, another message will be sent to confirm your resignation.\n\n' +
            '<:volare_fa:1408298318861176920> **Jake Marlon**\n' +
            '> -# Executive Vice President, Human Resources'
        )
        .setTimestamp();
}

function approvedDmEmbed(user) {
    return new EmbedBuilder()
        .setColor(0x080C96)
        .setColor(EMBED_COLOR)
        .setDescription(
            '-# _ _\n' +
            '> ### <:volare_hammer:1408481914112835755> **We\'re Sorry to See You Go.**\n' +
            '-# **Resignation Confirmation** — The Presidency\n\n' +
            '> Hello, **' + mentionlessUsername(user) + '**! We want to acknowledge your outstanding tenure at United Airlines. This message serves to **confirm your resignation**. While we are saddened by your departure, we will always cherish the wonderful memories you created during your time with us. **We wish you all the best in your future endeavors**.\n\n' +
            '> <:volare_arrow:1408485394747490385> Your employment contract with United Airlines has been officially terminated. However, you will receive your final paycheck for the month if you were promised any payment.\n\n' +
            '<:volare_fa:1408298318861176920> **Jake Marlon**\n' +
            '> -# Executive Vice President, Human Resources'
        )
        .setTimestamp();
}

function rejectedDmEmbed(user) {
    return new EmbedBuilder()
        .setColor(0x080C96)
        .setColor(EMBED_COLOR)
        .setDescription(
            '-# _ _\n' +
            '> ### <:volare_hammer:1408481914112835755> **Your Resignation Request has been Rejected.**\n' +
            '-# **Resignation Confirmation** — The Presidency\n\n' +
            '> <:volare_arrow:1408485394747490385>Hello, **' + mentionlessUsername(user) + '**! After further review, we have decided to **reject** this employment resignation request, which means you are to **remain** as a United employee until further notice. If you believe this is a mistake, contact our assistance desk for further assistance.\n\n' +
            '<:volare_fa:1408298318861176920> **Jake Marlon**\n' +
            '> -# Executive Vice President, Human Resources'
        )
        .setTimestamp();
}

function submittedEmbed() {
    return new EmbedBuilder()
        .setColor(0x080C96)
        .setColor(EMBED_COLOR)
        .setDescription(
            '> ### <:volare_check:1408484391348605069> **Resignation Submitted**\n' +
            '> Your resignation request has been submitted for review. Check your DMs for confirmation.'
        )
        .setTimestamp();
}

function alreadyPendingEmbed() {
    return new EmbedBuilder()
        .setColor(0x080C96)
        .setColor(EMBED_COLOR)
        .setDescription(
            '> ### <:volare_reject:1408484388681027614> **Resignation Already Pending**\n' +
            '> You already have a resignation request waiting for review.'
        )
        .setTimestamp();
}

function reviewEmbed(request, reviewerText) {
    var statusEmoji = '<:volare_hammer:1408481914112835755>';
    var statusText = 'Pending Review';
    if (request.status === 'approved') {
        statusEmoji = '<:volare_check:1408484391348605069>';
        statusText = 'Approved';
    } else if (request.status === 'rejected') {
        statusEmoji = '<:volare_reject:1408484388681027614>';
        statusText = 'Rejected';
    }

    return new EmbedBuilder()
        .setColor(0x080C96)
        .setColor(EMBED_COLOR)
        .setTitle('United Volare Resignation Request')
        .setDescription(
            '**Employee:** <@' + request.userId + '> (`' + request.username + '`)\n' +
            '**Discord ID:** ' + request.userId + '\n' +
            '**Status:** ' + statusEmoji + ' ' + statusText + '\n' +
            '**Reason:**\n' + request.reason
        )
        .addFields(
            { name: 'Submitted', value: '<t:' + Math.floor(new Date(request.requestedAt).getTime() / 1000) + ':F>' },
            { name: 'Reviewed By', value: reviewerText || 'Awaiting review' }
        )
        .setTimestamp();
}

function reviewButtons(requestId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('resign_approve_' + requestId)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(APPROVE_EMOJI),
            new ButtonBuilder()
                .setCustomId('resign_deny_' + requestId)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(DENY_EMOJI)
        ),
    ];
}

async function canReview(interaction) {
    if (interaction.guildId !== VOLARE_GUILD_ID) return false;
    return Boolean(
        interaction.member &&
        interaction.member.roles &&
        interaction.member.roles.cache &&
        interaction.member.roles.cache.has(RESIGN_APPROVER_ROLE_ID)
    );
}

async function fetchReviewThread(client) {
    return client.channels.fetch(ids.RESIGNATION_REVIEW_THREAD_ID).catch(function () { return null; });
}

async function finalizeReview(interaction, request, approved) {
    if (!await canReview(interaction)) {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x080C96)
                    .setColor(EMBED_COLOR)
                    .setDescription('> ### <:volare_reject:1408484388681027614> **Unauthorized**\n> You do not have permission to review resignation requests.')
                    .setTimestamp(),
            ],
            ephemeral: true,
        });
    }

    if (!request || request.status !== 'pending') {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x080C96)
                    .setColor(EMBED_COLOR)
                    .setDescription('> ### <:volare_reject:1408484388681027614> **Already Reviewed**\n> This resignation request has already been processed.')
                    .setTimestamp(),
            ],
            ephemeral: true,
        });
    }

    var guild = interaction.client.guilds.cache.get(VOLARE_GUILD_ID) || await interaction.client.guilds.fetch(VOLARE_GUILD_ID).catch(function () { return null; });
    var member = guild ? await guild.members.fetch(request.userId).catch(function () { return null; }) : null;
    if (!member) {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x080C96)
                    .setColor(EMBED_COLOR)
                    .setDescription('> ### <:volare_reject:1408484388681027614> **Employee Not Found**\n> That employee is no longer in the Volare server.')
                    .setTimestamp(),
            ],
            ephemeral: true,
        });
    }

    var dmEmbed = approved ? approvedDmEmbed(member.user) : rejectedDmEmbed(member.user);
    try {
        await member.user.send({ embeds: [dmEmbed] });
    } catch (err) {
        console.error('[Resign] DM error:', err);
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x080C96)
                    .setColor(EMBED_COLOR)
                    .setDescription('> ### <:volare_reject:1408484388681027614> **DM Failed**\n> I could not DM the employee, so the resignation was not finalized.')
                    .setTimestamp(),
            ],
            ephemeral: true,
        });
    }

    if (approved) {
        try {
            await member.kick('Resignation approved by ' + interaction.user.username);
        } catch (err) {
            console.error('[Resign] Kick error:', err);
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x080C96)
                        .setDescription('> ### <:volare_reject:1408484388681027614> **Kick Failed**\n> The approval DM was sent, but I could not kick the employee from Volare.')
                    .setColor(0x080C96)
                    .setColor(EMBED_COLOR)
                    .setDescription('> ### <:volare_reject:1408484388681027614> **Kick Failed**\n> The approval DM was sent, but I could not kick the employee from Volare.')
                        .setTimestamp(),
                ],
                ephemeral: true,
            });
        }
    }

    request.status = approved ? 'approved' : 'rejected';
    request.reviewedAt = new Date();
    request.reviewedBy = interaction.user.id;
    request.reviewedByUsername = interaction.user.username;
    await request.save();

    var reviewedText = '<@' + interaction.user.id + '> (`' + interaction.user.username + '`)';
    await interaction.update({
        embeds: [reviewEmbed(request, reviewedText)],
        components: [],
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resign')
        .setDescription('Submit a resignation request for review')
        .addStringOption(function (opt) {
            return opt
                .setName('reason')
                .setDescription('Reason for your resignation')
                .setRequired(true)
                .setMaxLength(1000);
        }),

    async execute(interaction) {
        if (interaction.guildId !== VOLARE_GUILD_ID) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x080C96)
                        .setColor(EMBED_COLOR)
                        .setDescription('> ### <:volare_reject:1408484388681027614> **Wrong Server**\n> This command can only be used in the United Volare server.')
                        .setTimestamp(),
                ],
                ephemeral: true,
            });
        }

        var existing = await ResignationRequest.findOne({
            userId: interaction.user.id,
            status: 'pending',
        }).sort({ requestedAt: -1 }).catch(function () { return null; });
        if (existing) {
            return interaction.reply({ embeds: [alreadyPendingEmbed()], ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        var reason = interaction.options.getString('reason').trim();
        var request = await ResignationRequest.create({
            userId: interaction.user.id,
            username: interaction.user.username,
            reason: reason,
            status: 'pending',
        });

        try {
            await interaction.user.send({ embeds: [pendingDmEmbed(interaction.user)] });
        } catch (err) {
            console.error('[Resign] Pending DM error:', err);
        }

        var thread = await fetchReviewThread(interaction.client);
        if (thread && typeof thread.send === 'function') {
            var sent = await thread.send({
                embeds: [reviewEmbed(request, 'Awaiting review')],
                components: reviewButtons(request._id.toString()),
            }).catch(function () { return null; });
            if (sent) {
                request.reviewChannelId = sent.channelId;
                request.reviewMessageId = sent.id;
                await request.save();
            }
        } else {
            console.error('[Resign] Review thread not found:', ids.RESIGNATION_REVIEW_THREAD_ID);
        }

        await interaction.editReply({ embeds: [submittedEmbed()] });
    },

    async handleButton(interaction) {
        var match = String(interaction.customId || '').match(/^resign_(approve|deny)_([a-f0-9]{24})$/);
        if (!match) return;

        var action = match[1];
        var requestId = match[2];
        var request = await ResignationRequest.findById(requestId).catch(function () { return null; });
        return finalizeReview(interaction, request, action === 'approve');
    },
};
