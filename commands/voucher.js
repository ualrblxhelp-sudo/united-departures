// commands/voucher.js — issue a one-time free-booking voucher (Volare admins).
//
// The voucher lets a passenger book any cabin with no Robux and no miles, and
// grants automatic lounge access on that flight. They still EARN miles, PQP and
// PQF normally: the voucher removes the cost, not the reward.
//
// Consumed when the flight is PAID OUT, not when booked, so a passenger who
// books and never flies keeps it.
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
var sb = require('../services/supabase');
var roblox = require('../services/roblox');
var bloxlink = require('../services/bloxlink');

// Volare staff server. The command is registered globally (Discord has no
// reliable per-guild gate that survives re-registration), so execute() checks
// the guild explicitly rather than trusting where it appeared.
var VOLARE_GUILD = process.env.VOLARE_SERVER_ID || '1309560657473179679';

// One message per voucher issued.
var LOG_CHANNEL = process.env.VOUCHER_LOG_CHANNEL_ID || '1534345169359605901';

// United/Volare blue.
var VOLARE_COLOR = 0x0033A0;

// Every cabin sold in game. Values are the canonical keys the vouchers table
// and bookings.cabin both use -- the labels are only what staff see.
var CABINS = [
    { name: 'Basic Economy', value: 'basic_economy' },
    { name: 'Economy', value: 'economy' },
    { name: 'Economy Plus', value: 'economy_plus' },
    { name: 'Premium Plus', value: 'premium_plus' },
    { name: 'United First', value: 'first' },
    { name: 'Polaris', value: 'polaris' },
];

function cabinLabel(value) {
    for (var i = 0; i < CABINS.length; i++) {
        if (CABINS[i].value === value) return CABINS[i].name;
    }
    return value;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voucher')
        .setDescription('Issue a one-time free-booking voucher to a passenger')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addStringOption(function (o) {
            return o.setName('class')
                .setDescription('Cabin the voucher is valid for')
                .setRequired(true)
                .addChoices.apply(o, CABINS);
        })
        // Neither is required on its own, but one must be given. Passengers are
        // not in the Volare server and many have never linked with Bloxlink, so
        // a Discord mention alone cannot always be resolved -- the Roblox
        // username is the reliable route and the mention is the convenience.
        .addUserOption(function (o) {
            return o.setName('user')
                .setDescription('Discord user (must be Bloxlink-verified)')
                .setRequired(false);
        })
        .addStringOption(function (o) {
            return o.setName('roblox')
                .setDescription('Roblox username (use this if they are not verified)')
                .setRequired(false);
        })
        .addStringOption(function (o) {
            return o.setName('note')
                .setDescription('Why this voucher was issued')
                .setRequired(false);
        }),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        if (interaction.guildId !== VOLARE_GUILD) {
            return interaction.editReply('This command can only be used in the Volare server.');
        }

        // Administrator permission, checked server-side. setDefaultMemberPermissions
        // above only hides the command; it is not a security boundary.
        if (!interaction.memberPermissions ||
            !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply('You need Administrator to issue vouchers.');
        }

        if (!sb.configured()) {
            return interaction.editReply('The MileagePlus system isn\'t available right now.');
        }

        var cabin = interaction.options.getString('class');
        var discordUser = interaction.options.getUser('user');
        var robloxName = interaction.options.getString('roblox');
        var note = interaction.options.getString('note');

        if (!discordUser && !robloxName) {
            return interaction.editReply('Give either a Discord user or a Roblox username.');
        }

        // ---- resolve the passenger ----
        var userId = null;
        var username = null;
        var resolvedVia = null;

        if (robloxName) {
            var who = await roblox.usernameToUserId(robloxName);
            if (!who) {
                return interaction.editReply('Couldn\'t find the Roblox user **' + robloxName + '**.');
            }
            userId = who.userId;
            username = who.username;
            resolvedVia = 'Roblox username';
        } else {
            if (!bloxlink.configured()) {
                return interaction.editReply(
                    'Bloxlink isn\'t configured, so a Discord user can\'t be resolved. '
                    + 'Use the `roblox` option with their username instead.');
            }
            var linked;
            try {
                linked = await bloxlink.discordToRoblox(discordUser.id);
            } catch (err) {
                // Bloxlink throws on any non-404 error status.
                console.error('[voucher] bloxlink:', err.message);
                return interaction.editReply(
                    'Bloxlink didn\'t answer. Use the `roblox` option with their username instead.');
            }

            if (!linked || !linked.linked || !linked.robloxId) {
                return interaction.editReply(
                    '**' + discordUser.tag + '** isn\'t verified with Bloxlink, so I can\'t tell '
                    + 'which Roblox account they are. Use the `roblox` option with their username.');
            }

            userId = Number(linked.robloxId);

            // Bloxlink returns the id only, so the display name is a second
            // lookup. Not fatal if it fails -- the id is what actually matters.
            var named = await roblox.userIdToUsername(userId);
            username = (named && named.username) || String(userId);
            resolvedVia = 'Bloxlink';
        }

        // ---- issue ----
        var result;
        try {
            result = await sb.rpc('grant_voucher', {
                p_user_id: userId,
                p_cabin: cabin,
                p_issued_by: interaction.user.tag,
                p_note: note || null,
            });
        } catch (err) {
            console.error('[voucher]', err);
            return interaction.editReply('Couldn\'t issue the voucher right now. Please try again.');
        }

        var replaced = result && result.replaced;

        // ---- log ----
        // One message per voucher. Failing to log must NOT fail the command --
        // the voucher is already issued, and telling staff it failed would have
        // them issue a second one.
        try {
            var channel = await interaction.client.channels.fetch(LOG_CHANNEL);
            if (channel && channel.isTextBased()) {
                var embed = new EmbedBuilder()
                    .setColor(VOLARE_COLOR)
                    .setTitle('Voucher issued')
                    .addFields(
                        { name: 'Passenger', value: username + ' (' + userId + ')', inline: true },
                        { name: 'Cabin', value: cabinLabel(cabin), inline: true },
                        { name: 'Issued by', value: '<@' + interaction.user.id + '>', inline: true },
                        { name: 'Resolved via', value: resolvedVia, inline: true }
                    )
                    .setTimestamp();

                if (discordUser) {
                    embed.addFields({ name: 'Discord', value: '<@' + discordUser.id + '>', inline: true });
                }
                if (note) {
                    embed.addFields({ name: 'Note', value: note });
                }
                if (replaced) {
                    embed.addFields({
                        name: 'Replaced',
                        value: 'Previous unused ' + cabinLabel(result.replaced_cabin) + ' voucher',
                    });
                }

                await channel.send({ embeds: [embed] });
            }
        } catch (err) {
            console.error('[voucher] log failed:', err.message);
        }

        var reply = 'Issued a **' + cabinLabel(cabin) + '** voucher to **' + username + '**. '
            + 'It applies to their next completed flight: free booking, automatic lounge access, '
            + 'and they still earn miles, PQP and PQF.';

        if (replaced) {
            reply += '\n\nThis replaced their unused **' + cabinLabel(result.replaced_cabin)
                + '** voucher — a passenger can only hold one at a time.';
        }

        return interaction.editReply(reply);
    },
};
