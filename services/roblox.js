// services/roblox.js
// Roblox public API helpers. These endpoints need NO API key.
// Used to turn a username (typed into the staff Check-In tool) into a UserId,
// which is the primary key of a MileagePlus member.

// Resolve a username -> { userId, username } (canonical casing), or null.
async function usernameToUserId(username) {
    try {
        var res = await fetch('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [String(username)], excludeBannedUsers: false }),
        });
        if (!res.ok) return null;
        var data = await res.json();
        if (!data || !Array.isArray(data.data) || data.data.length === 0) return null;
        return { userId: data.data[0].id, username: data.data[0].name };
    } catch (err) {
        console.error('[Roblox] usernameToUserId:', err);
        return null;
    }
}

// Resolve a UserId -> { userId, username, displayName }, or null.
async function userIdToUsername(userId) {
    try {
        var res = await fetch('https://users.roblox.com/v1/users/' + Number(userId));
        if (!res.ok) return null;
        var data = await res.json();
        if (!data || !data.id) return null;
        return { userId: data.id, username: data.name, displayName: data.displayName };
    } catch (err) {
        console.error('[Roblox] userIdToUsername:', err);
        return null;
    }
}

module.exports = { usernameToUserId, userIdToUsername };
