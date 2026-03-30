var { EmbedBuilder, ChannelType } = require('discord.js');

var APPLICATION_CATEGORY_ID = '1486496711861080074';
var EMBED_COLOR = 0x0b0fa8;

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

            var channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: APPLICATION_CATEGORY_ID,
                topic: data.department + ' \u2022 Discord: ' + data.discordUsername + ' \u2022 Roblox: ' + data.robloxUsername,
            });

            // Header embed
            var headerEmbed = new EmbedBuilder()
                .setTitle('\uD83D\uDCCB ' + data.department + ' Application')
                .setColor(EMBED_COLOR)
                .setDescription(
                    '**Applicant:** ' + data.discordUsername + '\n' +
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

            // Review actions embed
            var summaryEmbed = new EmbedBuilder()
                .setTitle('\u2699\uFE0F Review Actions')
                .setColor(EMBED_COLOR)
                .setDescription('React to this message to indicate your decision:\n\n<:volare_check:1408484391348605069> Accept\n<:volare_reject:1408484388681027614> Deny');
            var summaryMsg = await channel.send({ embeds: [summaryEmbed] });
            try {
                await summaryMsg.react('<:volare_check:1408484391348605069>');
                await summaryMsg.react('<:volare_reject:1408484388681027614>');
            } catch (reactErr) {
                console.error('[Application] React error:', reactErr);
            }

            console.log('[Application] Channel created: ' + channelName);
            res.json({ success: true, channelId: channel.id });

        } catch (err) {
            console.error('[Application] Error:', err);
            res.status(500).json({ error: 'Internal error' });
        }
    });
}

module.exports = { setupApplicationRoute };
