const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const SuspensionReturn = require('../models/SuspensionReturn');

var EMBED_COLOR = 0x4D1B55;
var CHECK_INTERVAL_MS = 15 * 60 * 1000;
var schedulerStarted = false;

function mentionlessUsername(user) {
    return '@' + String(user && user.username ? user.username : 'employee');
}

function returnEmbed(user, inviteUrl) {
    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription(
            '-# _ _\n' +
            '> ### <:volare_hammer:1408481914112835755> **Suspension Complete.**\n' +
            '-# **Your Suspension has Ended** — Human Resources\n\n' +
            '> <:volare_arrow:1408485394747490385>Hello, **' + mentionlessUsername(user) + '**. Your 7 day suspension period has ended. You may rejoin United Volare using the invite below.\n\n' +
            '> ' + inviteUrl + '\n\n' +
            '<:volare_fa:1408298318861176920> **Jake Marlon**\n' +
            '> -# Executive Vice President, Human Resources'
        )
        .setTimestamp();
}

async function queueReturnInvite(guildId, userId, username, returnAt) {
    return SuspensionReturn.create({
        guildId: String(guildId),
        userId: String(userId),
        username: username || '',
        returnAt: returnAt,
        status: 'pending',
    });
}

async function findInviteChannel(guild) {
    if (!guild) return null;
    if (guild.systemChannel && guild.systemChannel.permissionsFor(guild.members.me).has(PermissionFlagsBits.CreateInstantInvite)) {
        return guild.systemChannel;
    }

    var channels = guild.channels.cache
        .filter(function (channel) {
            if (!channel || channel.type !== ChannelType.GuildText) return false;
            var perms = channel.permissionsFor(guild.members.me);
            return perms && perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.CreateInstantInvite);
        })
        .sort(function (a, b) { return a.position - b.position; });

    return channels.first() || null;
}

async function createInviteForReturn(guild, userId) {
    var channel = await findInviteChannel(guild);
    if (!channel) throw new Error('no_invite_channel');
    var invite = await channel.createInvite({
        maxAge: 8 * 24 * 60 * 60,
        maxUses: 1,
        unique: true,
        reason: 'Suspension return for ' + userId,
    });
    return invite.url;
}

async function processPendingReturn(client, record) {
    var guild = client.guilds.cache.get(record.guildId) || await client.guilds.fetch(record.guildId).catch(function () { return null; });
    var user = await client.users.fetch(record.userId).catch(function () { return null; });
    if (!guild || !user) {
        record.status = 'failed';
        record.error = !guild ? 'guild_not_found' : 'user_not_found';
        record.completedAt = new Date();
        await record.save();
        return;
    }

    try {
        var inviteUrl = await createInviteForReturn(guild, record.userId);
        await user.send({ embeds: [returnEmbed(user, inviteUrl)] });
        record.status = 'completed';
        record.inviteUrl = inviteUrl;
        record.completedAt = new Date();
        record.error = '';
        await record.save();
    } catch (err) {
        record.status = 'failed';
        record.error = err && err.message ? err.message : 'invite_or_dm_failed';
        record.completedAt = new Date();
        await record.save();
    }
}

async function processDueReturns(client) {
    try {
        var pending = await SuspensionReturn.find({
            status: 'pending',
            returnAt: { $lte: new Date() },
        }).limit(25);

        for (var i = 0; i < pending.length; i++) {
            await processPendingReturn(client, pending[i]);
        }
    } catch (err) {
        console.error('[SuspensionReturns] processDueReturns error:', err);
    }
}

function startScheduler(client) {
    if (schedulerStarted) return;
    schedulerStarted = true;
    processDueReturns(client);
    setInterval(function () {
        processDueReturns(client);
    }, CHECK_INTERVAL_MS);
    console.log('[SuspensionReturns] Scheduler started (every 15 min).');
}

module.exports = {
    queueReturnInvite: queueReturnInvite,
    processDueReturns: processDueReturns,
    startScheduler: startScheduler,
};
