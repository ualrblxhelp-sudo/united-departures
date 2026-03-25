var { EmbedBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

var APPLICATION_CATEGORY_ID = '1486496711861080074';

function setupApplicationRoute(client, app) {
    app.post('/api/application', async function(req, res) {
        try {
            var data = req.body;

            // Verify API key
            if (data.apiKey !== process.env.APPLICATION_API_KEY) {
                return res.status(401).json({ error: 'Invalid API key' });
            }

            if (!data.discordUsername || !data.department) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            var ids = require('../config/ids');
            var guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
            if (!guild) return res.status(500).json({ error: 'Guild not found' });

            // Create channel name (sanitized)
            var channelName = 'app-' + data.discordUsername.toLowerCase().replace(/[^a-z0-9_-]/g, '-').substring(0, 80);

            // Check for duplicate
            var existing = guild.channels.cache.find(function(ch) {
                return ch.parentId === APPLICATION_CATEGORY_ID && ch.name === channelName;
            });
            if (existing) {
                return res.status(409).json({ error: 'Application channel already exists' });
            }

            // Create the channel
            var channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: APPLICATION_CATEGORY_ID,
                topic: data.department + ' Application \u2022 Discord: ' + data.discordUsername + ' \u2022 Roblox: ' + data.robloxUsername,
            });

            // Header embed
            var headerEmbed = new EmbedBuilder()
                .setTitle('\uD83D\uDCCB ' + data.department + ' Application')
                .setColor(0x0b0fa8)
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
                .setColor(0x2596be)
                .addFields(
                    { name: 'Relevant Experiences', value: data.experiences || 'N/A' },
                    { name: 'Department Selected', value: data.department || 'N/A' },
                    { name: 'Agreed to ToS', value: data.tosAgreed || 'N/A', inline: true },
                    { name: 'No AI Promise', value: data.aiPromise || 'N/A', inline: true }
                );
            await channel.send({ embeds: [universalEmbed] });

            // Department-specific Q&A embeds
            var answers = data.answers || {};
            var questions = Object.keys(answers);

            if (questions.length > 0) {
                var deptEmbed = new EmbedBuilder()
                    .setTitle(data.department + ' Questions')
                    .setColor(0x1414d2);

                for (var i = 0; i < questions.length; i++) {
                    var q = questions[i];
                    var a = answers[q] || 'No answer';
                    // Discord field value max is 1024 chars
                    if (a.length > 1024) a = a.substring(0, 1021) + '...';
                    deptEmbed.addFields({ name: q, value: a });
                }

                await channel.send({ embeds: [deptEmbed] });
            }

            res.json({ success: true, channelId: channel.id });

        } catch (err) {
            console.error('[Application] Error:', err);
            res.status(500).json({ error: 'Internal error' });
        }
    });
}

module.exports = { setupApplicationRoute };
