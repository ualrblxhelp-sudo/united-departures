const { EmbedBuilder } = require('discord.js');
const Attendance = require('../models/Attendance');
const Flight = require('../models/Flight');
const TrainingAttendanceLog = require('../models/TrainingAttendanceLog');
const PersonnelRecord = require('../models/PersonnelRecord');
const points = require('./points');
const bloxlink = require('../services/bloxlink');
const roblox = require('../services/roblox');

var VOLARE_GUILD_ID = '1309560657473179679';
var TIME_ZONE = 'America/New_York';
var MONTHLY_FLIGHT_QUOTA = 7;
var TRAINING_SESSION_PAY = 25;
var FALLBACK_ATTENDANCE_PAY = 10;
var PAYMENT_RESET_INTERVAL_MS = 6 * 60 * 60 * 1000;
var monthlyResetStarted = false;

var ROLE_PAY = {
    'dispatcher': { label: 'Dispatcher', pay: 40 },
    'co-dispatcher': { label: 'Co-Dispatcher', pay: 35 },
    'airport supervisor': { label: 'Airport Supervisor', pay: 10 },
    'customer service supervisor': { label: 'Customer Service Supervisor', pay: 25 },
    'purser': { label: 'Purser', pay: 25 },
    'customer service representative': { label: 'Customer Service Representative', pay: 15 },
    'gate agent': { label: 'Gate Agent', pay: 15 },
    'lounge attendant': { label: 'Lounge Attendant', pay: 15 },
    'flight attendant': { label: 'Flight Attendant', pay: 15 },
    'captain': { label: 'Captain', pay: 15 },
    'first officer': { label: 'First Officer', pay: 15 },
    'fo': { label: 'First Officer', pay: 15 },
    'ramp service agent': { label: 'Ramp Service Agent', pay: 10 },
    'ramp service supervisor': { label: 'Ramp Service Supervisor', pay: 10 },
    'ramp services': { label: 'Ramp Services', pay: 10 },
};

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeFlightCode(value) {
    return String(value || '').trim().toUpperCase();
}

function toInt(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function formatMonthLabel(date) {
    return new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: TIME_ZONE,
    }).format(date);
}

function formatShortDate(date) {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: TIME_ZONE,
    }).format(date);
}

function currentMonthKey(now) {
    var parts = getTimeZoneParts(now || new Date(), TIME_ZONE);
    return String(parts.year) + '-' + String(parts.month).padStart(2, '0');
}

function getTimeZoneParts(date, timeZone) {
    var fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    var parts = fmt.formatToParts(date);
    var out = {};
    for (var i = 0; i < parts.length; i++) {
        if (parts[i].type !== 'literal') out[parts[i].type] = Number(parts[i].value);
    }
    return out;
}

function getTimeZoneOffsetMs(date, timeZone) {
    var fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        timeZoneName: 'shortOffset',
    });
    var parts = fmt.formatToParts(date);
    var zone = 'GMT+0';
    for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'timeZoneName') {
            zone = parts[i].value;
            break;
        }
    }

    var match = zone.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return 0;

    var sign = match[1] === '-' ? -1 : 1;
    var hours = Number(match[2]) || 0;
    var minutes = Number(match[3]) || 0;
    return sign * ((hours * 60) + minutes) * 60 * 1000;
}

function zonedTimeToUtc(year, month, day, hour, minute, second, timeZone) {
    var guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    var offset = getTimeZoneOffsetMs(guess, timeZone);
    var actual = new Date(guess.getTime() - offset);
    var adjusted = getTimeZoneOffsetMs(actual, timeZone);
    if (adjusted !== offset) {
        actual = new Date(guess.getTime() - adjusted);
    }
    return actual;
}

function getCurrentMonthRange(now) {
    var base = now || new Date();
    var parts = getTimeZoneParts(base, TIME_ZONE);
    var start = zonedTimeToUtc(parts.year, parts.month, 1, 0, 0, 0, TIME_ZONE);
    var nextMonth = parts.month === 12 ? 1 : parts.month + 1;
    var nextYear = parts.month === 12 ? parts.year + 1 : parts.year;
    var end = zonedTimeToUtc(nextYear, nextMonth, 1, 0, 0, 0, TIME_ZONE);
    return {
        start: start,
        end: end,
        label: formatMonthLabel(base),
    };
}

