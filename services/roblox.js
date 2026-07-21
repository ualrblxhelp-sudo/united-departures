// services/roblox.js
// Roblox helpers. The username/id lookups need NO API key. Group ranking uses
// the Open Cloud API and REQUIRES an env key ROBLOX_OPENCLOUD_KEY with the
// "group:write" scope for group 15667508 (and the key's owner must outrank the
// role being assigned — a Roblox restriction).

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

// ---- group ranking (Open Cloud v2) --------------------------------------
var OPENCLOUD = 'https://apis.roblox.com/cloud/v2';

function ocKey() { return process.env.ROBLOX_OPENCLOUD_KEY; }

async function getGroupRoles(groupId) {
    var res = await fetch(OPENCLOUD + '/groups/' + groupId + '/roles?maxPageSize=100', {
        headers: { 'x-api-key': ocKey() },
    });
    if (!res.ok) throw new Error('roles ' + res.status);
    var data = await res.json();
    return data.groupRoles || [];   // each: { path, id, displayName, rank }
}

async function getMembership(groupId, userId) {
    var filter = encodeURIComponent("user == 'users/" + Number(userId) + "'");
    var res = await fetch(OPENCLOUD + '/groups/' + groupId + '/memberships?maxPageSize=1&filter=' + filter, {
        headers: { 'x-api-key': ocKey() },
    });
    if (!res.ok) throw new Error('membership ' + res.status);
    var data = await res.json();
    return (data.groupMemberships && data.groupMemberships[0]) || null;  // { path, user, role }
}

// Promote/demote a user to an exact rank NAME. Returns { ok, rank } or { ok:false, reason, ... }.
async function setGroupRank(groupId, userId, rankName) {
    if (!ocKey()) return { ok: false, reason: 'not_configured' };
    try {
        var roles = await getGroupRoles(groupId);
        var wanted = String(rankName).trim().toLowerCase();
        var target = roles.find(function (r) { return String(r.displayName).trim().toLowerCase() === wanted; });
        if (!target) {
            return { ok: false, reason: 'unknown_rank', roles: roles.map(function (r) { return r.displayName; }) };
        }
        var membership = await getMembership(groupId, userId);
        if (!membership) return { ok: false, reason: 'not_in_group' };

        var res = await fetch(OPENCLOUD + '/' + membership.path, {
            method: 'PATCH',
            headers: { 'x-api-key': ocKey(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: target.path }),
        });
        if (res.ok) return { ok: true, rank: target.displayName, rankNumber: target.rank };
        var detail = await res.text();
        return { ok: false, reason: 'api_error', status: res.status, detail: detail };
    } catch (err) {
        console.error('[Roblox] setGroupRank:', err);
        return { ok: false, reason: 'error' };
    }
}

module.exports = { usernameToUserId, userIdToUsername, setGroupRank, getGroupRoles };
