const {
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const Suggestion = require('../models/Suggestion');

var VOLARE_GUILD_ID = '1309560657473179679';
var SUGGESTIONS_CHANNEL_ID = '1496296505709953024';
var APPROVAL_CHANNEL_ID = '1496348536088957009';

var UPVOTE_EMOJI = { id: '1408484391348605069', name: 'volare_check' };
var DOWNVOTE_EMOJI = { id: '1408484388681027614', name: 'volare_reject' };
var UPVOTE_MARKUP = '<:volare_check:1408484391348605069>';
var DOWNVOTE_MARKUP = '<:volare_reject:1408484388681027614>';

var EMBED_COLOR = 0x3A1540;
var TALLY_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

var IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;

// In-process timer handles for live tallying. Repopulated on startup.
var scheduledTallies = new Map();

function isValidUrl(str) {
    if (!str) return false;
    try {
        var u = new URL(str);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

function buildSuggestionEmbed(s) {
    var embed = new EmbedBuilder()
        .setTitle('\uD83D\uDCA1 ' + s.title)
        .setColor(EMBED_COLOR)
        .setTimestamp(s.createdAt || new Date())
        .setAuthor({ name: s.authorUsername });

    var desc = s.description + '\n\n';
    if (s.mediaUrl && !IMAGE_EXT_RE.test(s.mediaUrl)) {
        desc += '**Reference:** ' + s.mediaUrl + '\n\n';
    }
    desc += '**Submitted by:** <@' + s.authorId + '>\n';
    desc += '\u23F0 **Voting closes:** <t:' + Math.floor(new Date(s.tallyAt).getTime() / 1000) + ':R>\n\n';
    desc += UPVOTE_MARKUP + ' **' + (s.upvoters || []).length + '**  \u00B7  ' +
            DOWNVOTE_MARKUP + ' **' + (s.downvoters || []).length + '**';

    embed.setDescription(desc);

    if (s.mediaUrl && IMAGE_EXT_RE.test(s.mediaUrl)) {
        embed.setImage(s.mediaUrl);
    }

    embed.setFooter({ text: 'United Volare \u00B7 Suggestions' });
    return embed;
}

function buildVoteRow(disabled) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('suggest_up')
            .setStyle(ButtonStyle.Success)
            .setEmoji(UPVOTE_EMOJI)
            .setDisabled(!!disabled),
        new ButtonBuilder()
            .setCustomId('suggest_down')
            .setStyle(ButtonStyle.Danger)
            .setEmoji(DOWNVOTE_EMOJI)
            .setDisabled(!!disabled),
    );
}

async function tallySuggestion(client, suggestionId) {
    scheduledTallies.delete(String(suggestionId));
    try {
        var s = await Suggestion.findById(suggestionId);
        if (!s || s.tallied) return;

        var guild = client.guilds.cache.get(s.guildId) || await client.guilds.fetch(s.guildId).catch(function() { return null; });
        if (!guild) {
            console.error('[Suggest] Guild not found for tally:', s.guildId);
            return;
        }

        var channel = guild.channels.cache.get(s.channelId) || await guild.channels.fetch(s.channelId).catch(function() { return null; });
        var message = null;
        if (channel) {
            message = await channel.messages.fetch(s.messageId).catch(function() { return null; });
        }

        var up = (s.upvoters || []).length;
        var down = (s.downvoters || []).length;

        var result;
        if (up > down) result = 'approved';
        else if (up < down) result = 'rejected';
        else result = 'tied';

        s.tallied = true;
        s.tallyResult = result;

        // Lock the original message with final status
        if (message) {
            var finalEmbed = buildSuggestionEmbed(s);
            var statusLine = '\n\n**Status:** ' + (
                result === 'approved' ? UPVOTE_MARKUP + ' Forwarded to management for review' :
                result === 'rejected' ? DOWNVOTE_MARKUP + ' Did not pass community vote' :
                '\u2696\uFE0F Tied \u2014 did not pass community vote'
            );
            var existingDesc = finalEmbed.data.description || '';
            finalEmbed.setDescription(existingDesc + statusLine);
            await message.edit({ embeds: [finalEmbed], components: [buildVoteRow(true)] }).catch(function(e) {
                console.error('[Suggest] Lock edit error:', e);
            });
        }

        // Forward to approval channel if approved
        if (result === 'approved') {
            var approvalChannel = guild.channels.cache.get(APPROVAL_CHANNEL_ID) || await guild.channels.fetch(APPROVAL_CHANNEL_ID).catch(function() { return null; });
            if (approvalChannel) {
                var forwardEmbed = buildSuggestionEmbed(s);
                var baseDesc = forwardEmbed.data.description || '';
                forwardEmbed.setDescription(
                    baseDesc +
                    '\n\n**Final vote:** ' + UPVOTE_MARKUP + ' ' + up + '  \u00B7  ' + DOWNVOTE_MARKUP + ' ' + down +
                    (message ? '\n[Jump to original suggestion](' + message.url + ')' : '')
                );
                forwardEmbed.setFooter({ text: 'United Volare \u00B7 Awaiting Management Review' });
                var sent = await approvalChannel.send({
                    content: 'A community suggestion has passed the vote. Please review this idea for approval.',
                    embeds: [forwardEmbed],
                }).catch(function(e) { console.error('[Suggest] Forward error:', e); return null; });
                if (sent) s.forwardedMessageId = sent.id;
            } else {
                console.error('[Suggest] Approval channel not found:', APPROVAL_CHANNEL_ID);
            }
        }

        await s.save();
    } catch (err) {
        console.error('[Suggest] Tally error:', err);
    }
}

function scheduleTally(client, suggestion) {
    var idKey = String(suggestion._id);
    if (scheduledTallies.has(idKey)) {
        clearTimeout(scheduledTallies.get(idKey));
    }
    var delay = new Date(suggestion.tallyAt).getTime() - Date.now();
    if (delay <= 0) {
        tallySuggestion(client, suggestion._id);
        return;
    }
    // setTimeout max is ~24.8 days; 3 days is safe
    var handle = setTimeout(function() {
        tallySuggestion(client, suggestion._id);
    }, delay);
    scheduledTallies.set(idKey, handle);
}

async function initPendingTallies(client) {
    try {
        var pending = await Suggestion.find({ tallied: false });
        console.log('[Suggest] Rescheduling ' + pending.length + ' pending suggestion tallies');
        for (var i = 0; i < pending.length; i++) {
            scheduleTally(client, pending[i]);
        }
    } catch (err) {
        console.error('[Suggest] initPendingTallies error:', err);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Submit a suggestion for the community to vote on'),

    initPendingTallies: initPendingTallies,

    async execute(interaction) {
        if (interaction.guildId !== VOLARE_GUILD_ID) {
            return interaction.reply({
                content: '<:volare_reject:1408484388681027614> This command can only be used in the United Volare server.',
                ephemeral: true,
            });
        }

        var modal = new ModalBuilder()
            .setCustomId('suggest_modal')
            .setTitle('Submit a Suggestion');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('suggest_title')
                    .setLabel('Title')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100)
                    .setPlaceholder('Short, clear title of your idea')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('suggest_description')
                    .setLabel('Description')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(1500)
                    .setPlaceholder('Explain your suggestion in detail...')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('suggest_media')
                    .setLabel('Reference link (optional)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(500)
                    .setPlaceholder('e.g. https://youtube.com/... or image URL')
            ),
        );

        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction) {
        if (interaction.guildId !== VOLARE_GUILD_ID) {
            return interaction.reply({
                content: '<:volare_reject:1408484388681027614> This command can only be used in the United Volare server.',
                ephemeral: true,
            });
        }

        var title = interaction.fields.getTextInputValue('suggest_title').trim();
        var description = interaction.fields.getTextInputValue('suggest_description').trim();
        var mediaRaw = interaction.fields.getTextInputValue('suggest_media').trim();
        var mediaUrl = null;

        if (mediaRaw) {
            if (!isValidUrl(mediaRaw)) {
                return interaction.reply({
                    content: '<:volare_reject:1408484388681027614> Reference link must be a valid http(s) URL. Please try `/suggest` again.',
                    ephemeral: true,
                });
            }
            mediaUrl = mediaRaw;
        }

        await interaction.deferReply({ ephemeral: true });

        var guild = interaction.guild;
        var channel = guild.channels.cache.get(SUGGESTIONS_CHANNEL_ID) || await guild.channels.fetch(SUGGESTIONS_CHANNEL_ID).catch(function() { return null; });
        if (!channel) {
            return interaction.editReply({
                content: '<:volare_reject:1408484388681027614> Suggestions channel not found. Please contact an admin.',
            });
        }

        var now = new Date();
        var tallyAt = new Date(now.getTime() + TALLY_MS);

        // Build embed from a draft object so we can reuse the same builder after DB write
        var draft = {
            authorId: interaction.user.id,
            authorUsername: interaction.user.username,
            title: title,
            description: description,
            mediaUrl: mediaUrl,
            upvoters: [],
            downvoters: [],
            createdAt: now,
            tallyAt: tallyAt,
        };

        var embed = buildSuggestionEmbed(draft);
        var row = buildVoteRow(false);

        var sent;
        try {
            sent = await channel.send({ embeds: [embed], components: [row] });
        } catch (err) {
            console.error('[Suggest] Send error:', err);
            return interaction.editReply({
                content: '<:volare_reject:1408484388681027614> Failed to post suggestion. Please try again.',
            });
        }

        var suggestion;
        try {
            suggestion = await Suggestion.create({
                messageId: sent.id,
                channelId: sent.channelId,
                guildId: guild.id,
                authorId: interaction.user.id,
                authorUsername: interaction.user.username,
                title: title,
                description: description,
                mediaUrl: mediaUrl,
                createdAt: now,
                tallyAt: tallyAt,
            });
        } catch (err) {
            console.error('[Suggest] DB create error:', err);
            await sent.delete().catch(function() {});
            return interaction.editReply({
                content: '<:volare_reject:1408484388681027614> Failed to save your suggestion. Please try again.',
            });
        }

        // Ghost ping @everyone (send, then delete so the notification fires with no lingering message)
        try {
            var pingMsg = await channel.send({
                content: '@everyone',
                allowedMentions: { parse: ['everyone'] },
            });
            await pingMsg.delete().catch(function() {});
        } catch (err) {
            console.error('[Suggest] Ghost ping error (likely missing permissions):', err);
        }

        scheduleTally(interaction.client, suggestion);

        await interaction.editReply({
            content: '<:volare_check:1408484391348605069> Your suggestion has been posted in <#' + SUGGESTIONS_CHANNEL_ID + '>. Voting closes in 3 days.',
        });
    },

    async handleVote(interaction, direction) {
        // direction: 'up' | 'down'
        try {
            var suggestion = await Suggestion.findOne({ messageId: interaction.message.id });
            if (!suggestion) {
                return interaction.reply({
                    content: '<:volare_reject:1408484388681027614> This suggestion no longer exists.',
                    ephemeral: true,
                });
            }
            if (suggestion.tallied) {
                return interaction.reply({
                    content: '<:volare_reject:1408484388681027614> Voting on this suggestion has closed.',
                    ephemeral: true,
                });
            }

            var userId = interaction.user.id;

            if (userId === suggestion.authorId) {
                return interaction.reply({
                    content: '<:volare_reject:1408484388681027614> You cannot vote on your own suggestion.',
                    ephemeral: true,
                });
            }

            var already = (suggestion.upvoters.indexOf(userId) !== -1) || (suggestion.downvoters.indexOf(userId) !== -1);
            if (already) {
                return interaction.reply({
                    content: '<:volare_reject:1408484388681027614> You have already voted on this suggestion. Votes cannot be changed.',
                    ephemeral: true,
                });
            }

            if (direction === 'up') suggestion.upvoters.push(userId);
            else suggestion.downvoters.push(userId);

            await suggestion.save();

            var newEmbed = buildSuggestionEmbed(suggestion);
            await interaction.update({ embeds: [newEmbed], components: [buildVoteRow(false)] });
        } catch (err) {
            console.error('[Suggest] Vote error:', err);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '<:volare_reject:1408484388681027614> Something went wrong registering your vote.',
                        ephemeral: true,
                    });
                }
            } catch (e) {}
        }
    },
};
