const { SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');

var Player = null;
function getPlayer() {
    if (Player) return Player;
    try {
        Player = mongoose.model('Player');
    } catch (e) {
        var PlayerSchema = new mongoose.Schema({}, { strict: false, collection: 'players' });
        Player = mongoose.model('Player', PlayerSchema);
    }
    return Player;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord account to your Roblox account')
        .addStringOption(function(opt) {
            return opt.setName('roblox_username')
                .setDescription('Your Roblox username')
                .setRequired(true);
        }),

    async execute(interaction) {
        var username = interaction.options.getString('roblox_username').trim();
        var PM = getPlayer();
        var existingLink = await PM.findOne({ discordId: interaction.user.id });
        if (existingLink) {
            return interaction.reply({
                content: 'Your Discord is already linked to **' + existingLink.username + '**. Use `/unlink` first to change it.',
                flags: [4096],
            });
        }
        var player = await PM.findOne({ username: { $regex: new RegExp('^' + username + '$', 'i') } });
        if (!player) {
            return interaction.reply({
                content: 'Roblox account **' + username + '** not found in our system. You need to join a United Volare flight first to create your profile.',
                flags: [4096],
            });
        }
        if (player.discordId && player.discordId !== interaction.user.id) {
            return interaction.reply({
                content: 'That Roblox account is already linked to another Discord user.',
                flags: [4096],
            });
        }
        player.discordId = interaction.user.id;
        await player.save();
        return interaction.reply({
            content: 'Linked your Discord to **' + player.username + '**! Use `/status` to view your MileagePlus profile.',
            flags: [4096],
        });
    },
};
