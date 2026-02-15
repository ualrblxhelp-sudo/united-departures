const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');

function getPlayer() {
    try { return mongoose.model('Player'); }
    catch (e) { return mongoose.model('Player', new mongoose.Schema({}, { strict: false, collection: 'players' })); }
}

var TIERS = [
    { name: 'Traveler', pqf: 0, pqp: 0, pqpOnly: 0, color: 0x808080, emoji: '' },
    { name: 'Premier Silver', pqf: 15, pqp: 5000, pqpOnly: 6000, color: 0xC0C0C0, emoji: '\uD83E\uDD48' },
    { name: 'Premier Gold', pqf: 30, pqp: 10000, pqpOnly: 12000, color: 0xDAA520, emoji: '\uD83E\uDD47' },
    { name: 'Premier Platinum', pqf: 45, pqp: 15000, pqpOnly: 18000, color: 0xB4B4C3, emoji: '\uD83D\uDC8E' },
    { name: 'Premier 1K', pqf: 60, pqp: 22000, pqpOnly: 28000, color: 0xD2A032, emoji: '\uD83D\uDC51' },
];

var CARD_INFO = {
    GatewayCard: { name: 'United Gateway Card', price: '199R$', multiplier: '1x', emoji: '\uD83D\uDCB3' },
    ExplorerCard: { name: 'United Explorer Card', price: '399R$', multiplier: '1.5x', emoji: '\uD83D\uDCB3' },
    QuestCard: { name: 'United Quest Card', price: '699R$', multiplier: '2x', emoji: '\uD83D\uDCB3' },
    ClubCard: { name: 'United Club Card', price: '899R$', multiplier: '2.5x', emoji: '\uD83D\uDCB3' },
};

function formatNumber(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function getNextTier(currentStatus) {
    for (var i = 0; i < TIERS.length; i++) {
        if (TIERS[i].name === currentStatus && i < TIERS.length - 1) return TIERS[i + 1];
    }
    return null;
}

function getCurrentTier(currentStatus) {
    for (var i = 0; i < TIERS.length; i++) {
        if (TIERS[i].name === currentStatus) return TIERS[i];
    }
    return TIERS[0];
}

function buildProgressBar(current, target, length) {
    if (target <= 0) return '\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 100%';
    var ratio = Math.min(current / target, 1);
    var filled = Math.round(ratio * length);
    var empty = length - filled;
    var bar = '\u2593'.repeat(filled) + '\u2591'.repeat(empty);
    return bar + ' ' + Math.round(ratio * 100) + '%';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('View your MileagePlus profile and status'),

    async execute(interaction) {
        var PM = getPlayer();
        var player = await PM.findOne({ discordId: interaction.user.id });
        if (!player) {
            return interaction.reply({
                content: 'Your Discord is not linked to a Roblox account. Use `/link` first.',
                flags: [4096],
            });
        }

        var status = player.status || 'Traveler';
        var miles = player.miles || 0;
        var lifetimeMiles = player.lifetimeMiles || 0;
        var pqf = player.pqf || 0;
        var pqp = player.pqp || 0;
        var cards = player.cards || [];
        var flightHistory = player.flightHistory || [];
        var currentTier = getCurrentTier(status);
        var nextTier = getNextTier(status);

        var embed = new EmbedBuilder()
            .setTitle(currentTier.emoji + ' MileagePlus Profile')
            .setColor(currentTier.color)
            .setThumbnail(interaction.user.displayAvatarURL({ size: 128 }));

        var desc = '**' + (player.username || 'Unknown') + '**\n';
        desc += 'Status: **' + status + '**\n\n';
        desc += '**\u2501\u2501\u2501 Miles \u2501\u2501\u2501**\n';
        desc += '\u2708\uFE0F Available Miles: **' + formatNumber(miles) + '**\n';
        desc += '\uD83C\uDF0D Lifetime Miles: **' + formatNumber(lifetimeMiles) + '**\n';
        desc += '\uD83D\uDCCA Total Flights: **' + flightHistory.length + '**\n\n';
        desc += '**\u2501\u2501\u2501 Qualifying Progress \u2501\u2501\u2501**\n';
        desc += 'PQF (Qualifying Flights): **' + pqf + '**\n';
        desc += 'PQP (Qualifying Points): **' + formatNumber(pqp) + '**\n\n';

        if (status === 'Global Services') {
            desc += '**\u2501\u2501\u2501 Status \u2501\u2501\u2501**\n';
            desc += '\uD83C\uDF1F You have reached the highest tier.\n\n';
        } else if (status === 'Affiliate') {
            desc += '**\u2501\u2501\u2501 Status \u2501\u2501\u2501**\n';
            desc += '\u2728 Affiliate member.\n\n';
        } else if (nextTier) {
            desc += '**\u2501\u2501\u2501 Progress to ' + nextTier.name + ' \u2501\u2501\u2501**\n';
            desc += 'PQF: ' + pqf + '/' + nextTier.pqf + '\n';
            desc += buildProgressBar(pqf, nextTier.pqf, 10) + '\n';
            desc += 'PQP: ' + formatNumber(pqp) + '/' + formatNumber(nextTier.pqp) + '\n';
            desc += buildProgressBar(pqp, nextTier.pqp, 10) + '\n';
            desc += '*Or PQP-only: ' + formatNumber(pqp) + '/' + formatNumber(nextTier.pqpOnly) + '*\n\n';
        }

        desc += '**\u2501\u2501\u2501 Cards & Benefits \u2501\u2501\u2501**\n';
        if (cards.length === 0) {
            desc += '*No cards \u2014 purchase in-game for miles multipliers.*\n';
        } else {
            for (var i = 0; i < cards.length; i++) {
                var info = CARD_INFO[cards[i]];
                if (info) desc += info.emoji + ' **' + info.name + '** \u2014 ' + info.multiplier + ' miles\n';
            }
        }

        desc += '\n**\u2501\u2501\u2501 Your Benefits \u2501\u2501\u2501**\n';
        if (status === 'Traveler') desc += '\u2022 Basic MileagePlus earning\n';
        if (status === 'Premier Silver' || status === 'Premier Gold' || status === 'Premier Platinum' || status === 'Premier 1K' || status === 'Global Services') {
            desc += '\u2022 Free checked bags\n\u2022 Priority boarding\n';
        }
        if (status === 'Premier Gold' || status === 'Premier Platinum' || status === 'Premier 1K' || status === 'Global Services') {
            desc += '\u2022 United Club access\n\u2022 Complimentary upgrades priority\n';
        }
        if (status === 'Premier Platinum' || status === 'Premier 1K' || status === 'Global Services') {
            desc += '\u2022 Higher upgrade priority\n';
        }
        if (status === 'Premier 1K' || status === 'Global Services') {
            desc += '\u2022 Polaris Lounge access\n\u2022 Preboarding\n';
        }
        if (status === 'Global Services') {
            desc += '\u2022 Dedicated Global Services agent\n\u2022 Top-tier upgrade priority\n';
        }

        embed.setDescription(desc);
        embed.setFooter({ text: 'United MileagePlus \u2022 Linked to ' + (player.username || 'Unknown') });
        embed.setTimestamp();
        return interaction.reply({ embeds: [embed], flags: [4096] });
    },
};
