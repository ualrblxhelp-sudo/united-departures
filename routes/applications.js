var { EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

var APPLICATION_CATEGORY_ID = '1486496711861080074';
var EMBED_COLOR = 0x0b0fa8;

// Same accept/reject emojis used elsewhere in the bot
var CHECK_EMOJI = { id: '1408484391348605069', name: 'volare_check' };
var REJECT_EMOJI = { id: '1408484388681027614', name: 'volare_reject' };
var CHECK_MARKUP = '<:volare_check:1408484391348605069>';
var REJECT_MARKUP = '<:volare_reject:1408484388681027614>';

async function checkAI(text) {
    if (!text || text.length < 50) return null;
    try {
        var response = await fetch('https://api.sapling.ai/api/v1/aidetect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: process.env.SAPLING_API_KEY,
                text: text,
            }),
        });
        var data = await response.json();
        if (data && typeof data.score === 'number') {
            return Math.round(data.score * 100);
        }
        return null;
    } catch (err) {
        console.error('[AI Detect] Error:', err.message);
        return null;
    }
}

function aiLabel(score) {
    if (score === null) return '';
    if (score >= 70) return '\n\uD83E\uDD16 **AI Score: ' + score + '%** \u2014 Likely AI \u26A0\uFE0F';
    if (score >= 40) return '\n\uD83E\uDD16 **AI Score: ' + score + '%** \u2014 Mixed \uD83D\uDFE1';
    return '\n\uD83E\uDD16 **AI Score: ' + score + '%** \u2014 Likely Human \u2705';
}

// Builds the Accept / Reject button row. The applicant's Discord ID is baked into
// each customId so the decision handler can DM them without any lookup.
function buildReviewRow(applicantId, disabled) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('application_accept_' + applicantId)
            .setLabel('Accept')
            .setEmoji(CHECK_EMOJI)
            .setStyle(ButtonStyle.Success)
            .setDisabled(!!disabled),
        new ButtonBuilder()
            .setCustomId('application_reject_' + applicantId)
            .setLabel('Reject')
            .setEmoji(REJECT_EMOJI)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!!disabled),
    );
}

// Called from the index.js interaction dispatcher when an Accept/Reject button is pressed.
// Updates the review message, then DMs the applicant the outcome.
async function handleApplicationDecision(interaction) {
    var cid = interaction.customId;
    var accepted = cid.indexOf('application_accept_') === 0;
    var applicantId = cid.replace('application_accept_', '').replace('application_reject_', '');

    var emoji = accepted ? CHECK_MARKUP : REJECT_MARKUP;
    var word = accepted ? 'Accepted' : 'Rejected';
    var color = accepted ? 0x2ecc71 : 0xe74c3c;

    // Update the review embed + disable both buttons so it can't be double-actioned
    var baseEmbed = interaction.message.embeds[0]
        ? EmbedBuilder.from(interaction.message.embeds[0])
        : new EmbedBuilder().setTitle('Review Actions');
    baseEmbed
        .setColor(color)
        .setDescription(emoji + ' Application **' + word + '** by ' + interaction.user +
            '\n<t:' + Math.floor(Date.now() / 1000) + ':F>');

    try {
        await interaction.update({ embeds: [baseEmbed], components: [buildReviewRow(applicantId, true)] });
    } catch (err) {
        console.error('[Application] decision update error:', err);
    }

    // DM the applicant the outcome (private status report back to the reviewer either way)
    var status;
    if (/^\d{15,21}$/.test(applicantId)) {
        try {
            var user = await interaction.client.users.fetch(applicantId);
            var dmEmbed = new EmbedBuilder()
                .setColor(color)
                .setTitle(accepted ? 'Application Accepted' : 'Application Update')
                .setDescription(accepted
                    ? 'Congratulations! Your United Volare application has been **accepted**. A staff member will reach out shortly with the next steps.'
                    : 'Thank you for applying to United Volare. After careful review, your application was **not successful** this time. You are welcome to reapply in the future.');
            await user.send({ embeds: [dmEmbed] });
            status = CHECK_MARKUP + ' Applicant was notified via DM.';
        } catch (e) {
            status = REJECT_MARKUP + ' Could not DM the applicant (DMs closed or no shared server). Please message them manually.';
        }
    } else {
        status = REJECT_MARKUP + ' No valid Discord ID on file for this applicant, so no DM was sent.';
    }

    try {
        await interaction.followUp({ content: status, ephemeral: true });
    } catch (e) {}
}

