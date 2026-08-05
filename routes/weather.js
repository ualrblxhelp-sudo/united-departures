'use strict';

/**
 * United Departures - Live Weather API
 *
 * GET /api/weather?station=EWR
 * GET /api/weather?station=KEWR
 * GET /api/weather?station=EWR,DEN,ORD      (batch, comma separated, max 6)
 *
 * Primary source : aviationweather.gov METAR (real airport observations)
 * Fallback       : open-meteo.com current conditions (any lat/lon)
 * Timezone       : open-meteo (always fetched, drives Roblox ClockTime)
 *
 * Responses are cached in-process so N Roblox servers polling the same
 * airport produce at most one upstream call per CACHE_TTL_MS.
 *
 * Mount in index.js:
 *     app.use('/api/weather', require('./routes/weather'));
 */

const express = require('express');
const router = express.Router();

const CACHE_TTL_MS = 5 * 60 * 1000;      // 5 minutes
const COORD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // airport coords basically never move
const FETCH_TIMEOUT_MS = 8000;
const MAX_BATCH = 6;

const AWC_BASE = 'https://aviationweather.gov/api/data';
const OM_BASE = 'https://api.open-meteo.com/v1/forecast';

/* ------------------------------------------------------------------ *
 * IATA -> ICAO
 * The K + IATA rule covers the contiguous US. Everything that breaks
 * that rule and shows up on a United route map is listed explicitly.
 * ------------------------------------------------------------------ */
const ICAO_OVERRIDES = {
  // Alaska / Hawaii / territories
  ANC: 'PANC', FAI: 'PAFA', JNU: 'PAJN', HNL: 'PHNL', OGG: 'PHOG',
  KOA: 'PHKO', LIH: 'PHLI', ITO: 'PHTO', GUM: 'PGUM', SJU: 'TJSJ',
  STT: 'TIST', STX: 'TISX',
  // Canada
  YYZ: 'CYYZ', YVR: 'CYVR', YUL: 'CYUL', YYC: 'CYYC', YOW: 'CYOW',
  YEG: 'CYEG', YHZ: 'CYHZ', YWG: 'CYWG',
  // Mexico / Central America / Caribbean
  MEX: 'MMMX', CUN: 'MMUN', GDL: 'MMGL', SJD: 'MMSD', PVR: 'MMPR',
  MTY: 'MMMY', SJO: 'MROC', LIR: 'MRLB', PTY: 'MPTO', GUA: 'MGGT',
  SAL: 'MSLP', BZE: 'MZBZ', RTB: 'MHRO', SAP: 'MHLM', TGU: 'MHTG',
  NAS: 'MYNN', MBJ: 'MKJS', KIN: 'MKJP', PUJ: 'MDPC', SDQ: 'MDSD',
  AUA: 'TNCA', CUR: 'TNCC', SXM: 'TNCM', BGI: 'TBPB', ANU: 'TAPA',
  UVF: 'TLPL', POS: 'TTPP', GCM: 'MWCR', PLS: 'MBPV',
  // South America
  GRU: 'SBGR', GIG: 'SBGL', EZE: 'SAEZ', SCL: 'SCEL', LIM: 'SPJC',
  BOG: 'SKBO', UIO: 'SEQM', GYE: 'SEGU', MVD: 'SUMU', CCS: 'SVMI',
  // Europe
  LHR: 'EGLL', LGW: 'EGKK', EDI: 'EGPH', DUB: 'EIDW', SNN: 'EINN',
  CDG: 'LFPG', NCE: 'LFMN', FRA: 'EDDF', MUC: 'EDDM', BER: 'EDDB',
  AMS: 'EHAM', BRU: 'EBBR', ZRH: 'LSZH', GVA: 'LSGG', VIE: 'LOWW',
  FCO: 'LIRF', MXP: 'LIMC', VCE: 'LIPZ', NAP: 'LIRN', PMO: 'LICJ',
  BCN: 'LEBL', MAD: 'LEMD', PMI: 'LEPA', TFS: 'GCTS', LIS: 'LPPT',
  OPO: 'LPPR', FNC: 'LPMA', ATH: 'LGAV', CPH: 'EKCH', ARN: 'ESSA',
  OSL: 'ENGM', HEL: 'EFHK', KEF: 'BIKF', PRG: 'LKPR', BUD: 'LHBP',
  WAW: 'EPWA', IST: 'LTFM', TLV: 'LLBG', AZI: 'OMAD',
  // Africa / Middle East / Asia / Pacific
  CPT: 'FACT', JNB: 'FAOR', LOS: 'DNMM', ACC: 'DGAA', MRU: 'FIMP',
  CAI: 'HECA', RAK: 'GMMX', CMN: 'GMMN', DXB: 'OMDB', AUH: 'OMAA',
  DOH: 'OTHH', AMM: 'OJAI', RUH: 'OERK', BOM: 'VABB', DEL: 'VIDP',
  BLR: 'VOBL', HYD: 'VOHS', MAA: 'VOMM', CCU: 'VECC', CMB: 'VCBI',
  NRT: 'RJAA', HND: 'RJTT', KIX: 'RJBB', NGO: 'RJGG', ICN: 'RKSI',
  PVG: 'ZSPD', PEK: 'ZBAA', PKX: 'ZBAD', CAN: 'ZGGG', HKG: 'VHHH',
  TPE: 'RCTP', MNL: 'RPLL', CEB: 'RPVM', SIN: 'WSSS', KUL: 'WMKK',
  BKK: 'VTBS', HKT: 'VTSP', SGN: 'VVTS', HAN: 'VVNB', DPS: 'WADD',
  CGK: 'WIII', PNH: 'VDPP', SYD: 'YSSY', MEL: 'YMML', BNE: 'YBBN',
  PER: 'YPPH', AKL: 'NZAA', CHC: 'NZCH', NAN: 'NFFN', PPT: 'NTAA',
  HNM: 'PHMU', SPN: 'PGSN', KOJ: 'RJFK'
};

