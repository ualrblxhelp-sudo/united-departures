// routes/miles.js
// MileagePlus (UAMS / Volare) miles-engine API.
//
// Serves every miles surface: the mystatus GUI, the hub Mileage view, the phone
// (spend miles on tickets), and the staff panel (check-in, payout, generate
// list, manual grants). It also exposes a Discord-resolution read that the
// /miles slash command reuses in Phase 3.
//
// Auth: identical to the flights API — the Roblox game (and the bot itself)
// send `x-api-key: <ROBLOX_API_KEY>`. The backend holds the Supabase service
// key, so no Supabase credential ever ships inside a Roblox place.

var sb = require('../services/supabase');
var attendanceUtil = require('../utils/attendance');
var roblox = require('../services/roblox');
var bloxlink = require('../services/bloxlink');

var CABINS = ['basic_economy', 'economy', 'economy_plus', 'premium_plus', 'first', 'polaris'];
var STATUSES = ['general', 'silver', 'gold', 'platinum', '1k', 'gs'];
var CARDS = ['gateway', 'explorer', 'quest', 'united_club'];
var HAULS = ['short', 'medium', 'long'];

// Same fail-safe auth as routes/flights.js.
function keyOk(req, res) {
    var expectedKey = process.env.ROBLOX_API_KEY;
    if (!expectedKey) { res.status(503).json({ ok: false, error: 'API not configured' }); return false; }
    if (req.get('x-api-key') !== expectedKey) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return false; }
    return true;
}

function sbOk(res) {
    if (!sb.configured()) { res.status(503).json({ ok: false, error: 'Supabase not configured' }); return false; }
    return true;
}

// Accept an explicit numeric userId, or resolve a username via the public
// Roblox API. Returns { userId, username } or null.
async function resolveUser(src) {
    if (src.userId != null && /^\d+$/.test(String(src.userId))) {
        return { userId: Number(src.userId), username: src.username || null };
    }
    if (src.username) {
        var r = await roblox.usernameToUserId(String(src.username));
        if (r) return { userId: r.userId, username: r.username };
    }
    return null;
}

