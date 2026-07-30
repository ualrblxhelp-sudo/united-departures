// utils/sheet.js — Pushes Employee Database updates to the Google Apps Script web app.
//
// The bot sends semantic events; the Apps Script (doPost) locates the member's row by
// Roblox username and updates the right column. Never throws into callers — every failure
// is logged and swallowed so a sheet hiccup can't break a command or the scheduler.
//
// Env vars (set on Render):
//   EMPLOYEE_SHEET_WEBHOOK_URL  the Apps Script Web App /exec URL
//   EMPLOYEE_SHEET_SECRET       shared secret; must match the script's BOT_SECRET property

var WEBHOOK_URL = process.env.EMPLOYEE_SHEET_WEBHOOK_URL;
var SECRET = process.env.EMPLOYEE_SHEET_SECRET;
var TIMEOUT_MS = Math.max(5 * 1000, parseInt(process.env.EMPLOYEE_SHEET_TIMEOUT_MS || '30000', 10) || 30000);
var MAX_TIMEOUT_RETRIES = 1;

async function doSheetPost(payload) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, TIMEOUT_MS);
    try {
        return await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ secret: SECRET }, payload)),
            redirect: 'follow',
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}

async function postToSheet(payload) {
    if (!WEBHOOK_URL) {
        console.error('[Sheet] EMPLOYEE_SHEET_WEBHOOK_URL not set — skipping sync:', JSON.stringify(payload));
        return { ok: false, skipped: true };
    }
    if (typeof fetch !== 'function') {
        console.error('[Sheet] global fetch unavailable — needs Node 18+.');
        return { ok: false, skipped: true };
    }

    for (var attempt = 0; attempt <= MAX_TIMEOUT_RETRIES; attempt++) {
        try {
            var res = await doSheetPost(payload);
            var text = await res.text();
            var data;
            try { data = JSON.parse(text); } catch (e) { data = { ok: false, error: 'non-JSON response', raw: text.slice(0, 200) }; }
            if (!data.ok) {
                console.error('[Sheet] Update failed (' + JSON.stringify(payload) + '):', data.error || text.slice(0, 200));
            }
            return data;
        } catch (err) {
            var isAbort = err && err.name === 'AbortError';
            if (isAbort && attempt < MAX_TIMEOUT_RETRIES) {
                console.warn('[Sheet] POST timeout, retrying (' + (attempt + 1) + '/' + MAX_TIMEOUT_RETRIES + '):', JSON.stringify(payload));
                continue;
            }
            console.error('[Sheet] POST error (' + JSON.stringify(payload) + '):', isAbort ? ('timeout after ' + TIMEOUT_MS + 'ms') : err.message);
            return { ok: false, error: isAbort ? ('timeout after ' + TIMEOUT_MS + 'ms') : err.message };
        }
    }
}

// Sets the member's CURRENT sanction count (Column R) to the authoritative active total.
async function syncSanctionTotal(robloxUsername, total) {
    if (!robloxUsername) return { ok: false, error: 'no username' };
    return postToSheet({ action: 'sanction', username: robloxUsername, value: total });
}

// Adds `days` to the member's LOA USED count (Column Q).
async function addLoaUsedDays(robloxUsername, days) {
    if (!robloxUsername) return { ok: false, error: 'no username' };
    if (!days || days < 1) return { ok: false, error: 'invalid days' };
    return postToSheet({ action: 'loa', username: robloxUsername, value: days });
}

module.exports = {
    syncSanctionTotal: syncSanctionTotal,
    addLoaUsedDays: addLoaUsedDays,
    postToSheet: postToSheet,
};