function toIcao(raw) {
  const id = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!id) return null;
  if (id.length === 4) return id;                 // already ICAO
  if (id.length !== 3) return null;
  if (ICAO_OVERRIDES[id]) return ICAO_OVERRIDES[id];
  return 'K' + id;                                // contiguous US default
}

/* ------------------------------------------------------------------ *
 * Cache
 * ------------------------------------------------------------------ */
const wxCache = new Map();     // icao -> { at, payload }
const coordCache = new Map();  // icao -> { at, lat, lon, name }

function cacheGet(map, key, ttl) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) { map.delete(key); return null; }
  return hit;
}

/* ------------------------------------------------------------------ *
 * HTTP helper
 * ------------------------------------------------------------------ */
async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'UnitedDepartures/1.0 (Roblox weather sync)' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Airport coordinates (needed for timezone + Open-Meteo fallback)
 * ------------------------------------------------------------------ */
async function getCoords(icao) {
  const hit = cacheGet(coordCache, icao, COORD_TTL_MS);
  if (hit) return hit;

  const data = await getJson(
    AWC_BASE + '/airport?ids=' + encodeURIComponent(icao) + '&format=json'
  );
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || row.lat == null || row.lon == null) {
    throw new Error('No coordinates for ' + icao);
  }
  const entry = {
    at: Date.now(),
    lat: Number(row.lat),
    lon: Number(row.lon),
    name: row.name || row.site || icao,
    elevM: row.elev != null ? Number(row.elev) : 0
  };
  coordCache.set(icao, entry);
  return entry;
}

/* ------------------------------------------------------------------ *
 * Open-Meteo (timezone always, weather when METAR is unusable)
 * ------------------------------------------------------------------ */
async function getOpenMeteo(lat, lon) {
  const url = OM_BASE
    + '?latitude=' + lat.toFixed(4)
    + '&longitude=' + lon.toFixed(4)
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,'
    + 'is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,'
    + 'pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility'
    + '&wind_speed_unit=kn&temperature_unit=celsius&timezone=auto';
  return getJson(url);
}

/* ------------------------------------------------------------------ *
 * METAR
 * ------------------------------------------------------------------ */
async function getMetar(icao) {
  const data = await getJson(
    AWC_BASE + '/metar?ids=' + encodeURIComponent(icao)
    + '&format=json&taf=false&hours=3'
  );
  if (!Array.isArray(data) || data.length === 0) return null;
  // Newest observation first
  data.sort((a, b) => (b.obsTime || 0) - (a.obsTime || 0));
  return data[0];
}

const COVER_FRACTION = {
  SKC: 0, CLR: 0, CAVOK: 0, NCD: 0, NSC: 0,
  FEW: 0.20, SCT: 0.45, BKN: 0.75, OVC: 1.0, OVX: 1.0, VV: 1.0
};

function parseVisibility(v) {
  // AWC returns a number, or strings like "10+" / "1 1/2"
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s.endsWith('+')) return parseFloat(s) || 10;
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn a METAR wxString into a precipitation descriptor.
 * Intensity: - light (0.35), none light/moderate (0.65), + heavy (1.0)
 */
