var { EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');

var APPLICATION_CATEGORY_ID = '1486496711861080074';
var ARCHIVE_CHANNEL_ID = '1516838508915068949'; // log channel for accepted/rejected application archives
var EMBED_COLOR = 0x0b0fa8;

// Same accept/reject emojis used elsewhere in the bot
var CHECK_EMOJI = { id: '1408484391348605069', name: 'volare_check' };
var REJECT_EMOJI = { id: '1408484388681027614', name: 'volare_reject' };
var CHECK_MARKUP = '<:volare_check:1408484391348605069>';
var REJECT_MARKUP = '<:volare_reject:1408484388681027614>';

// ---- Acceptance DM content (United blue embeds) ----
var ACCEPT_WELCOME_TEXT = `<:e_mail:1397829550716616715> **Welcome to the World of United.**
> <:e_arrow:1406847964655259710>We are thrilled to inform you that, after a thorough evaluation of your application, you have been selected to join our prestigious Aviate program at United Airlines. This is a momentous achievement and an opportunity that is granted to only a select few, marking the beginning of a remarkable journey in your professional growth.
> 
> <a:UnitedWindowOpen:1508415229837709332>The Aviate program is designed to provide you with unparalleled development opportunities, tailored to cultivate your skills and expertise in the aviation industry. While we celebrate this noteworthy milestone, it is important to remember that your journey is just beginning. You are not yet a full-time employee; there are crucial steps ahead.
> 
> <a:UnitedBoardingPass:1029754764700958820> As a participant in the program, you will undergo a rigorous and intensive training process within your designated department. This training is essential to equip you with the knowledge and competencies necessary for success at United. We expect all participants to demonstrate excellence and commitment throughout this process, as graduation from the training is a prerequisite for moving forward into United's esteemed Volare communications pathway.
> 
> <:UnitedSpacer:1297075950974144544> We are genuinely excited about the potential we see in you and look forward to supporting you on this transformative journey. Your dedication and perseverance will be key as you embark on this exciting chapter with us.
> 
> **Once again, congratulations on your selection! We can't wait to see you thrive.**
-# Best Regards,
-#           Charles Leclerc, President of United Airlines.`;

var ACCEPT_INVITE_TEXT = `<:e_mail:1397829550716616715> **An Invite to Greatness.**
> <:e_arrow:1406847964655259710>You will now be invited to our esteemed **Aviate** server below. You must join the server, follow all the requirements listed, and begin your training process from there. 
> 
> <:e_curser:1397829435717193858> [United Aviate](https://discord.gg/fuUhfU2Dvb)
-# <:UnitedPolaris:1298320157424488479> ɢᴏᴏᴅ ʟᴇᴀᴅꜱ ᴛʜᴇ ᴡᴀʏ
-# <:d_staralliance:1397830727919337493> ᴀ ꜱᴛᴀʀ ᴀʟʟɪᴀɴᴄᴇ ᴍᴇᴍʙᴇʀ`;

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
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!!disabled),
        new ButtonBuilder()
            .setCustomId('application_reject_' + applicantId)
            .setLabel('Reject')
            .setEmoji(REJECT_EMOJI)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!!disabled),
    );
}

// Builds the "Review Actions" embed shown above the buttons. Shared by the route and the migration command.
function buildReviewEmbed(applicantId) {
    return new EmbedBuilder()
        .setTitle('Review Actions')
        .setColor(EMBED_COLOR)
        .setDescription('Use the buttons below to record your decision.' +
            (applicantId === 'unknown'
                ? '\n\n\u26A0\uFE0F No Discord ID on file for this application, so the applicant cannot be auto-DM\'d on accept.'
                : ''));
}

// Serializes every message in an application channel into a readable plain-text transcript.
async function buildTranscript(channel, decisionLine) {
    var lines = [];
    lines.push('==== UNITED VOLARE APPLICATION ARCHIVE ====');
    lines.push('Channel: #' + channel.name + ' (' + channel.id + ')');
    if (channel.topic) lines.push('Topic: ' + channel.topic);
    if (decisionLine) lines.push('Decision: ' + decisionLine);
    lines.push('Archived: ' + new Date().toISOString());
    lines.push('===========================================');
    lines.push('');

    var fetched = await channel.messages.fetch({ limit: 100 });
    var msgs = Array.from(fetched.values()).reverse(); // oldest -> newest

    for (var i = 0; i < msgs.length; i++) {
        var m = msgs[i];
        var stamp = new Date(m.createdTimestamp).toISOString();
        var author = m.author ? (m.author.tag || m.author.username) : 'Unknown';
        lines.push('[' + stamp + '] ' + author + ':');

        if (m.content) lines.push(m.content);

        for (var j = 0; j < m.embeds.length; j++) {
            var emb = m.embeds[j];
            if (emb.title) lines.push('  # ' + emb.title);
            if (emb.description) lines.push('  ' + emb.description.split('\n').join('\n  '));
            if (emb.fields && emb.fields.length) {
                for (var k = 0; k < emb.fields.length; k++) {
                    lines.push('  - ' + emb.fields[k].name + ': ' + emb.fields[k].value.split('\n').join(' '));
                }
            }
            if (emb.footer && emb.footer.text) lines.push('  (' + emb.footer.text + ')');
        }
        lines.push('');
    }

    return lines.join('\n');
}