async function resetMonthlyPaymentAdjustments() {
    try {
        var monthRange = getCurrentMonthRange(new Date());
        var result = await PersonnelRecord.updateMany(
            { 'paymentAdjustments.0': { $exists: true } },
            { $pull: { paymentAdjustments: { createdAt: { $lt: monthRange.start } } } }
        );
        var changed = Number(result.modifiedCount || 0);
        if (changed > 0) {
            console.log('[PersonnelProfile] Reset old payment adjustments for ' + changed + ' personnel record(s).');
        }
    } catch (err) {
        console.error('[PersonnelProfile] resetMonthlyPaymentAdjustments error:', err);
    }
}

function startMonthlyResetScheduler() {
    if (monthlyResetStarted) return;
    monthlyResetStarted = true;
    resetMonthlyPaymentAdjustments();
    setInterval(resetMonthlyPaymentAdjustments, PAYMENT_RESET_INTERVAL_MS);
    console.log('[PersonnelProfile] Monthly payment reset scheduler started (every 6h).');
}

function buildAttendanceQuery(target, range) {
    var matchers = [];
    if (target.discordId) matchers.push({ 'attendees.discordId': target.discordId });
    if (target.robloxUsername) {
        matchers.push({ 'attendees.username': new RegExp('^' + escapeRegExp(target.robloxUsername) + '$', 'i') });
    }
    if (!matchers.length) return null;

    var query = matchers.length === 1 ? matchers[0] : { $or: matchers };
    if (range) query.createdAt = { $gte: range.start, $lt: range.end };
    return query;
}

function getFlightTime(flight) {
    if (flight && flight.completedAt) return new Date(flight.completedAt).getTime();
    if (flight && flight.startedAt) return new Date(flight.startedAt).getTime();
    if (flight && flight.serverOpenTime) return Number(flight.serverOpenTime) * 1000;
    if (flight && flight.createdAt) return new Date(flight.createdAt).getTime();
    return 0;
}

function routeMatchScore(attendance, flight) {
    if (!attendance || !attendance.route || !flight) return 1;
    var route = String(attendance.route || '').toUpperCase();
    var dep = String(flight.departure || '').toUpperCase();
    var dst = String(flight.destination || '').toUpperCase();
    if (!dep || !dst) return 1;
    return route.indexOf(dep) !== -1 && route.indexOf(dst) !== -1 ? 0 : 1;
}

function pickBestFlight(attendance, candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    var createdAt = new Date(attendance.createdAt).getTime();
    return candidates.slice().sort(function (a, b) {
        var routeScore = routeMatchScore(attendance, a) - routeMatchScore(attendance, b);
        if (routeScore !== 0) return routeScore;
        return Math.abs(getFlightTime(a) - createdAt) - Math.abs(getFlightTime(b) - createdAt);
    })[0];
}

function resolveRolePay(position) {
    var key = normalizeText(position);
    if (ROLE_PAY[key]) return ROLE_PAY[key];
    return {
        label: position || 'Attendance Fallback',
        pay: FALLBACK_ATTENDANCE_PAY,
    };
}

async function fetchMember(guild, userId) {
    if (!guild || !userId) return null;
    try {
        return await guild.members.fetch(String(userId));
    } catch (err) {
        return null;
    }
}

async function fetchUser(client, userId) {
    if (!client || !userId) return null;
    try {
        return await client.users.fetch(String(userId));
    } catch (err) {
        return null;
    }
}

function parseDiscordIdFromQuery(query) {
    var value = String(query || '').trim();
    var mention = value.match(/^<@!?(\d+)>$/);
    if (mention) return mention[1];
    if (/^\d{15,25}$/.test(value)) return value;
    return null;
}

async function hydrateRobloxIdentity(robloxId, fallbackUsername) {
    if (!robloxId) {
        return {
            robloxId: null,
            robloxUsername: fallbackUsername || null,
            robloxDisplayName: null,
            profileUrl: null,
            avatarUrl: null,
        };
    }

    var identity = await roblox.userIdToUsername(robloxId);
    var avatarUrl = await fetchRobloxAvatar(robloxId);
    return {
        robloxId: Number(robloxId),
        robloxUsername: identity && identity.username ? identity.username : (fallbackUsername || null),
        robloxDisplayName: identity && identity.displayName ? identity.displayName : null,
        profileUrl: 'https://www.roblox.com/users/' + Number(robloxId) + '/profile',
        avatarUrl: avatarUrl,
    };
}

