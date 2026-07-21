// commands/miles.js
// /miles — shows the caller their MileagePlus account: miles, status, PQP/PQF,
// PlusPoints, card, and what's needed for the next tier.
//
// Resolves the Discord user -> Roblox UserId via Bloxlink, then reads status
// straight from Supabase (same process, no self-HTTP). Registered publicly to
// the main server (see publicCommands in index.js) and to the staff server.
//
// Graceful states: if Bloxlink isn't configured yet, or the user isn't linked,
// or Supabase is down, the reply explains the situation instead of erroring.
// Roblox-only members (not in Discord) simply use the in-game surfaces instead.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
var sb = require('../services/supabase');
var bloxlink = require('../services/bloxlink');

var UNITED_BLUE = 0x0033A0;

var STATUS_LABEL = {
    general: 'General Member',
    silver: 'Premier Silver',
    gold: 'Premier Gold',
    platinum: 'Premier Platinum',
    '1k': 'Premier 1K',
    gs: 'Global Services',
};

var CARD_LABEL = {
    gateway: 'MileagePlus Gateway',
    explorer: 'United Explorer',
    quest: 'United Quest',
    united_club: 'United Club Infinite',
};

function fmt(n) {
    return Number(n || 0).toLocaleString('en-US');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mymiles')
        .setDescription('View your MileagePlus miles, status, and progress to the next tier'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        if (!sb.configured()) {
            return interaction.editReply('The MileagePlus system isn\'t available right now. Please try again later.');
        }

        var link;
        try {
            link = await bloxlink.discordToRoblox(interaction.user.id);
        } catch (err) {
            console.error('[Miles] bloxlink:', err);
            return interaction.editReply('Couldn\'t reach the account-linking service. Please try again in a moment.');
        }

        if (!link.configured) {
            return interaction.editReply('MileagePlus Discord linking isn\'t set up yet. In the meantime, you can view your miles in-game with the **+** icon on the topbar.');
        }
        if (!link.linked || !link.robloxId) {
            return interaction.editReply('Your Discord isn\'t linked to a Roblox account yet. Verify with **Bloxlink** (`/verify`), then run `/miles` again. You can always view your miles in-game with the **+** icon on the topbar.');
        }

        var status;
        try {
            status = await sb.rpc('get_member_status', { p_user_id: link.robloxId });
        } catch (err) {
            console.error('[Miles] status:', err);
            return interaction.editReply('Couldn\'t load your MileagePlus account right now. Please try again shortly.');
        }

        var statusLabel = STATUS_LABEL[status.status] || status.status;
        var cardLabel = (status.card && status.card.card)
            ? (CARD_LABEL[status.card.card] || status.card.card)
            : 'None';

        var embed = new EmbedBuilder()
            .setColor(UNITED_BLUE)
            .setTitle('MileagePlus \u2014 ' + statusLabel)
            .setDescription('Account **' + status.account_number + '**')
            .addFields(
                { name: 'Award Miles', value: fmt(status.miles), inline: true },
                { name: 'Lifetime Miles', value: fmt(status.lifetime_miles), inline: true },
                { name: 'PlusPoints', value: fmt(status.pluspoints), inline: true },
                { name: 'PQP', value: fmt(status.pqp), inline: true },
                { name: 'PQF', value: fmt(status.pqf), inline: true },
                { name: 'Card', value: cardLabel, inline: true }
            )
            .setFooter({ text: 'United MileagePlus \u2022 Volare' });

        if (status.next_tier) {
            var nt = status.next_tier;
            var nextLabel = STATUS_LABEL[nt.status] || nt.status;
            var opt1 = fmt(nt.pqp_needed_only) + ' PQP';
            var opt2 = fmt(nt.pqp_needed_withpqf) + ' PQP + ' + fmt(nt.pqf_needed) + ' PQF';
            embed.addFields({
                name: 'To reach ' + nextLabel,
                value: '\u2022 ' + opt1 + '\n\u2022 or ' + opt2,
            });
        } else {
            embed.addFields({ name: 'Progress', value: 'You\'ve reached the top published tier. \u2708\uFE0F' });
        }

        return interaction.editReply({ embeds: [embed] });
    },
};
