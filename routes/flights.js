// routes/flights.js
// Read-only public flight calendar API for the Roblox United Flight Hub.
// Consumed server-side via Roblox HttpService:GetAsync with an x-api-key header.
// This endpoint NEVER exposes the database; it serves a shaped, read-only view.

var Flight = require('../models/Flight');
var aircraftConfig = require('../config/aircraft');
var AIRCRAFT = aircraftConfig.AIRCRAFT;

var VALID_TYPES = ['regular', 'premium', 'test', 'all'];

function aircraftName(key) {
    if (key && AIRCRAFT[key] && AIRCRAFT[key].name) return AIRCRAFT[key].name;
    return key || null;
}

function toISO(unixSeconds) {
    if (typeof unixSeconds !== 'number' || !isFinite(unixSeconds)) return null;
    return new Date(unixSeconds * 1000).toISOString();
}

function shapeFlight(f) {
    return {
        id: String(f._id),
        flightNumber: f.flightNumber,
        departure: f.departure,            // origin IATA code
        destination: f.destination,        // destination IATA code
        aircraft: f.aircraft,              // internal key, e.g. "737-800 NEXT"
        aircraftName: aircraftName(f.aircraft), // friendly name, e.g. "Boeing 737-800 NEXT"
        flightType: f.flightType,          // regular | premium | test
        status: f.status,                  // scheduled | active | completed | cancelled
        // serverOpenTime = public departure / server-open time shown on the calendar
        serverOpenTime: f.serverOpenTime,
        serverOpenTimeISO: toISO(f.serverOpenTime),
        // employeeJoinTime = earlier crew boarding / join time
        employeeJoinTime: f.employeeJoinTime,
        employeeJoinTimeISO: toISO(f.employeeJoinTime),
        dispatcher: f.dispatcherUsername || null,
        crewCount: Array.isArray(f.allocations) ? f.allocations.length : 0,
    };
}

function setupFlightsRoute(app) {
    app.get('/api/flights', async function(req, res) {
        // Fail safe: if no key is configured on the server, do not serve any data.
        var expectedKey = process.env.ROBLOX_API_KEY;
        if (!expectedKey) {
            return res.status(503).json({ ok: false, error: 'API not configured' });
        }

        // Auth: x-api-key header must match ROBLOX_API_KEY exactly.
        var providedKey = req.get('x-api-key');
        if (!providedKey || providedKey !== expectedKey) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        // Filtering: ?type=regular (default) | premium | test | all
        var type = String(req.query.type || 'regular').toLowerCase();
        if (VALID_TYPES.indexOf(type) === -1) {
            return res.status(400).json({ ok: false, error: 'Invalid type. Use regular, premium, test, or all.' });
        }

        var query = { status: 'scheduled' };
        if (type !== 'all') query.flightType = type;

        try {
            var flights = await Flight.find(query).sort({ serverOpenTime: 1 }).lean();
            var shaped = flights.map(shapeFlight);
            return res.json({
                ok: true,
                count: shaped.length,
                type: type,
                generatedAt: new Date().toISOString(),
                flights: shaped,
            });
        } catch (err) {
            console.error('[Flights API] Error:', err);
            return res.status(500).json({ ok: false, error: 'Internal error' });
        }
    });
}

module.exports = { setupFlightsRoute, shapeFlight };
