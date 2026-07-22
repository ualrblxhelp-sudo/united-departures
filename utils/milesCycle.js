// utils/milesCycle.js
// Replaces utils/milesReset.js.
//
// The old model wiped every member's qualifying data on Jan 31. That is gone:
// qualifying cycles are now PER-MEMBER and run 6 months from each member's last
// status change, so there is no calendar date to fire on. Instead we sweep
// periodically and let Postgres decide who is actually due.
//
// demote_overdue() is idempotent -- it restamps status_changed_at for everyone
// it touches, so a member can only be processed once per 6-month window. That
// makes running this every few hours completely safe; a missed run (deploy,
// restart, outage) is picked up on the next pass instead of being skipped.
//
// Miles, lifetime miles and PlusPoints are never affected by this sweep.

var sb = require('../services/supabase');

var SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
var running = false;

async function runSweep() {
    if (running) return;            // don't overlap a slow sweep with the next tick
    if (!sb.configured()) return;   // no-op until Supabase is wired
    running = true;
    try {
        var result = await sb.rpc('demote_overdue', {});
        // demote_overdue returns { demoted, retained }; Supabase may hand it
        // back as an object or a single-row array depending on the client.
        var row = Array.isArray(result) ? result[0] : result;
        var demoted = (row && row.demoted) || 0;
        var retained = (row && row.retained) || 0;
        if (demoted > 0 || retained > 0) {
            console.log('[MilesCycle] sweep complete - demoted: ' + demoted + ', retained: ' + retained);
        }
    } catch (err) {
        // A missing RPC (migration not applied yet) must not crash the bot --
        // log clearly and let the next tick retry.
        console.error('[MilesCycle] sweep failed:', (err && err.message) || err);
    } finally {
        running = false;
    }
}

function startMilesCycle() {
    runSweep();
    setInterval(runSweep, SWEEP_INTERVAL_MS);
}

module.exports = { startMilesCycle, runSweep };