function parseWeatherString(wx) {
  const out = { type: 'none', intensity: 0, thunder: false, fog: false };
  if (!wx) return out;
  const s = String(wx).toUpperCase();

  out.thunder = s.includes('TS');
  out.fog = /\b(FG|BR|BCFG|MIFG|FU|HZ)\b/.test(s);

  let intensity = 0.65;
  if (s.includes('+')) intensity = 1.0;
  else if (s.includes('-')) intensity = 0.35;

  if (/SN|SG|IC|PL/.test(s)) out.type = 'snow';
  else if (/GR|GS/.test(s)) out.type = 'hail';
  else if (/RA|DZ|UP/.test(s)) out.type = 'rain';
  else if (out.thunder) out.type = 'rain';

  out.intensity = out.type === 'none' ? 0 : intensity;
  if (out.thunder) out.intensity = Math.max(out.intensity, 0.7);
  return out;
}

/* Open-Meteo WMO code -> precip descriptor */
function fromWmoCode(code, precipMm, snowCm) {
  const c = Number(code);
  const out = { type: 'none', intensity: 0, thunder: false, fog: false };
  if (c === 45 || c === 48) { out.fog = true; return out; }
  if (c >= 95) { out.type = 'rain'; out.thunder = true; out.intensity = 0.85; return out; }
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) {
    out.type = 'snow';
    out.intensity = Math.min(1, Math.max(0.3, (Number(snowCm) || 0.3) / 2));
    return out;
  }
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) {
    out.type = 'rain';
    out.intensity = Math.min(1, Math.max(0.3, (Number(precipMm) || 0.3) / 4));
    return out;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Normalizer - the single shape Roblox consumes
 * ------------------------------------------------------------------ */
function buildPayload(icao, iata, coords, metar, om) {
  const omc = (om && om.current) || {};
  // If Open-Meteo is down we still need a plausible local clock, so fall back
  // to a solar estimate from longitude (15 degrees per hour).
  const offsetSeconds = (om && Number.isFinite(Number(om.utc_offset_seconds)))
    ? Number(om.utc_offset_seconds)
    : Math.round(coords.lon / 15) * 3600;

  // Local wall-clock time at the airport, as a 0-24 float for Lighting.ClockTime
  const nowLocalMs = Date.now() + offsetSeconds * 1000;
  const d = new Date(nowLocalMs);
  const clockTime =
    d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;

  const useMetar = !!metar && metar.temp != null;

  let cloudLayers = [];
  let cloudCover = 0;
  let visibilityMiles = null;
  let precip;
  let temperatureC, dewpointC, windDirDeg, windKts, gustKts, pressureHpa;

  if (useMetar) {
    const clouds = Array.isArray(metar.clouds) ? metar.clouds : [];
    cloudLayers = clouds
      .filter((l) => l && l.cover)
      .map((l) => ({
        cover: String(l.cover).toUpperCase(),
        baseFt: l.base != null ? Number(l.base) : null,
        fraction: COVER_FRACTION[String(l.cover).toUpperCase()] ?? 0
      }));
    cloudCover = cloudLayers.reduce((m, l) => Math.max(m, l.fraction), 0);

    visibilityMiles = parseVisibility(metar.visib);
    precip = parseWeatherString(metar.wxString);

    temperatureC = metar.temp != null ? Number(metar.temp) : null;
    dewpointC = metar.dewp != null ? Number(metar.dewp) : null;
    windDirDeg = metar.wdir === 'VRB' ? -1 : (metar.wdir != null ? Number(metar.wdir) : null);
    windKts = metar.wspd != null ? Number(metar.wspd) : null;
    gustKts = metar.wgst != null ? Number(metar.wgst) : null;
    pressureHpa = metar.altim != null ? Number(metar.altim) : null;
  } else {
    cloudCover = omc.cloud_cover != null ? Number(omc.cloud_cover) / 100 : 0;
    cloudLayers = cloudCover > 0
      ? [{ cover: cloudCover > 0.85 ? 'OVC' : cloudCover > 0.6 ? 'BKN'
             : cloudCover > 0.3 ? 'SCT' : 'FEW',
           baseFt: 4000, fraction: cloudCover }]
      : [];
    visibilityMiles = omc.visibility != null
      ? Number(omc.visibility) / 1609.34
      : null;
    precip = fromWmoCode(omc.weather_code, omc.precipitation, omc.snowfall);
    temperatureC = omc.temperature_2m != null ? Number(omc.temperature_2m) : null;
    dewpointC = null;
    windDirDeg = omc.wind_direction_10m != null ? Number(omc.wind_direction_10m) : null;
    windKts = omc.wind_speed_10m != null ? Number(omc.wind_speed_10m) : null;
    gustKts = omc.wind_gusts_10m != null ? Number(omc.wind_gusts_10m) : null;
    pressureHpa = omc.pressure_msl != null ? Number(omc.pressure_msl) : null;
  }

  if (visibilityMiles == null) visibilityMiles = 10;
  visibilityMiles = Math.max(0.05, Math.min(10, visibilityMiles));

  return {
    ok: true,
    icao,
    iata: iata || null,
    station: coords.name,
    source: useMetar ? 'metar' : 'open-meteo',
    fetchedAt: new Date().toISOString(),
    observedAt: useMetar && metar.obsTime
      ? new Date(Number(metar.obsTime) * 1000).toISOString()
      : new Date().toISOString(),
    lat: coords.lat,
    lon: coords.lon,
    elevationM: coords.elevM,

    utcOffsetSeconds: offsetSeconds,
    localClockTime: Number(clockTime.toFixed(4)),
    isDay: omc.is_day != null ? !!omc.is_day : null,

    temperatureC,
    dewpointC,
    windDirDeg,
    windKts,
    gustKts,
    pressureHpa,
    visibilityMiles: Number(visibilityMiles.toFixed(2)),

    cloudCover: Number(cloudCover.toFixed(3)),
    cloudBaseFt: cloudLayers.length && cloudLayers[0].baseFt != null
      ? cloudLayers[0].baseFt : null,
    cloudLayers,

    precipType: precip.type,
    precipIntensity: Number(precip.intensity.toFixed(2)),
    thunder: !!precip.thunder,
    fog: !!precip.fog,

    rawMetar: useMetar ? (metar.rawOb || null) : null
  };
}

/* ------------------------------------------------------------------ *
 * Resolver with cache
 * ------------------------------------------------------------------ */
async function resolveStation(rawId) {
  const icao = toIcao(rawId);
  if (!icao) throw new Error('Invalid station identifier: ' + rawId);
  const iata = String(rawId).trim().toUpperCase().length === 3
    ? String(rawId).trim().toUpperCase()
    : null;

  const cached = cacheGet(wxCache, icao, CACHE_TTL_MS);
  if (cached) return cached.payload;

  // METAR rows already embed lat/lon/elev/name, so on the normal path this
  // saves us the separate airport lookup entirely.
  let metar = null;
  try {
    metar = await getMetar(icao);
  } catch (err) {
    console.warn('[weather] METAR failed for ' + icao + ': ' + err.message);
  }

  let coords;
  if (metar && metar.lat != null && metar.lon != null) {
    coords = {
      lat: Number(metar.lat),
      lon: Number(metar.lon),
      name: metar.name || icao,
      elevM: metar.elev != null ? Number(metar.elev) : 0
    };
    coordCache.set(icao, Object.assign({ at: Date.now() }, coords));
  } else {
    coords = cacheGet(coordCache, icao, COORD_TTL_MS) || (await getCoords(icao));
  }

  let om = null;
  try {
    om = await getOpenMeteo(coords.lat, coords.lon);
  } catch (err) {
    console.warn('[weather] Open-Meteo failed for ' + icao + ': ' + err.message);
  }

  if (!metar && !om) throw new Error('Both weather sources failed for ' + icao);

  const payload = buildPayload(icao, iata, coords, metar, om);
  wxCache.set(icao, { at: Date.now(), payload });
  return payload;
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */
router.get('/', async (req, res) => {
  const raw = String(req.query.station || req.query.icao || req.query.iata || '').trim();
  if (!raw) {
    return res.status(400).json({ ok: false, error: 'Missing ?station= parameter' });
  }

  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_BATCH);

  try {
    if (ids.length === 1) {
      const payload = await resolveStation(ids[0]);
      res.set('Cache-Control', 'public, max-age=60');
      return res.json(payload);
    }

    const results = await Promise.all(ids.map(async (id) => {
      try {
        return await resolveStation(id);
      } catch (err) {
        return { ok: false, station: id, error: err.message };
      }
    }));

    const map = {};
    for (const r of results) map[r.iata || r.icao || r.station] = r;
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ ok: true, stations: map });
  } catch (err) {
    console.error('[weather] ' + err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    cachedStations: wxCache.size,
    cachedCoords: coordCache.size,
    ttlMs: CACHE_TTL_MS
  });
});

module.exports = router;
