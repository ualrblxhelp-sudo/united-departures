// scripts/backfill-cards.js
//
// One-off backfill: grants card perks to everyone who already bought a card
// before the name mismatch was fixed.
//
// WHY THIS IS NEEDED
// grant_card was being called with display names ("Club Card") instead of the
// canonical keys ("united_club"). The bot rejected those with 400 invalid card,
// so the RPC never ran and member_cards was never written. Every existing
// cardholder is therefore un-credited.
//
// WHY IT CANNOT BE PURE SQL
// Supabase has no idea who owns which gamepass -- ownership lives on Roblox.
// This walks the member list, asks Roblox who owns what, and calls grant_card
// for each hit.
//
// SAFE TO RE-RUN
// grant_card is idempotent via member_cards.one_time_claimed: a second call for
// the same member and card returns already_claimed and grants nothing. So this
// can be run repeatedly, or interrupted and resumed, without double-crediting.
//
// USAGE
//   node scripts/backfill-cards.js            # do it
//   node scripts/backfill-cards.js --dry-run  # report only, change nothing
//
// On Render: Shell tab, then the same command.

var sb = require('../services/supabase');

// gamepass -> canonical card key. These MUST match card_defs.card exactly;
// that mismatch is the whole reason this script exists.
var CARDS = [
    { card: 'gateway',     gamePassId: 112966589478875 },
    { card: 'explorer',    gamePassId: 74282656110256 },
    { card: 'quest',       gamePassId: 119093267072128 },
    { card: 'united_club', gamePassId: 88848246707563 },
];

var DRY_RUN = process.argv.indexOf('--dry-run') !== -1;

// Roblox rate-limits the inventory API HARD from cloud hosts -- Render's egress
// IP is shared with many other services, so the budget is often already spent
// before this script sends anything. 120ms produced a 429 on the very first
// request.
//
// Two seconds per lookup is slow (101 members x 4 cards = ~13 minutes) but it
// actually completes, which beats a fast run that fails immediately. Override
// with --delay=5000 if it is still throttled.
var DELAY_MS = 2000;
for (var ai = 0; ai < process.argv.length; ai++) {
    var m = /^--delay=(\d+)$/.exec(process.argv[ai]);
    if (m) DELAY_MS = Number(m[1]);
}

// Resume point, for picking up after an interruption: --start=40
var START_AT = 0;
for (var si = 0; si < process.argv.length; si++) {
    var sm = /^--start=(\d+)$/.exec(process.argv[si]);
    if (sm) START_AT = Number(sm[1]);
}

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

async function ownsGamePass(userId, gamePassId) {
    var url = 'https://inventory.roblox.com/v1/users/' + userId
        + '/items/GamePass/' + gamePassId + '/is-owned';

    var lastReason = 'unknown';

    for (var attempt = 1; attempt <= 6; attempt++) {
        try {
            var res = await fetch(url);

            if (res.status === 429) {
                // Backing off rather than failing: a 429 means "later", not
                // "no", and treating it as no would silently skip a cardholder.
                // Exponential, capped at a minute. A 429 here is an IP-level
                // budget, not a per-request one, so short retries just burn
                // more of it -- waiting properly is the only thing that works.
                lastReason = 'rate limited (429)';
                var wait = Math.min(60000, 5000 * Math.pow(2, attempt - 1));
                console.log('    (429 -- waiting ' + Math.round(wait / 1000) + 's)');
                await sleep(wait);
                continue;
            }

            if (!res.ok) {
                // Report the STATUS and body. A blanket "lookup failed" hides
                // whether this is a block, a bad id, or an outage -- which are
                // three completely different problems.
                var body = '';
                try { body = (await res.text()).slice(0, 120); } catch (e) {}
                lastReason = 'HTTP ' + res.status + (body ? ' ' + body : '');

                // A banned or deleted account returns 400 "The specified user
                // does not exist!". That is a fact about ONE member, not a
                // problem with the run -- they simply cannot own anything, so
                // treat it as "no cards" and carry on. Aborting here stopped
                // the whole backfill because of a single terminated account.
                if (res.status === 400 && body.indexOf('does not exist') !== -1) {
                    return { ok: true, owns: false, gone: true };
                }

                // Other 4xx will not fix themselves on retry.
                if (res.status >= 400 && res.status < 500) {
                    return { ok: false, reason: lastReason };
                }

                await sleep(1000 * attempt);
                continue;
            }

            var text = (await res.text()).trim();
            return { ok: true, owns: text === 'true' };
        } catch (err) {
            lastReason = err.message || String(err);
            await sleep(1000 * attempt);
        }
    }

    return { ok: false, reason: lastReason };
}

