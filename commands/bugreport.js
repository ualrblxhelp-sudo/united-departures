const {
    SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder,
} = require('discord.js');

var pendingReports = new Map();

var BUG_CHANNEL_ID = '1485667834217369620';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bugreport')
        .setDescription('Submit a bug report or complaint about a flight'),
    pendingReports: pendingReports,

    async execute(interaction) {
        var select = new StringSelectMenuBuilder()
            .setCustomId('bugreport_type')
            .setPlaceholder('How would you like to submit?')
            .addOptions([
                { label: 'Public Report', value: 'public', description: 'Your username will be shown' },
                { label: 'Anonymous Report', value: 'anonymous', description: 'Your identity will be hidden' },
            ]);

        await interaction.reply({
            content: 'Would you like to submit your report publicly or anonymously?',
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral: true,
        });
    },

    async handleTypeSelect(interaction) {
        var reportType = interaction.values[0];
        pendingReports.set(interaction.user.id, { type: reportType });

        var modal = new ModalBuilder()
            .setCustomId('bugreport_modal')
            .setTitle('Bug Report');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('topic').setLabel('Topic / Subject').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder('e.g. Gate screen not updating')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setPlaceholder('Describe the bug or complaint in detail...')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('flight_number').setLabel('Flight Number (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10).setPlaceholder('e.g. UAL1629')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('image_urls').setLabel('Image URLs (optional, one per line)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setPlaceholder('Paste image links here, one per line')
            ),
        );
        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction) {
        var pending = pendingReports.get(interaction.user.id);
        if (!pending) return interaction.reply({ content: '\u274C Session expired. Use `/bugreport` again.', ephemeral: true });

        var topic = interaction.fields.getTextInputValue('topic').trim();
        var description = interaction.fields.getTextInputValue('description').trim();
        var flightNumber = interaction.fields.getTextInputValue('flight_number').trim();
        var imageUrls = interaction.fields.getTextInputValue('image_urls').trim();

        var isAnonymous = pending.type === 'anonymous';

        var embed = new EmbedBuilder()
            .setTitle('\uD83D\uDCCB Bug Report: ' + topic)
            .setColor(0xFF4444)
            .setTimestamp();

        var desc = '**Description:**\n' + description;
        if (flightNumber) desc += '\n\n**Flight Number:** ' + flightNumber;
        if (isAnonymous) {
            desc += '\n\n**Submitted by:** Anonymous';
            embed.setFooter({ text: 'Anonymous Report' });
        } else {
            desc += '\n\n**Submitted by:** <@' + interaction.user.id + '> (' + interaction.user.username + ')';
            embed.setFooter({ text: 'Report by ' + interaction.user.username });
        }
        embed.setDescription(desc);

        // Parse image URLs
        var images = [];
        if (imageUrls) {
            var lines = imageUrls.split('\n');
            for (var i = 0; i < lines.length; i++) {
                var url = lines[i].trim();
                if (url.startsWith('http')) {
                    images.push(url);
                }
            }
        }

        if (images.length > 0) {
            embed.setImage(images[0]);
        }

        // Send to bug report channel
        try {
            var guild = interaction.client.guilds.cache.find(function(g) {
                return g.channels.cache.has(BUG_CHANNEL_ID);
            });
            var channel = null;
            if (guild) {
                channel = guild.channels.cache.get(BUG_CHANNEL_ID);
            }
            if (!channel) {
                // Try fetching across all guilds
                interaction.client.guilds.cache.forEach(function(g) {
                    if (!channel) {
                        var ch = g.channels.cache.get(BUG_CHANNEL_ID);
                        if (ch) channel = ch;
                    }
                });
            }

            if (channel) {
                var msgPayload = { embeds: [embed] };

                // If multiple images, send additional ones as separate embeds
                if (images.length > 1) {
                    var extraEmbeds = [];
                    for (var j = 1; j < images.length && j < 4; j++) {
                        extraEmbeds.push(new EmbedBuilder().setImage(images[j]).setColor(0xFF4444));
                    }
                    msgPayload.embeds = msgPayload.embeds.concat(extraEmbeds);
                }

                await channel.send(msgPayload);
            } else {
                console.error('[BugReport] Channel not found: ' + BUG_CHANNEL_ID);
                return interaction.reply({ content: '\u274C Could not find the report channel. Please contact an admin.', ephemeral: true });
            }
        } catch (err) {
            console.error('[BugReport] Send error:', err);
            return interaction.reply({ content: '\u274C Failed to submit report. Please try again.', ephemeral: true });
        }

        pendingReports.delete(interaction.user.id);
        await interaction.reply({
            content: '<:volare_check:1408484391348605069> Your ' + (isAnonymous ? 'anonymous ' : '') + 'bug report has been submitted. Thank you!',
            ephemeral: true,
        });
    },
};