function setupApplicationRoute(client, app) {
    app.post('/api/application', async function(req, res) {
        try {
            var data = req.body;

            if (data.apiKey !== process.env.APPLICATION_API_KEY) {
                return res.status(401).json({ error: 'Invalid API key' });
            }

            console.log('[Application] Received from: ' + data.discordUsername + ' (' + data.department + ')');

            if (!data.discordUsername || !data.department) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            var ids = require('../config/ids');
            var guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
            if (!guild) return res.status(500).json({ error: 'Guild not found' });

            var channelName = 'app-' + data.discordUsername.toLowerCase().replace(/[^a-z0-9_-]/g, '-').substring(0, 80);

            var existing = guild.channels.cache.find(function(ch) {
                return ch.parentId === APPLICATION_CATEGORY_ID && ch.name === channelName;
            });
            if (existing) {
                return res.status(409).json({ error: 'Application channel already exists' });
            }

            // Discord ID now comes straight from the form. Strip anything non-numeric
            // (handles pasted <@id>, spaces, etc.). Falls back to 'unknown' if absent.
            var applicantId = (data.discordId || '').toString().replace(/\D/g, '') || 'unknown';

            var channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: APPLICATION_CATEGORY_ID,
                topic: data.department + ' \u2022 Discord: ' + data.discordUsername + ' \u2022 ID: ' + applicantId + ' \u2022 Roblox: ' + data.robloxUsername,
            });

            // Header embed
            var headerEmbed = new EmbedBuilder()
                .setTitle(data.department + ' Application')
                .setColor(EMBED_COLOR)
                .setDescription(
                    '**Applicant:** ' + data.discordUsername + '\n' +
                    '**Discord ID:** ' + (applicantId === 'unknown' ? 'N/A' : applicantId) + '\n' +
                    '**Roblox:** ' + data.robloxUsername + '\n' +
                    '**Email:** ' + data.email + '\n' +
                    '**Submitted:** ' + data.timestamp
                )
                .setTimestamp();
            await channel.send({ embeds: [headerEmbed] });

            // Universal section embed
            var universalEmbed = new EmbedBuilder()
                .setTitle('Universal Section')
                .setColor(EMBED_COLOR)
                .addFields(
                    { name: 'Time Zone', value: data.timezone || 'N/A', inline: true },
                    { name: 'Age Group', value: data.ageGroup || 'N/A', inline: true },
                    { name: 'Device', value: data.device || 'N/A', inline: true },
                    { name: 'Department Selected', value: data.department || 'N/A' },
                    { name: 'Agreed to ToS', value: data.tosAgreed || 'N/A', inline: true },
                    { name: 'No AI Promise', value: data.aiPromise || 'N/A', inline: true }
                );
            await channel.send({ embeds: [universalEmbed] });

            // Department Q&A with AI detection
            var answers = data.answers || {};
            var questions = Object.keys(answers);

            if (questions.length > 0) {
                var deptEmbed = new EmbedBuilder()
                    .setTitle(data.department + ' Questions')
                    .setColor(EMBED_COLOR);

                var overallText = '';

                for (var i = 0; i < questions.length; i++) {
                    var q = questions[i];
                    var a = answers[q] || 'No answer';
                    if (a.length > 900) a = a.substring(0, 897) + '...';

                    overallText += a + ' ';

                    var score = await checkAI(a);
                    var label = aiLabel(score);

                    deptEmbed.addFields({ name: q, value: a + label });
                }

                // Overall AI score
                var overallScore = await checkAI(overallText.trim());
                if (overallScore !== null) {
                    var overallLabel = '';
                    if (overallScore >= 70) overallLabel = '\u26A0\uFE0F Likely AI (' + overallScore + '%)';
                    else if (overallScore >= 40) overallLabel = '\uD83D\uDFE1 Mixed (' + overallScore + '%)';
                    else overallLabel = '\u2705 Likely Human (' + overallScore + '%)';
                    deptEmbed.setFooter({ text: 'Overall AI Detection: ' + overallLabel });
                }

                await channel.send({ embeds: [deptEmbed] });
            }

            // Review actions embed with Accept / Reject buttons
            var summaryEmbed = new EmbedBuilder()
                .setTitle('Review Actions')
                .setColor(EMBED_COLOR)
                .setDescription('Use the buttons below to record your decision.' +
                    (applicantId === 'unknown'
                        ? '\n\n\u26A0\uFE0F No Discord ID was provided on this application, so the applicant cannot be auto-DM\'d.'
                        : ''));
            await channel.send({ embeds: [summaryEmbed], components: [buildReviewRow(applicantId, false)] });

            console.log('[Application] Channel created: ' + channelName);
            res.json({ success: true, channelId: channel.id });

        } catch (err) {
            console.error('[Application] Error:', err);
            res.status(500).json({ error: 'Internal error' });
        }
    });
}

module.exports = { setupApplicationRoute, handleApplicationDecision };
