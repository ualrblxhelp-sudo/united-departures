// routes/airports.js
// Live player counts for the airport places.
//
// WHY THIS EXISTS:
// Roblox's HttpService blocks all requests to roblox.com domains, so a Roblox
// game CANNOT ask Roblox how many players are in another experience. This bot
// can, though — it's just a Node server. So we fetch the counts here and
// re-serve them on an endpoint the Roblox game IS allowed to reach.
//
// Roblox's games API keys off UNIVERSE ids, not place ids, so we resolve
// placeId -> universeId once and cache it (that mapping never changes).

const AIRPORTS = [
    { code: 'EWR', placeId: 95918419045248,  name: 'Newark Liberty International Airport' },
    { code: 'DEN', placeId: 128532726067296, name: 'Denver International Airport' },
    { code: 'ORD', placeId: 100980446800815, name: 'Chicago Training Hub' },
];

const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000; // placeId -> universeId is permanent; re-check daily anyway
const COUNT_TTL_MS    = 20 * 1000;           // don't hammer Roblox; 20s is plenty for a UI

const universeCache = new Map(); // placeId -> { universeId, at }
let countCache = { data: null, at: 0 };

async function resolveUniverseId(placeId) {
    const cached = universeCache.get(placeId);
    if (cached && Date.now() - cached.at < UNIVERSE_TTL_MS) {
        return cached.universeId;
    }

    const res = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    if (!res.ok) throw new Error(`universe lookup failed for ${placeId}: HTTP ${res.status}`);

    const body = await res.json();
    const universeId = body.universeId;
    if (!universeId) throw new Error(`no universeId returned for ${placeId}`);

    universeCache.set(placeId, { universeId, at: Date.now() });
    return universeId;
}

async function fetchCounts() {
    // Resolve every universe id first (cached after the first call).
    const resolved = [];
    for (const a of AIRPORTS) {
        try {
            const universeId = await resolveUniverseId(a.placeId);
            resolved.push({ ...a, universeId });
        } catch (err) {
            console.error('[Airports API]', err.message);
            resolved.push({ ...a, universeId: null });
        }
    }

    const ids = resolved.filter(a => a.universeId).map(a => a.universeId);
    const playing = new Map();

    if (ids.length) {
        const res = await fetch(`https://games.roblox.com/v1/games?universeIds=${ids.join(',')}`);
        if (!res.ok) throw new Error(`games lookup failed: HTTP ${res.status}`);
        const body = await res.json();
        for (const g of (body.data || [])) {
            playing.set(g.id, { playing: g.playing || 0, visits: g.visits || 0 });
        }
    }

    return resolved.map(a => {
        const stats = a.universeId ? playing.get(a.universeId) : null;
        return {
            code: a.code,
            name: a.name,
            placeId: a.placeId,
            universeId: a.universeId,
            // null (not 0) when we genuinely don't know — the UI can then show
            // the last known value instead of a misleading "0 Online".
            playing: stats ? stats.playing : null,
            visits: stats ? stats.visits : null,
        };
    });
}

function setupAirportsRoute(app) {
    app.get('/api/airports', async (req, res) => {
        const expectedKey = process.env.ROBLOX_API_KEY;
        if (!expectedKey) {
            return res.status(503).json({ ok: false, error: 'API not configured' });
        }
        if (req.get('x-api-key') !== expectedKey) {
            return res.status(401).json({ ok: false, error: 'Unauthorized' });
        }

        // Serve from cache if it's fresh.
        if (countCache.data && Date.now() - countCache.at < COUNT_TTL_MS) {
            return res.json({
                ok: true,
                cached: true,
                airports: countCache.data,
                generatedAt: new Date(countCache.at).toISOString(),
            });
        }

        try {
            const airports = await fetchCounts();
            countCache = { data: airports, at: Date.now() };
            return res.json({
                ok: true,
                cached: false,
                airports,
                generatedAt: new Date().toISOString(),
            });
        } catch (err) {
            console.error('[Airports API] Error:', err);
            // Serve stale data rather than nothing, but say so.
            if (countCache.data) {
                return res.json({
                    ok: true,
                    stale: true,
                    airports: countCache.data,
                    generatedAt: new Date(countCache.at).toISOString(),
                });
            }
            return res.status(500).json({ ok: false, error: 'Internal error' });
        }
    });
}

module.exports = { setupAirportsRoute, AIRPORTS };
