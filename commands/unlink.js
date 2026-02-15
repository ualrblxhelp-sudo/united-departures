const { SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');

function getPlayer() {
    try { return mongoose.model('Player'); }
    catch (e) { return mongoose.model('Player', new mongoose.Schema({}, { strict: false, collection: 'players' })); }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Unlink your Discord account from your Roblox account'),

    async execute(interaction) {
        var PM = getPlayer();
        var player = await PM.findOne({ discordId: interaction.user.id });
        if (!player) {
            return interaction.reply({
                content: 'Your Discord is not linked to any Roblox account.',
                flags: [4096],
            });
        }
        player.discordId = null;
        await player.save();
        return interaction.reply({
            content: 'Unlinked your Discord from **' + player.username + '**.',
            flags: [4096],
        });
    },
};
