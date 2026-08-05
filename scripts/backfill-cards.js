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

// Roblox rate-limits inventory lookups. One member at a time with a small gap
// is slow but finishes; hammering it returns 429s and the run has to be redone.
var DELAY_MS = 120;

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

async function ownsGamePass(userId, gamePassId) {
    var url = 'https://inventory.roblox.com/v1/users/' + userId
        + '/items/GamePass/' + gamePassId + '/is-owned';

    for (var attempt = 1; attempt <= 3; attempt++) {
        try {
            var res = await fetch(url);

            if (res.status === 429) {
                // Backing off rather than failing: a 429 means "later", not
                // "no", and treating it as no would silently skip a cardholder.
                await sleep(2000 * attempt);
                continue;
            }

            if (!res.ok) return null;

            var text = (await res.text()).trim();
            return text === 'true';
        } catch (err) {
            await sleep(1000 * attempt);
        }
    }

    return null; // unknown after retries -- reported, never treated as false
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

    var granted = 0, already = 0, skipped = 0, failed = 0, checked = 0;

    for (var i = 0; i < members.length; i++) {
        var m = members[i];
        var userId = m.roblox_user_id;
        var label = (m.username || '?') + ' (' + userId + ')';

        for (var c = 0; c < CARDS.length; c++) {
            var entry = CARDS[c];

            var owns = await ownsGamePass(userId, entry.gamePassId);
            checked++;
            await sleep(DELAY_MS);

            if (owns === null) {
                console.log('  ? ' + label + ' / ' + entry.card + ' -- lookup failed, skipped');
                failed++;
                continue;
            }

            if (!owns) continue;

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

        if ((i + 1) % 25 === 0) {
            console.log('... ' + (i + 1) + '/' + members.length + ' members');
        }
    }

    console.log('');
    console.log('=== done ===');
    console.log('ownership checks : ' + checked);
    console.log('granted          : ' + granted);
    console.log('already claimed  : ' + already);
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