async function fetchRobloxAvatar(robloxId) {
    if (!robloxId) return null;
    try {
        var res = await fetch(
            'https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' +
            Number(robloxId) + '&size=180x180&format=Png&isCircular=false'
        );
        if (!res.ok) return null;
        var data = await res.json();
        return data && data.data && data.data[0] ? data.data[0].imageUrl || null : null;
    } catch (err) {
        return null;
    }
}

async function getPersonnelRecord(discordId) {
    if (!discordId) return null;
    return PersonnelRecord.findOne({ discordId: String(discordId) }).catch(function () { return null; });
}

function defaultPositionFromMember(member) {
    if (!member || !member.roles || !member.roles.cache) return 'Unassigned';
    var roles = member.roles.cache
        .filter(function (role) { return role && role.name !== '@everyone'; })
        .sort(function (a, b) { return b.position - a.position; })
        .map(function (role) { return role.name; });
    return roles[0] || 'Unassigned';
}

async function resolveFromDiscord(client, guild, userId) {
    var member = await fetchMember(guild, userId);
    if (!member) {
        return { ok: false, error: 'That user is not a member of United Volare.' };
    }

    var link = null;
    try {
        link = await bloxlink.discordToRoblox(userId);
    } catch (err) {
        link = { configured: true, linked: false };
    }

    var robloxIdentity = await hydrateRobloxIdentity(link && link.linked ? link.robloxId : null, null);
    var user = member.user || await fetchUser(client, userId);

    return {
        ok: true,
        target: {
            discordId: String(userId),
            discordUser: user,
            member: member,
            robloxId: robloxIdentity.robloxId,
            robloxUsername: robloxIdentity.robloxUsername,
            robloxDisplayName: robloxIdentity.robloxDisplayName,
            robloxProfileUrl: robloxIdentity.profileUrl,
            robloxAvatarUrl: robloxIdentity.avatarUrl,
            bloxlinkConfigured: Boolean(link && link.configured),
            bloxlinkLinked: Boolean(link && link.linked && link.robloxId),
        },
    };
}

async function resolveFromRobloxUsername(client, guild, username) {
    var resolved = await roblox.usernameToUserId(username);
    if (!resolved || !resolved.userId) {
        return { ok: false, error: 'I could not find that Roblox username.' };
    }

    var link = null;
    try {
        link = await bloxlink.robloxToDiscord(resolved.userId);
    } catch (err) {
        link = { configured: true, linked: false };
    }

    if (!link || !link.linked || !link.discordId) {
        return { ok: false, error: 'That Roblox account is not linked to a United Volare employee through Bloxlink.' };
    }

    var member = await fetchMember(guild, link.discordId);
    if (!member) {
        return { ok: false, error: 'That Roblox account is linked, but the Discord user is not in United Volare.' };
    }

    var robloxIdentity = await hydrateRobloxIdentity(resolved.userId, resolved.username);
    return {
        ok: true,
        target: {
            discordId: String(link.discordId),
            discordUser: member.user || await fetchUser(client, link.discordId),
            member: member,
            robloxId: robloxIdentity.robloxId,
            robloxUsername: robloxIdentity.robloxUsername,
            robloxDisplayName: robloxIdentity.robloxDisplayName,
            robloxProfileUrl: robloxIdentity.profileUrl,
            robloxAvatarUrl: robloxIdentity.avatarUrl,
            bloxlinkConfigured: Boolean(link.configured),
            bloxlinkLinked: true,
        },
    };
}

async function resolveProfileTarget(client, guild, options, fallbackUserId) {
    var user = options && options.user ? options.user : null;
    var query = options && options.query ? String(options.query).trim() : '';

    if (user) return resolveFromDiscord(client, guild, user.id);

    if (query) {
        var discordId = parseDiscordIdFromQuery(query);
        if (discordId) {
            var discordResult = await resolveFromDiscord(client, guild, discordId);
            if (discordResult.ok) return discordResult;
        }
        return resolveFromRobloxUsername(client, guild, query);
    }

    return resolveFromDiscord(client, guild, fallbackUserId);
}

