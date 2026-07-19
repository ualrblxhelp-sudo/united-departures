// utils/milesReset.js
// Fires the Supabase annual_reset() once when the calendar hits Jan 31 in
// America/New_York. Checks every few hours and de-dupes so it runs at most once
// per day. Safe no-op if Supabase isn't configured. Start it from index.js.

var sb = require('../services/supabase');

var lastRunKey = null;

async function checkAndReset() {
    try {
        if (!sb.configured()) return;
        var parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(new Date());
        var y = parts.find(function (p) { return p.type === 'year'; }).value;
        var m = parts.find(function (p) { return p.type === 'month'; }).value;
        var d = parts.find(function (p) { return p.type === 'day'; }).value;
        var key = y + '-' + m + '-' + d;

        if (m === '01' && d === '31' && lastRunKey !== key) {
            lastRunKey = key;
            var affected = await sb.rpc('annual_reset', {});
            console.log('[MilesReset] annual_reset ran on ' + key + ', members affected:', affected);
        }
    } catch (err) {
        console.error('[MilesReset] error:', err);
    }
}

function startMilesReset() {
    checkAndReset();
    setInterval(checkAndReset, 6 * 60 * 60 * 1000); // every 6 hours
}

module.exports = { startMilesReset };
