// services/supabase.js
// Thin Supabase client over Node's global fetch (Node 18+), no extra dependency.
//
// Works with the NEW Supabase secret keys (sb_secret_...), which are NOT JWTs
// and must be sent on the `apikey` header. We also send Authorization: Bearer
// for PostgREST role mapping — the legacy service_role JWT used that, and the
// new keys accept it too, so this one client works with either key format.
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment. If
// either is missing, configured() returns false and callers fail soft (503),
// so the rest of the bot keeps running without the miles backend.

function baseUrl() {
    var url = process.env.SUPABASE_URL;
    if (!url) return null;
    return url.replace(/\/+$/, ''); // trim any trailing slash
}

function configured() {
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function headers(extra) {
    var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    var h = {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
    };
    if (extra) { for (var k in extra) { h[k] = extra[k]; } }
    return h;
}

async function parse(res) {
    var text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return text; }
}

// Call a Postgres function exposed via PostgREST RPC. `args` keys are the SQL
// parameter names (e.g. { p_user_id: 123 }). Returns the function's result:
// jsonb -> object, scalar -> value, setof/table -> array.
async function rpc(fn, args) {
    if (!configured()) throw new Error('Supabase not configured');
    var res = await fetch(baseUrl() + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(args || {}),
    });
    var data = await parse(res);
    if (!res.ok) {
        var msg = (data && (data.message || data.error || data.hint)) || ('Supabase RPC ' + fn + ' failed (' + res.status + ')');
        var err = new Error(msg);
        err.status = res.status;
        err.body = data;
        throw err;
    }
    return data;
}

// PostgREST table read. `params` are raw query params, e.g.
// { roblox_user_id: 'eq.123', order: 'created_at.desc', limit: '15', select: '*' }.
async function select(table, params) {
    if (!configured()) throw new Error('Supabase not configured');
    var qs = new URLSearchParams(params || {}).toString();
    var res = await fetch(baseUrl() + '/rest/v1/' + table + (qs ? '?' + qs : ''), {
        method: 'GET',
        headers: headers({ 'Accept': 'application/json' }),
    });
    var data = await parse(res);
    if (!res.ok) {
        var err = new Error('Supabase select ' + table + ' failed (' + res.status + ')');
        err.status = res.status;
        err.body = data;
        throw err;
    }
    return data;
}

module.exports = { configured, rpc, select };
