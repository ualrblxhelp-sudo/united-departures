// services/permissions.js
// Gate helper: is `userId` at OR above `roleId` (by hierarchy) in `guildId`?
// Used by the miles-admin commands, which check rank in the MAIN United server.

async function atOrAboveRole(client, userId, guildId, roleId) {
    try {
        var guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
        if (!guild) return false;
        var member = await guild.members.fetch(userId).catch(function () { return null; });
        if (!member) return false;
        var gate = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(function () { return null; });
        if (!gate) return false;
        return member.roles.highest.comparePositionTo(gate) >= 0;
    } catch (err) {
        console.error('[Permissions] atOrAboveRole:', err);
        return false;
    }
}

module.exports = { atOrAboveRole };