// Archives an application channel to a .txt in the log channel, recording the decision and
// WHO clicked the button (plus an optional extra note). Throws on failure so callers decide next steps.
async function archiveApplication(interaction, decision, extraNote) {
    var channel = interaction.channel;
    var who = interaction.user;
    var decisionLine = decision + ' by ' + (who.tag || who.username) + ' (' + who.id + ') at ' + new Date().toISOString();

    var transcript = await buildTranscript(channel, decisionLine);
    var fileName = 'application-' + channel.name + '-' + decision.toLowerCase() + '-' + Date.now() + '.txt';
    var attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: fileName });

    var mark = (decision === 'ACCEPTED') ? CHECK_MARKUP : REJECT_MARKUP;
    var content = mark + ' Application **' + decision + '** \u2014 `' + channel.name + '` \u2014 clicked by ' + who;
    if (extraNote) content += '\n' + extraNote;

    var archiveChannel = await interaction.client.channels.fetch(ARCHIVE_CHANNEL_ID);
    await archiveChannel.send({ content: content, files: [attachment] });
}

// Reject flow: log the application (recording who clicked), then delete the channel.
// Deletion only happens if the log upload succeeds, so an application is never lost.
async function handleReject(interaction) {
    try { await interaction.deferUpdate(); } catch (e) {}

    var channel = interaction.channel;

    try {
        await archiveApplication(interaction, 'REJECTED');
    } catch (err) {
        console.error('[Application] archive error:', err);
        try {
            await interaction.followUp({
                content: REJECT_MARKUP + ' Failed to log this application, so the channel was **not** deleted. Check the bot logs / log-channel permissions.',
                ephemeral: true,
            });
        } catch (e) {}
        return; // do not delete if logging failed
    }

    try {
        await channel.delete('Application rejected by ' + interaction.user.tag);
    } catch (err) {
        console.error('[Application] channel delete error:', err);
        try {
            await interaction.followUp({
                content: REJECT_MARKUP + ' Logged successfully, but I couldn\'t delete the channel (missing Manage Channels?). Please remove it manually.',
                ephemeral: true,
            });
        } catch (e) {}
    }
}

// Accept flow: DM the applicant, log the application (recording who clicked + DM status),
// then delete the channel. Deletion only happens if the log upload succeeds.
async function handleAccept(interaction, applicantId) {
    try { await interaction.deferUpdate(); } catch (e) {}

    var channel = interaction.channel;

    // DM the applicant the two United-blue embeds (welcome letter + Aviate invite)
    var welcomeEmbed = new EmbedBuilder().setColor(EMBED_COLOR).setDescription(ACCEPT_WELCOME_TEXT);
    var inviteEmbed = new EmbedBuilder().setColor(EMBED_COLOR).setDescription(ACCEPT_INVITE_TEXT);

    var dmStatus;
    if (/^\d{15,21}$/.test(applicantId)) {
        try {
            var user = await interaction.client.users.fetch(applicantId);
            await user.send({ embeds: [welcomeEmbed, inviteEmbed] });
            dmStatus = CHECK_MARKUP + ' Applicant was notified via DM.';
        } catch (e) {
            dmStatus = REJECT_MARKUP + ' Could not DM the applicant (DMs closed or no shared server) \u2014 message them manually.';
        }
    } else {
        dmStatus = REJECT_MARKUP + ' No valid Discord ID on file \u2014 no DM was sent.';
    }

    // Log to the log channel (records who clicked + DM status), then delete the channel
    try {
        await archiveApplication(interaction, 'ACCEPTED', dmStatus);
    } catch (err) {
        console.error('[Application] archive error:', err);
        try {
            await interaction.followUp({
                content: REJECT_MARKUP + ' Accepted and DMed, but failed to log the application, so the channel was **not** deleted. Check the bot logs / log-channel permissions.',
                ephemeral: true,
            });
        } catch (e) {}
        return; // do not delete if logging failed
    }

    try {
        await channel.delete('Application accepted by ' + interaction.user.tag);
    } catch (err) {
        console.error('[Application] channel delete error:', err);
        try {
            await interaction.followUp({
                content: REJECT_MARKUP + ' Logged successfully, but I couldn\'t delete the channel (missing Manage Channels?). Please remove it manually.',
                ephemeral: true,
            });
        } catch (e) {}
    }
}

// Called from the index.js interaction dispatcher when an Accept/Reject button is pressed.
async function handleApplicationDecision(interaction) {
    var cid = interaction.customId;
    var accepted = cid.indexOf('application_accept_') === 0;
    var applicantId = cid.replace('application_accept_', '').replace('application_reject_', '');

    if (accepted) {
        return await handleAccept(interaction, applicantId);
    }
    return await handleReject(interaction);
}

// Tracks application channels currently being created, so a double-fired webhook
// (e.g. a duplicate Apps Script trigger) can't race past the existence check and
// create two channels for the same applicant.
var creating = new Set();

function setupApplicationRoute(client, app) {
    app.post('/api/application', async function(req, res) {
        var lockedName = null;
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
            if (existing || creating.has(channelName)) {
                return res.status(409).json({ error: 'Application channel already exists or is being created' });
            }
            creating.add(channelName);
            lockedName = channelName;

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
            await channel.send({ embeds: [buildReviewEmbed(applicantId)], components: [buildReviewRow(applicantId, false)] });

            console.log('[Application] Channel created: ' + channelName);
            res.json({ success: true, channelId: channel.id });

        } catch (err) {
            console.error('[Application] Error:', err);
            res.status(500).json({ error: 'Internal error' });
        } finally {
            if (lockedName) creating.delete(lockedName);
        }
    });
}

module.exports = { setupApplicationRoute, handleApplicationDecision, buildReviewRow, buildReviewEmbed, APPLICATION_CATEGORY_ID };
