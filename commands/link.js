const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} = require('discord.js');

var pendingLinks = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord account to your Roblox account')
        .addStringOption(function(opt) {
            return opt.setName('username').setDescription('Your Roblox username').setRequired(true);
        }),

    async execute(interaction) {
        var username = interaction.options.getString('username').trim();

        // Check if already linked
        var PM = null;
        try {
            PM = require('../models/PlayerMileagePlus');
        } catch (e) {}

        if (PM) {
            var existingLink = await PM.findOne({ discordId: interaction.user.id });
            if (existingLink) {
                return interaction.reply({
                    content: '\u274C Your Discord is already linked to **' + existingLink.username + '**. Use `/unlink` first to change it.',
                    ephemeral: true,
                });
            }
        }

        // Look up username on Roblox
        var robloxUser = null;
        try {
            var searchRes = await fetch('https://users.roblox.com/v1/usernames/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
            });
            var searchData = await searchRes.json();
            if (searchData.data && searchData.data.length > 0) {
                robloxUser = searchData.data[0];
            }
        } catch (err) {
            console.error('[Link] Roblox API error:', err);
            return interaction.reply({ content: '\u274C Failed to look up Roblox account. Try again later.', ephemeral: true });
        }

        if (!robloxUser) {
            return interaction.reply({ content: '\u274C Roblox account **' + username + '** not found.', ephemeral: true });
        }

        // Generate verification code
        var code = 'UNITED-' + Math.random().toString(36).substring(2, 8).toUpperCase();

        pendingLinks.set(interaction.user.id, {
            robloxId: robloxUser.id,
            robloxUsername: robloxUser.name,
            code: code,
        });

        var embed = new EmbedBuilder()
            .setTitle('Roblox Account Verification')
            .setColor(0x0b0fa8)
            .setDescription(
                '**Step 1:** Go to your [Roblox Profile](https://www.roblox.com/users/' + robloxUser.id + '/profile)\n' +
                '**Step 2:** Click **Edit Profile** and paste this code into your **About/Description:**\n\n' +
                '```' + code + '```\n\n' +
                '**Step 3:** Save your profile, then click **Verify** below.\n\n' +
                '*You can remove the code from your description after verification.*'
            )
            .setThumbnail('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' + robloxUser.id + '&size=150x150&format=Png')
            .setFooter({ text: 'Linking to: ' + robloxUser.name + ' (ID: ' + robloxUser.id + ')' });

        var row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('link_verify').setLabel('Verify').setStyle(ButtonStyle.Success).setEmoji({ id: '1408484391348605069', name: 'volare_check' }),
            new ButtonBuilder().setCustomId('link_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    },

    async handleVerify(interaction) {
        var pending = pendingLinks.get(interaction.user.id);
        if (!pending) return interaction.update({ content: '\u274C Session expired. Use `/link` again.', embeds: [], components: [] });

        await interaction.deferUpdate();

        // Fetch Roblox profile description
        var description = '';
        try {
            var res = await fetch('https://users.roblox.com/v1/users/' + pending.robloxId);
            var userData = await res.json();
            description = userData.description || '';
        } catch (err) {
            console.error('[Link] Roblox fetch error:', err);
            return interaction.editReply({ content: '\u274C Failed to check your Roblox profile. Try again.', embeds: [], components: [] });
        }

        // Check for code
        if (description.indexOf(pending.code) === -1) {
            return interaction.editReply({
                content: '\u274C Code not found in your Roblox profile description.\n\nMake sure you saved your profile with the code:\n```' + pending.code + '```\nThen try `/link` again.',
                embeds: [],
                components: [],
            });
        }

        // Verified — save the link
        var PM = null;
        try {
            PM = require('../models/PlayerMileagePlus');
        } catch (e) {}

        if (PM) {
            var player = await PM.findOne({ username: { $regex: new RegExp('^' + pending.robloxUsername + '$', 'i') } });
            if (player) {
                player.discordId = interaction.user.id;
                player.robloxId = pending.robloxId;
                await player.save();
            } else {
                // Create a basic record if none exists
                await PM.create({
                    username: pending.robloxUsername,
                    robloxId: pending.robloxId,
                    discordId: interaction.user.id,
                });
            }
        }

        pendingLinks.delete(interaction.user.id);

        var successEmbed = new EmbedBuilder()
            .setTitle('<:volare_check:1408484391348605069> Verification Complete')
            .setColor(0x00CC00)
            .setDescription('Your Discord account has been linked to **' + pending.robloxUsername + '** (ID: ' + pending.robloxId + ').\n\nYou can now remove the code from your Roblox description.')
            .setFooter({ text: 'Use /status to view your profile' });

        await interaction.editReply({ embeds: [successEmbed], components: [] });
    },

    async handleCancel(interaction) {
        pendingLinks.delete(interaction.user.id);
        await interaction.update({ content: '\u274C Link cancelled.', embeds: [], components: [] });
    },
};