async function loadMatchedFlights(attendanceRecords) {
    var codes = [];
    var seen = {};
    for (var i = 0; i < attendanceRecords.length; i++) {
        var code = normalizeFlightCode(attendanceRecords[i].flightCode);
        if (!code || seen[code]) continue;
        seen[code] = true;
        codes.push(code);
    }

    if (!codes.length) return {};

    var flights = await Flight.find({ flightNumber: { $in: codes } }).lean().catch(function () { return []; });
    var byCode = {};
    for (var j = 0; j < flights.length; j++) {
        var key = normalizeFlightCode(flights[j].flightNumber);
        if (!byCode[key]) byCode[key] = [];
        byCode[key].push(flights[j]);
    }
    return byCode;
}

function buildFlightPayout(attendance, flight, target) {
    if (flight && target.discordId && String(flight.dispatcherId) === String(target.discordId)) {
        return { role: 'Dispatcher', pay: 40 };
    }

    if (flight && Array.isArray(flight.allocations) && target.discordId) {
        var alloc = flight.allocations.find(function (item) {
            return String(item.userId) === String(target.discordId);
        });
        if (alloc) {
            var mapped = resolveRolePay(alloc.position);
            return { role: mapped.label, pay: mapped.pay };
        }
    }

    return { role: 'Attendance Fallback', pay: FALLBACK_ATTENDANCE_PAY };
}