async function allMembers() {
    // Everyone with a member row. Anyone who has never joined has no row, but
    // CardService credits them on their first join anyway.
    var rows = await sb.select('members', {
        select: 'roblox_user_id,username',
        order: 'roblox_user_id.asc',
        limit: '10000',
    });
    return Array.isArray(rows) ? rows : [];
}

async function main() {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
        process.exit(1);
    }

    console.log(DRY_RUN ? '=== DRY RUN -- nothing will be written ===' : '=== BACKFILL ===');

    var members = await allMembers();
    console.log('members to check: ' + members.length);
    console.log('cards: ' + CARDS.map(function (c) { return c.card; }).join(', '));
    console.log('');

    var granted = 0, already = 0, skipped = 0, failed = 0, checked = 0, gone = 0;

    if (START_AT > 0) {
        console.log('resuming from member index ' + START_AT);
    }

    for (var i = START_AT; i < members.length; i++) {
        var m = members[i];
        var userId = m.roblox_user_id;
        var label = (m.username || '?') + ' (' + userId + ')';

        for (var c = 0; c < CARDS.length; c++) {
            var entry = CARDS[c];

            var lookup = await ownsGamePass(userId, entry.gamePassId);
            checked++;
            await sleep(DELAY_MS);

            if (!lookup.ok) {
                console.log('  ? ' + label + ' / ' + entry.card
                    + ' -- lookup failed: ' + lookup.reason);
                failed++;

                // If the very first lookups all fail the same way, this is an
                // environment problem, not a per-user one. Stop rather than
                // grinding through thousands of identical failures.
                var fatal = lookup.reason.indexOf('429') === -1;
                if (fatal && failed >= 4 && granted === 0 && already === 0) {
                    console.log('');
                    console.log('Aborting: the first ' + failed + ' lookups all failed.');
                    console.log('Reason: ' + lookup.reason);
                    console.log('Roblox is not answering from this host. See notes at the');
                    console.log('bottom of this script for the alternatives.');
                    process.exit(1);
                }
                continue;
            }

            if (lookup.gone) {
                // Report once per member, not once per card.
                if (entry.card === CARDS[0].card) {
                    console.log('  - ' + label + ' -- account banned or deleted, skipped');
                    gone++;
                }
                continue;
            }

            if (!lookup.owns) continue;

            if (DRY_RUN) {
                console.log('  + ' + label + ' / ' + entry.card + ' -- WOULD grant');
                granted++;
                continue;
            }

            try {
                var result = await sb.rpc('grant_card', {
                    p_user_id: Number(userId),
                    p_card: entry.card,
                });

                if (result && result.already_claimed) {
                    already++;
                } else {
                    granted++;
                    console.log('  + ' + label + ' / ' + entry.card
                        + ' -- granted ' + (result && result.granted_miles) + ' mi, '
                        + (result && result.granted_pqp) + ' PQP');
                }
            } catch (err) {
                console.log('  ! ' + label + ' / ' + entry.card + ' -- ' + err.message);
                failed++;
            }
        }

        if ((i + 1) % 10 === 0) {
            // Index is printed so an interrupted run can resume with --start.
            console.log('... ' + (i + 1) + '/' + members.length
                + ' members (resume with --start=' + (i + 1) + ')');
        }
    }

    console.log('');
    console.log('=== done ===');
    console.log('ownership checks : ' + checked);
    console.log('granted          : ' + granted);
    console.log('already claimed  : ' + already);
    console.log('banned/deleted   : ' + gone);
    console.log('lookup failures  : ' + failed);
    console.log('');
    if (failed > 0) {
        console.log('Re-run to retry the failures; already-granted members are skipped.');
    }
}

main().catch(function (err) {
    console.error('backfill failed: ' + err.message);
    process.exit(1);
});
