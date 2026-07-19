// services/bloxlink.js
// Resolves a Discord user -> their linked Roblox UserId via the Bloxlink
// Server API. Only needed for the Discord /miles command; every in-game surface
// (topbar +, mystatus GUI, phone) works without it.
//
// Requires BLOXLINK_API_KEY (the server key from the Bloxlink dashboard) and
// BLOXLINK_GUILD_ID (the main United guild). Until both are set, this returns
// { configured: false } and the /miles command tells the user linking isn't
// set up yet — nothing crashes.

function configured() {
    return Boolean(process.env.BLOXLINK_API_KEY && process.env.BLOXLINK_GUILD_ID);
}

// Returns one of:
//   { configured: false }                          -> keys not set yet
//   { configured: true, linked: false }            -> user not verified / not in guild
//   { configured: true, linked: true, robloxId }   -> resolved
async function discordToRoblox(discordId) {
    if (!configured()) return { configured: false };
    var url = 'https://api.blox.link/v4/public/guilds/' +
        process.env.BLOXLINK_GUILD_ID + '/discord-to-roblox/' + String(discordId);

    var res = await fetch(url, {
        headers: { 'Authorization': process.env.BLOXLINK_API_KEY },
    });

    if (res.status === 404) return { configured: true, linked: false };

    var data;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!res.ok) {
        var err = new Error('Bloxlink error (' + res.status + ')');
        err.status = res.status;
        err.body = data;
        throw err;
    }

    var robloxId = data && (data.robloxID || data.robloxId);
    if (!robloxId) return { configured: true, linked: false };
    return { configured: true, linked: true, robloxId: Number(robloxId) };
}

module.exports = { configured, discordToRoblox };
