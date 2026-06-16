var { EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

var APPLICATION_CATEGORY_ID = '1486496711861080074';
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
> <:e_curser:1397829435717193858> [United Aviate](https://discord.gg/muePg4Tqb4)
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

    // Build the DM payload
    var dmEmbeds;
    if (accepted) {
        // Two United-blue embeds: welcome letter + Aviate server invite
        var welcomeEmbed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setDescription(ACCEPT_WELCOME_TEXT);
        var inviteEmbed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setDescription(ACCEPT_INVITE_TEXT);
        dmEmbeds = [welcomeEmbed, inviteEmbed];
    } else {
        var rejectEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle('Application Update')
            .setDescription('Thank you for applying to United Volare. After careful review, your application was **not successful** this time. You are welcome to reapply in the future.');
        dmEmbeds = [rejectEmbed];
    }

    // DM the applicant (private status report back to the reviewer either way)
    var status;
    if (/^\d{15,21}$/.test(applicantId)) {
        try {
            var user = await interaction.client.users.fetch(applicantId);
            await user.send({ embeds: dmEmbeds });
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