function buildFlightBreakdown(attendanceRecords, flightsByCode, target) {
    var rows = [];
    var total = 0;

    for (var i = 0; i < attendanceRecords.length; i++) {
        var attendance = attendanceRecords[i];
        var code = normalizeFlightCode(attendance.flightCode) || 'Unknown Flight';
        var flight = pickBestFlight(attendance, flightsByCode[code] || []);
        var payout = buildFlightPayout(attendance, flight, target);
        total += payout.pay;
        rows.push({
            date: attendance.createdAt,
            flightCode: code,
            role: payout.role,
            pay: payout.pay,
        });
    }

    rows.sort(function (a, b) {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    return {
        total: total,
        rows: rows,
    };
}

function buildTrainingBreakdown(trainingLogs) {
    var rows = trainingLogs.map(function (log) {
        return {
            date: log.createdAt,
            trainingType: String(log.trainingType || '').replace(/-/g, ' '),
            pay: TRAINING_SESSION_PAY,
        };
    }).sort(function (a, b) {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    return {
        total: rows.length * TRAINING_SESSION_PAY,
        rows: rows,
    };
}

function formatFlightLines(rows, limit) {
    var max = limit || 8;
    if (!rows.length) return 'No paid flight attendance logged this month.';

    var lines = [];
    for (var i = 0; i < rows.length && i < max; i++) {
        lines.push('\u2022 ' + rows[i].flightCode + ' — ' + rows[i].role + ' — ' + rows[i].pay + ' R$');
    }
    if (rows.length > max) lines.push('\u2026and ' + (rows.length - max) + ' more.');
    return lines.join('\n');
}

function titleCaseWords(value) {
    return String(value || '').split(/\s+/).map(function (part) {
        return part ? part.charAt(0).toUpperCase() + part.slice(1) : part;
    }).join(' ');
}

function formatTrainingLines(rows, limit) {
    var max = limit || 8;
    if (!rows.length) return 'No trainer attendance logs this month.';

    var lines = [];
    for (var i = 0; i < rows.length && i < max; i++) {
        lines.push('\u2022 ' + formatShortDate(rows[i].date) + ' — ' + titleCaseWords(rows[i].trainingType) + ' — ' + rows[i].pay + ' R$');
    }
    if (rows.length > max) lines.push('\u2026and ' + (rows.length - max) + ' more.');
    return lines.join('\n');
}

async function buildPersonnelProfile(target) {
    var monthRange = getCurrentMonthRange(new Date());
    var attendanceQuery = buildAttendanceQuery(target, monthRange);
    var totalAttendanceQuery = buildAttendanceQuery(target, null);

    var monthAttendance = attendanceQuery
        ? await Attendance.find(attendanceQuery).sort({ createdAt: -1 }).lean().catch(function () { return []; })
        : [];
    var totalFlightsAttended = totalAttendanceQuery
        ? await Attendance.countDocuments(totalAttendanceQuery).catch(function () { return 0; })
        : 0;

    var flightsByCode = await loadMatchedFlights(monthAttendance);
    var flightWage = buildFlightBreakdown(monthAttendance, flightsByCode, target);

    var trainingLogs = target.discordId
        ? await TrainingAttendanceLog.find({
            hostId: target.discordId,
            createdAt: { $gte: monthRange.start, $lt: monthRange.end },
        }).sort({ createdAt: -1 }).lean().catch(function () { return []; })
        : [];
    var trainingWage = buildTrainingBreakdown(trainingLogs);

    var pointCount = target.discordId ? await points.getActiveCount(target.discordId).catch(function () { return null; }) : null;
    var personnelRecord = await getPersonnelRecord(target.discordId);
    var monthKey = currentMonthKey(new Date());
    var manualPaymentAdjustments = [];
    if (personnelRecord && Array.isArray(personnelRecord.paymentAdjustments)) {
        manualPaymentAdjustments = personnelRecord.paymentAdjustments.filter(function (entry) {
            return currentMonthKey(entry.createdAt) === monthKey;
        });
    }
    var manualPaymentTotal = manualPaymentAdjustments.reduce(function (sum, entry) {
        return sum + (Number(entry.amount) || 0);
    }, 0);
    var flightsThisMonth = monthAttendance.length;

    return {
        monthLabel: monthRange.label,
        quota: MONTHLY_FLIGHT_QUOTA,
        flightsThisMonth: flightsThisMonth,
        totalFlightsAttended: totalFlightsAttended,
        activePoints: pointCount,
        monthlyWage: flightWage.total + trainingWage.total + manualPaymentTotal,
        flightWage: flightWage,
        trainingWage: trainingWage,
        manualPaymentTotal: manualPaymentTotal,
        position: personnelRecord && personnelRecord.positionOverride
            ? personnelRecord.positionOverride
            : defaultPositionFromMember(target.member),
        recentActions: personnelRecord && Array.isArray(personnelRecord.actions)
            ? personnelRecord.actions.slice(-5).reverse()
            : [],
        roblox: {
            id: target.robloxId,
            username: target.robloxUsername,
            displayName: target.robloxDisplayName,
            profileUrl: target.robloxProfileUrl,
            avatarUrl: target.robloxAvatarUrl,
            linked: target.bloxlinkLinked,
            configured: target.bloxlinkConfigured,
        },
        discord: {
            id: target.discordId,
            mention: target.discordId ? '<@' + target.discordId + '>' : 'Unlinked',
            username: target.discordUser ? target.discordUser.username : null,
            displayName: target.member ? target.member.displayName : null,
        },
        flightLines: formatFlightLines(flightWage.rows, 8),
        trainingLines: formatTrainingLines(trainingWage.rows, 8),
    };
}

function buildIdentityValue(profile) {
    var lines = [];
    if (profile.roblox.displayName) lines.push('**Display Name:** ' + profile.roblox.displayName);
    lines.push('**Username:** ' + (profile.roblox.username || 'Unavailable'));
    lines.push('**User ID:** ' + (profile.roblox.id || 'Unavailable'));
    if (profile.roblox.profileUrl) lines.push('**Profile:** ' + profile.roblox.profileUrl);
    if (!profile.roblox.linked) lines.push('**Bloxlink:** Not linked');
    return lines.join('\n');
}

function buildPerformanceValue(profile) {
    var pointsLabel = typeof profile.activePoints === 'number'
        ? profile.activePoints + ' / 9'
        : 'Unavailable';

    return [
        '**Position:** ' + (profile.position || 'Unassigned'),
        '**Monthly wage:** ' + profile.monthlyWage + ' R$',
        '**Flights attended:** ' + profile.flightsThisMonth + ' / ' + profile.quota,
        '**Flights attended total:** ' + profile.totalFlightsAttended,
        '**Training sessions hosted:** ' + profile.trainingWage.rows.length,
        '**Active points:** ' + pointsLabel,
    ].join('\n');
}

function buildRecentActionsValue(profile) {
    if (!profile.recentActions || !profile.recentActions.length) return 'No HR actions logged.';
    return profile.recentActions.map(function (entry) {
        var bits = ['• ' + String(entry.type || '').replace(/_/g, ' ')];
        if (entry.durationDays) bits.push('(' + entry.durationDays + 'd)');
        if (entry.reason) bits.push('— ' + entry.reason);
        return bits.join(' ');
    }).join('\n');
}

function buildProfileEmbed(profile, options) {
    options = options || {};
    var displayName = profile.discord.displayName || profile.discord.username || profile.roblox.username || 'Unknown Employee';

    var embed = new EmbedBuilder()
        .setTitle(options.title || 'United Volare Personnel Profile')
        .setColor(options.color || 0x080C96)
        .setDescription(
            profile.discord.mention + '\n' +
            '**Month:** ' + profile.monthLabel + '\n' +
            '**Discord:** ' + (profile.discord.username || 'Unavailable')
        )
        .addFields(
            { name: 'Roblox Identity', value: buildIdentityValue(profile), inline: true },
            { name: 'Performance', value: buildPerformanceValue(profile), inline: true },
            {
                name: 'Wage Breakdown',
                value:
                    '**Flight pay:** ' + profile.flightWage.total + ' R$\n' +
                    '**Training pay:** ' + profile.trainingWage.total + ' R$\n' +
                    '**Manual adjustments:** ' + profile.manualPaymentTotal + ' R$\n' +
                    '**Total:** ' + profile.monthlyWage + ' R$',
                inline: false,
            },
            { name: 'Flight Pay Details', value: profile.flightLines, inline: false },
            { name: 'Training Pay Details', value: profile.trainingLines, inline: false },
            { name: 'Recent HR Actions', value: buildRecentActionsValue(profile), inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'United Volare • ' + displayName });

    if (profile.roblox.avatarUrl) embed.setThumbnail(profile.roblox.avatarUrl);
    return embed;
}

async function appendPersonnelAction(discordId, payload) {
    if (!discordId) return null;
    var record = await PersonnelRecord.findOne({ discordId: String(discordId) });
    if (!record) record = new PersonnelRecord({ discordId: String(discordId) });
    record.actions.push({
        type: payload.type,
        reason: payload.reason || '',
        issuedBy: payload.issuedBy || null,
        issuedByUsername: payload.issuedByUsername || '',
        durationDays: payload.durationDays == null ? null : Number(payload.durationDays),
        meta: payload.meta || '',
    });
    await record.save();
    return record;
}

async function addPaymentAdjustment(discordId, payload) {
    if (!discordId) return null;
    var record = await PersonnelRecord.findOne({ discordId: String(discordId) });
    if (!record) record = new PersonnelRecord({ discordId: String(discordId) });
    record.paymentAdjustments.push({
        amount: Number(payload.amount) || 0,
        reason: payload.reason || '',
        editedBy: payload.editedBy || null,
        editedByUsername: payload.editedByUsername || '',
    });
    record.actions.push({
        type: 'payment_edit',
        reason: payload.reason || '',
        issuedBy: payload.editedBy || null,
        issuedByUsername: payload.editedByUsername || '',
        meta: 'adjustment=' + (Number(payload.amount) || 0),
    });
    await record.save();
    return record;
}

async function setPositionOverride(discordId, payload) {
    if (!discordId) return null;
    var record = await PersonnelRecord.findOne({ discordId: String(discordId) });
    if (!record) record = new PersonnelRecord({ discordId: String(discordId) });
    record.positionOverride = payload.position || '';
    record.actions.push({
        type: 'position_edit',
        reason: payload.reason || '',
        issuedBy: payload.editedBy || null,
        issuedByUsername: payload.editedByUsername || '',
        meta: 'position=' + (payload.position || ''),
    });
    await record.save();
    return record;
}

module.exports = {
    VOLARE_GUILD_ID: VOLARE_GUILD_ID,
    MONTHLY_FLIGHT_QUOTA: MONTHLY_FLIGHT_QUOTA,
    resolveProfileTarget: resolveProfileTarget,
    buildPersonnelProfile: buildPersonnelProfile,
    buildProfileEmbed: buildProfileEmbed,
    appendPersonnelAction: appendPersonnelAction,
    addPaymentAdjustment: addPaymentAdjustment,
    setPositionOverride: setPositionOverride,
    resetMonthlyPaymentAdjustments: resetMonthlyPaymentAdjustments,
    startMonthlyResetScheduler: startMonthlyResetScheduler,
};