function fail(res, err, tag) {
    console.error('[Miles API] ' + tag + ':', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
}

// The Discord client is captured at setup so payout can post the attendance
// embed. It stays optional: if it isn't passed, attendance records still save.
var discordClient = null;

function setupMilesRoute(app, client) {
    discordClient = client || null;

    // ---- READ: member status (mystatus GUI, hub, phone, staff lookup) --------
    app.get('/api/miles/status', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        try {
            var who = await resolveUser(req.query);
            if (!who) return res.status(400).json({ ok: false, error: 'Provide userId or a resolvable username' });
            var status = await sb.rpc('get_member_status', { p_user_id: who.userId });
            return res.json({ ok: true, status: status });
        } catch (err) { return fail(res, err, 'status'); }
    });

    // ---- READ: recent activity feed -----------------------------------------
    app.get('/api/miles/transactions', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        if (!req.query.userId) return res.status(400).json({ ok: false, error: 'userId required' });
        try {
            var limit = Math.min(Number(req.query.limit) || 15, 100);
            var rows = await sb.select('transactions', {
                select: '*',
                roblox_user_id: 'eq.' + Number(req.query.userId),
                order: 'created_at.desc',
                limit: String(limit),
            });
            return res.json({ ok: true, transactions: rows });
        } catch (err) { return fail(res, err, 'transactions'); }
    });

    // ---- READ: status by Discord id (Bloxlink) — used by /miles -------------
    app.get('/api/miles/status/discord/:discordId', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        try {
            var link = await bloxlink.discordToRoblox(String(req.params.discordId));
            if (!link.configured) return res.status(503).json({ ok: false, code: 'bloxlink_unset', error: 'Discord linking not configured yet' });
            if (!link.linked || !link.robloxId) return res.status(404).json({ ok: false, code: 'not_linked', error: 'No Roblox account linked via Bloxlink' });
            var status = await sb.rpc('get_member_status', { p_user_id: link.robloxId });
            return res.json({ ok: true, robloxId: link.robloxId, status: status });
        } catch (err) { return fail(res, err, 'discord-status'); }
    });

    // ---- WRITE: upsert a flight (staff flight-create bridge) ----------------
    app.post('/api/miles/flight', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (HAULS.indexOf(b.haul) === -1) return res.status(400).json({ ok: false, error: 'haul must be short|medium|long' });
        try {
            var flight = await sb.rpc('upsert_flight', {
                p_haul: b.haul,
                p_flight_code: b.flightCode || null,
                p_origin: b.origin || null,
                p_destination: b.destination || null,
                p_aircraft: b.aircraft || null,
                p_external_ref: b.externalRef || null,
            });
            return res.json({ ok: true, flight: flight });
        } catch (err) { return fail(res, err, 'flight'); }
    });

    // ---- WRITE: check in / book a passenger at a cabin (staff Check-In) -----
    app.post('/api/miles/checkin', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (!b.flightId) return res.status(400).json({ ok: false, error: 'flightId required' });
        if (CABINS.indexOf(b.cabin) === -1) return res.status(400).json({ ok: false, error: 'invalid cabin' });
        try {
            var who = await resolveUser(b);
            if (!who) return res.status(404).json({ ok: false, error: 'Roblox user not found' });
            var booking = await sb.rpc('book_passenger', {
                p_flight_id: b.flightId, p_user_id: who.userId, p_username: who.username,
                p_cabin: b.cabin, p_via: b.bookedVia || 'checkin', p_seat: b.seat || null,
            });
            return res.json({ ok: true, booking: booking });
        } catch (err) { return fail(res, err, 'checkin'); }
    });

    // ---- WRITE: void an unpaid booking (player left before payout) ----------
    app.post('/api/miles/unbook', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (!b.flightId || b.userId == null) return res.status(400).json({ ok: false, error: 'flightId and userId required' });
        try {
            var result = await sb.rpc('void_booking', { p_flight_id: b.flightId, p_user_id: Number(b.userId) });
            return res.json({ ok: true, result: result });
        } catch (err) { return fail(res, err, 'unbook'); }
    });

    // ---- WRITE: mark a passenger boarded (phone bookings earn only once boarded) ----
    app.post('/api/miles/board', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (!b.flightId) return res.status(400).json({ ok: false, error: 'flightId required' });
        try {
            var who = await resolveUser(b);
            if (!who) return res.status(404).json({ ok: false, error: 'Roblox user not found' });
            var result = await sb.rpc('mark_boarded', { p_flight_id: b.flightId, p_user_id: who.userId });
            return res.json({ ok: true, result: result });
        } catch (err) { return fail(res, err, 'board'); }
    });

    // ---- WRITE: pay out a flight (staff MileagePlus Payout) -----------------
    app.post('/api/miles/payout', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (!b.flightId) return res.status(400).json({ ok: false, error: 'flightId required' });
        try {
            var result = await sb.rpc('pay_out_flight', { p_flight_id: b.flightId });

            // Staff attendance is a side-effect of payout: it must never be able
            // to fail the payout itself, so it runs after the RPC and its errors
            // are reported alongside rather than thrown.
            var attendance = null;
            if (Array.isArray(b.attendance) && b.attendance.length) {
                attendance = await attendanceUtil.recordAttendance(discordClient, {
                    flightId: b.flightId,
                    flightCode: b.flightCode,
                    route: b.route,
                    recordedBy: b.recordedBy,
                    minRank: b.minRank,
                    attendance: b.attendance,
                });
            }

            return res.json({ ok: true, result: result, attendance: attendance });
        } catch (err) { return fail(res, err, 'payout'); }
    });

    // ---- WRITE: manual grant of miles/PQP/PQF/PlusPoints -------------------
    app.post('/api/miles/grant', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        try {
            var who = await resolveUser(b);
            if (!who) return res.status(404).json({ ok: false, error: 'Roblox user not found' });
            var status = await sb.rpc('grant_currency', {
                p_user_id: who.userId,
                p_miles: Number(b.miles) || 0, p_pqp: Number(b.pqp) || 0,
                p_pqf: Number(b.pqf) || 0, p_pp: Number(b.pluspoints) || 0,
                p_reason: b.reason || 'staff grant',
            });
            return res.json({ ok: true, status: status });
        } catch (err) { return fail(res, err, 'grant'); }
    });

    // ---- WRITE: set status / grant Global Services (manual promotion) -------
    app.post('/api/miles/status-set', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (STATUSES.indexOf(b.status) === -1) return res.status(400).json({ ok: false, error: 'invalid status' });
        try {
            var who = await resolveUser(b);
            if (!who) return res.status(404).json({ ok: false, error: 'Roblox user not found' });
            await sb.rpc('set_status', { p_user_id: who.userId, p_status: b.status });
            var status = await sb.rpc('get_member_status', { p_user_id: who.userId });
            return res.json({ ok: true, status: status });
        } catch (err) { return fail(res, err, 'status-set'); }
    });

    // ---- WRITE: card grant (gamepass ownership sync; one-time idempotent) ---
    app.post('/api/miles/card', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (CARDS.indexOf(b.card) === -1) return res.status(400).json({ ok: false, error: 'invalid card' });
        try {
            var who = await resolveUser(b);
            if (!who) return res.status(404).json({ ok: false, error: 'Roblox user not found' });
            var result = await sb.rpc('grant_card', { p_user_id: who.userId, p_card: b.card });
            return res.json({ ok: true, result: result });
        } catch (err) { return fail(res, err, 'card'); }
    });

    // ---- WRITE: record a Robux purchase -> purchase miles (dev product) -----
    app.post('/api/miles/purchase', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (!b.robux || Number(b.robux) <= 0) return res.status(400).json({ ok: false, error: 'robux required' });
        try {
            var who = await resolveUser(b);
            if (!who) return res.status(404).json({ ok: false, error: 'Roblox user not found' });
            var earned = await sb.rpc('record_robux_purchase', {
                p_user_id: who.userId, p_robux: Number(b.robux), p_is_ticket: Boolean(b.isTicket),
            });
            return res.json({ ok: true, milesEarned: earned });
        } catch (err) { return fail(res, err, 'purchase'); }
    });

    // ---- WRITE: redeem an award ticket (phone spend, optional Money+Miles) --
    app.post('/api/miles/redeem/award', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (CABINS.indexOf(b.cabin) === -1 || HAULS.indexOf(b.haul) === -1) return res.status(400).json({ ok: false, error: 'valid cabin and haul required' });
        try {
            var who = await resolveUser(b);
            if (!who) return res.status(404).json({ ok: false, error: 'Roblox user not found' });
            var result = await sb.rpc('redeem_award', {
                p_user_id: who.userId, p_cabin: b.cabin, p_haul: b.haul,
                p_robux_buydown: Number(b.robuxBuydown) || 0,
            });
            return res.json({ ok: true, result: result });
        } catch (err) { return fail(res, err, 'award'); }
    });

    // ---- WRITE: redeem an à la carte item -----------------------------------
    app.post('/api/miles/redeem/alacarte', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (!b.item) return res.status(400).json({ ok: false, error: 'item required' });
        try {
            var who = await resolveUser(b);
            if (!who) return res.status(404).json({ ok: false, error: 'Roblox user not found' });
            var result = await sb.rpc('redeem_alacarte', {
                p_user_id: who.userId, p_item: b.item, p_pay_with: b.payWith || 'miles',
            });
            return res.json({ ok: true, result: result });
        } catch (err) { return fail(res, err, 'alacarte'); }
    });

    // ---- WRITE: buy a one-tier upgrade --------------------------------------
    app.post('/api/miles/redeem/upgrade', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (HAULS.indexOf(b.haul) === -1) return res.status(400).json({ ok: false, error: 'valid haul required' });
        try {
            var who = await resolveUser(b);
            if (!who) return res.status(404).json({ ok: false, error: 'Roblox user not found' });
            var result = await sb.rpc('buy_upgrade', {
                p_user_id: who.userId, p_haul: b.haul, p_pay_with: b.payWith || 'miles',
            });
            return res.json({ ok: true, result: result });
        } catch (err) { return fail(res, err, 'upgrade'); }
    });

    // ---- READ: staff upgrade cost preview (full award price x 0.95^count) ----
    app.get('/api/miles/upgrade/cost', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        try {
            var who = await resolveUser({ username: req.query.username, userId: req.query.userId });
            if (!who) return res.status(404).json({ ok: false, error: 'Roblox user not found' });
            var result = await sb.rpc('upgrade_cost', {
                p_user_id: who.userId, p_cabin: req.query.cabin, p_haul: req.query.haul,
            });
            return res.json({ ok: true, result: result, userId: who.userId });
        } catch (err) { return fail(res, err, 'upgrade/cost'); }
    });

    // ---- WRITE: staff upgrade a passenger (gift or miles) --------------------
    app.post('/api/miles/upgrade', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (!b.flightId) return res.status(400).json({ ok: false, error: 'flightId required' });
        if (CABINS.indexOf(b.cabin) === -1) return res.status(400).json({ ok: false, error: 'invalid cabin' });
        try {
            var who = await resolveUser(b);
            if (!who) return res.status(404).json({ ok: false, error: 'Roblox user not found' });
            var result = await sb.rpc('upgrade_passenger', {
                p_flight_id: b.flightId, p_user_id: who.userId, p_username: who.username,
                p_cabin: b.cabin, p_haul: b.haul, p_seat: b.seat || null,
                p_pay_with_miles: !!b.payWithMiles,
            });
            return res.json({ ok: true, result: result, userId: who.userId });
        } catch (err) { return fail(res, err, 'upgrade'); }
    });

    // ---- WRITE: run the upgrade lottery (staff, Phase 7) --------------------
    app.post('/api/miles/lottery', async function (req, res) {
        if (!keyOk(req, res)) return; if (!sbOk(res)) return;
        var b = req.body || {};
        if (!b.flightId) return res.status(400).json({ ok: false, error: 'flightId required' });
        var openSeats = b.openSeats || {};
        try {
            var result = await sb.rpc('run_upgrade_lottery', {
                p_flight_id: b.flightId, p_open_seats: openSeats,
            });
            return res.json({ ok: true, result: result });
        } catch (err) { return fail(res, err, 'lottery'); }
    });
}

module.exports = { setupMilesRoute };
