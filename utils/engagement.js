// utils/engagement.js
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');

const PRAssignment = require('../models/PRAssignment');
const WeeklyRotation = require('../models/WeeklyRotation');
const LeaveOfAbsence = require('../models/LeaveOfAbsence');
const points = require('./points');

// ---- Configuration ----
var MAIN_GUILD_ID = '1007704123312967760';
var VOLARE_GUILD_ID = '1309560657473179679';
var HEMISPHERES_CHANNEL_ID = '1406863436746461235';
var PR_ROLE_ID = '1345906382536441958';

var EMBED_COLOR = 0x080C96;

var ACCEPT_EMOJI = { id: '1397829338367393853', name: 'e_accept' };
var DECLINE_EMOJI = { id: '1397829342079483904', name: 'e_decline' };
var ACCEPT_MARKUP = '<:e_accept:1397829338367393853>';
var DECLINE_MARKUP = '<:e_decline:1397829342079483904>';
var MAIL_MARKUP = '<:e_mail:1397829550716616715>';
var ARROW_MARKUP = '<:e_arrow:1406847964655259710>';
var POLARIS_MARKUP = '<:UnitedPolaris:1298320157424488479>';
var STARALLIANCE_MARKUP = '<:d_staralliance:1397830727919337493>';

var THEMES = {
    0: 'Sunday Song of the Week',
    1: 'Monday Question of the Day',
    2: 'Tuesday Question of the Day',
    3: 'Wednesday Question of the Day',
    4: 'Thursday Question of the Day',
    5: "Friday's Fun Fact",
    6: "Saturday's Question of the Day",
};

var FOOTER_TAGLINES =
    POLARIS_MARKUP + ' \u0262\u1D0F\u1D0F\u1D05 \u029F\u1D07\u1D00\u1D05\ua731 \u1D1B\u029C\u1D07 \u1D21\u1D00\u028F\n' +
    STARALLIANCE_MARKUP + ' \u1D00 \ua731\u1D1B\u1D00\u0280 \u1D00\u029F\u029F\u026A\u1D00\u0274\u1D04\u1D07 \u1D0D\u1D07\u1D0D\u0299\u1D07\u0280';

// ---- Time helpers (all Central / America/Chicago) ----
function centralParts(date) {
    var fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, weekday: 'short',
    });
    var parts = fmt.formatToParts(date);
    var obj = {};
    for (var i = 0; i < parts.length; i++) {
        if (parts[i].type !== 'literal') obj[parts[i].type] = parts[i].value;
    }
    if (obj.hour === '24') obj.hour = '00';
    return obj;
}

function centralDateString(date) {
    var c = centralParts(date);
    return c.year + '-' + c.month + '-' + c.day;
}

function centralDayOfWeek(date) {
    var c = centralParts(date);
    var map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[c.weekday];
}

function centralWeekStartString(date) {
    // Most recent Sunday in Central time, as YYYY-MM-DD
    var dow = centralDayOfWeek(date);
    var back = new Date(date.getTime() - dow * 24 * 60 * 60 * 1000);
    return centralDateString(back);
}

function addDaysToYMD(ymd, days) {
    var parts = ymd.split('-');
    var base = Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    var shifted = new Date(base + days * 24 * 60 * 60 * 1000);
    var y = shifted.getUTCFullYear();
    var m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    var d = String(shifted.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
}

function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
}

// ---- Leave checking ----
async function isOnApprovedLeave(userId, date) {
    var leave = await LeaveOfAbsence.findOne({
        userId: userId,
        startDate: { $lte: date },
        endDate: { $gte: date },
    });
    return !!leave;
}

// ---- PR member fetching ----
// Fetches member IDs that have the PR role.
// Requires GUILD_MEMBERS privileged intent — both `guild.members.fetch()` and the
// REST `members.list()` endpoint won't return data without it.
// We fetch all members ONCE per call (no `userIds` arg) with a hard timeout so
// a hung request can never block the assignment flow indefinitely.
async function fetchPRRoleMemberIds(client) {
    var guild;
    try {
        guild = await client.guilds.fetch(VOLARE_GUILD_ID);
    } catch (err) {
        console.error('[PR] Failed to fetch Volare guild:', err);
        return [];
    }
    var role = guild.roles.cache.get(PR_ROLE_ID) || await guild.roles.fetch(PR_ROLE_ID).catch(function() { return null; });
    if (!role) {
        console.error('[PR] PR role not found');
        return [];
    }

    // If the role's member cache has anyone in it, use that — avoids a network round trip.
    var cached = role.members.map(function(m) { return m.id; });
    if (cached.length > 0) return cached;

    // Cache miss. Fetch all members with a 30-second timeout.
    // If this call hangs, it means the bot is missing the GuildMembers intent —
    // either in the Discord developer portal or in the Client constructor.
    try {
        var fetchPromise = guild.members.fetch();
        var timeoutPromise = new Promise(function(_, reject) {
            setTimeout(function() {
                reject(new Error('members.fetch timed out after 30s — is the GuildMembers privileged intent enabled?'));
            }, 30 * 1000);
        });
        await Promise.race([fetchPromise, timeoutPromise]);
    } catch (err) {
        console.error('[PR] members.fetch error:', err.message);
        return [];
    }

    return role.members.map(function(m) { return m.id; });
}

async function getActivePRMemberIds(client, date, excludeIds) {
    excludeIds = excludeIds || [];
    var all = await fetchPRRoleMemberIds(client);
    var active = [];
    for (var i = 0; i < all.length; i++) {
        if (excludeIds.indexOf(all[i]) !== -1) continue;
        if (await isOnApprovedLeave(all[i], date)) continue;
        active.push(all[i]);
    }
    return active;
}

async function getAllPRMemberIds(client) {
    return await fetchPRRoleMemberIds(client);
}

// ---- Weekly rotation ----

// Build a 7-slot rotation that:
//  - distributes 7 days as evenly as possible across N members
//  - gives the "extras" (7 mod N) to members with the fewest prior-week assignments
//  - avoids back-to-back same-member days when the team has 3+ members
function buildBalancedSchedule(memberIds, priorCounts) {
    var N = memberIds.length;
    if (N === 0) return [];

    // Sort members by prior-week count ascending (least-used first), with random tiebreak
    var sorted = memberIds.slice();
    var withCounts = sorted.map(function(id) {
        return { id: id, prior: priorCounts[id] || 0, jitter: Math.random() };
    });
    withCounts.sort(function(a, b) {
        if (a.prior !== b.prior) return a.prior - b.prior;
        return a.jitter - b.jitter;
    });

    // Compute per-member quotas
    var base = Math.floor(7 / N);
    var extras = 7 % N;
    var quotas = {};
    for (var i = 0; i < withCounts.length; i++) {
        quotas[withCounts[i].id] = base + (i < extras ? 1 : 0);
    }

    // Greedy day-by-day assignment: at each step, pick the member with the highest
    // remaining quota who is NOT the same as yesterday's pick (when team has 3+ members).
    var schedule = []; // array of userIds, length 7
    var prev = null;
    for (var day = 0; day < 7; day++) {
        // Build candidate list: anyone with quota left
        var candidates = [];
        for (var k = 0; k < memberIds.length; k++) {
            var id = memberIds[k];
            if (quotas[id] > 0) candidates.push(id);
        }
        if (candidates.length === 0) break; // shouldn't happen if quotas sum to 7

        // Filter out yesterday's pick if team has 3+ members and there's any other choice
        var filtered = candidates;
        if (N >= 3 && prev !== null) {
            var withoutPrev = candidates.filter(function(id) { return id !== prev; });
            if (withoutPrev.length > 0) filtered = withoutPrev;
        }

        // From the filtered set, prefer member with highest remaining quota
        // (so heavier-loaded members get distributed earlier), with random tiebreak
        var best = null;
        var bestQuota = -1;
        var bestTie = -1;
        for (var m = 0; m < filtered.length; m++) {
            var cid = filtered[m];
            var q = quotas[cid];
            var tie = Math.random();
            if (q > bestQuota || (q === bestQuota && tie > bestTie)) {
                best = cid; bestQuota = q; bestTie = tie;
            }
        }

        schedule.push(best);
        quotas[best] -= 1;
        prev = best;
    }
    return schedule;
}

async function getPriorWeekCounts(weekStartDate) {
    // Sum assignments per user from the previous week's rotation, if any
    var prevStart = addDaysToYMD(weekStartDate, -7);
    var prevRotation = await WeeklyRotation.findOne({ weekStartDate: prevStart });
    var counts = {};
    if (prevRotation && prevRotation.assignments) {
        for (var i = 0; i < prevRotation.assignments.length; i++) {
            var uid = prevRotation.assignments[i].userId;
            if (!uid) continue;
            counts[uid] = (counts[uid] || 0) + 1;
        }
    }
    return counts;
}

async function getOrCreateWeeklyRotation(client, nowDate) {
    var weekStart = centralWeekStartString(nowDate);
    var existing = await WeeklyRotation.findOne({ weekStartDate: weekStart });
    if (existing) return existing;

    var members = await getAllPRMemberIds(client);
    if (members.length === 0) return null;

    var priorCounts = await getPriorWeekCounts(weekStart);
    var schedule = buildBalancedSchedule(members, priorCounts);

    var assignments = [];
    for (var i = 0; i < 7; i++) {
        var d = addDaysToYMD(weekStart, i);
        assignments.push({ date: d, userId: schedule[i] || null });
    }
    return await WeeklyRotation.create({ weekStartDate: weekStart, assignments: assignments });
}

// Regenerate the rotation for a given week, only touching days that DON'T already have a PRAssignment.
// Returns a summary object describing what was kept vs. changed.
async function regenerateWeek(client, weekStartString) {
    var members = await getAllPRMemberIds(client);
    if (members.length === 0) {
        return { ok: false, error: 'No PR members in role' };
    }

    // Find all dates this week that already have a PRAssignment (these are locked — we can't reassign them)
    var weekDates = [];
    for (var i = 0; i < 7; i++) weekDates.push(addDaysToYMD(weekStartString, i));

    var existingAssignments = await PRAssignment.find({ date: { $in: weekDates } });
    var lockedByDate = {};
    for (var j = 0; j < existingAssignments.length; j++) {
        lockedByDate[existingAssignments[j].date] = existingAssignments[j];
    }

    // Build per-member tally of locked days so the new schedule respects them in fairness
    var lockedCounts = {};
    Object.keys(lockedByDate).forEach(function(date) {
        var uid = lockedByDate[date].originalAssigneeId;
        if (uid && uid !== '0') lockedCounts[uid] = (lockedCounts[uid] || 0) + 1;
    });

    var priorCounts = await getPriorWeekCounts(weekStartString);
    // Treat already-locked days as if they count toward this week's load when computing fairness
    var combinedCounts = {};
    members.forEach(function(id) {
        combinedCounts[id] = (priorCounts[id] || 0) + (lockedCounts[id] || 0);
    });

    // Compute how many days are still unlocked
    var unlockedDates = weekDates.filter(function(d) { return !lockedByDate[d]; });
    var unlockedCount = unlockedDates.length;

    // Distribute unlockedCount days across members, weighted toward those with lower combined counts
    var sortedMembers = members.slice().map(function(id) {
        return { id: id, score: combinedCounts[id] || 0, jitter: Math.random() };
    });
    sortedMembers.sort(function(a, b) {
        if (a.score !== b.score) return a.score - b.score;
        return a.jitter - b.jitter;
    });
    sortedMembers = sortedMembers.map(function(o) { return o.id; });

    var base = Math.floor(unlockedCount / members.length);
    var extras = unlockedCount % members.length;
    var quotas = {};
    for (var k = 0; k < sortedMembers.length; k++) {
        quotas[sortedMembers[k]] = base + (k < extras ? 1 : 0);
    }

    // Walk the 7-day week in order: locked days reuse the lockedByDate user; unlocked days greedily pick
    var newAssignments = [];
    var prev = null;
    for (var d = 0; d < 7; d++) {
        var date = weekDates[d];
        if (lockedByDate[date]) {
            newAssignments.push({ date: date, userId: lockedByDate[date].originalAssigneeId });
            prev = lockedByDate[date].originalAssigneeId;
            continue;
        }
        // Pick from candidates with quota > 0; avoid prev when possible (3+ team)
        var candidates = members.filter(function(id) { return quotas[id] > 0; });
        if (candidates.length === 0) {
            newAssignments.push({ date: date, userId: null });
            prev = null;
            continue;
        }
        var filtered = candidates;
        if (members.length >= 3 && prev !== null) {
            var withoutPrev = candidates.filter(function(id) { return id !== prev; });
            if (withoutPrev.length > 0) filtered = withoutPrev;
        }
        var best = null;
        var bestQ = -1;
        var bestTie = -1;
        for (var m = 0; m < filtered.length; m++) {
            var cid = filtered[m];
            var q = quotas[cid];
            var tie = Math.random();
            if (q > bestQ || (q === bestQ && tie > bestTie)) { best = cid; bestQ = q; bestTie = tie; }
        }
        newAssignments.push({ date: date, userId: best });
        quotas[best] -= 1;
        prev = best;
    }

    var existing = await WeeklyRotation.findOne({ weekStartDate: weekStartString });
    if (existing) {
        existing.assignments = newAssignments;
        await existing.save();
    } else {
        existing = await WeeklyRotation.create({ weekStartDate: weekStartString, assignments: newAssignments });
    }

    return {
        ok: true,
        rotation: existing,
        lockedDates: Object.keys(lockedByDate),
        regeneratedDates: unlockedDates,
    };
}

// ---- Embeds ----
function buildAssignmentEmbed(userId, theme) {
    var desc =
        '> ' + ARROW_MARKUP + 'Good morning, <@' + userId + '>. You are required to complete an engagement post today. ' +
        'Your topic is: ' + theme + '. To finish this task, please visit https://discord.com/channels/' + MAIN_GUILD_ID + '/' + HEMISPHERES_CHANNEL_ID + ', ' +
        'paste the relevant format provided in the handbook or previous posts, and complete your assignment with a **@**everyone notification. ' +
        'You have until 11:59 PM Central Time to complete this assignment. You may opt to complete this by clicking the **checkmark**; however, in cases where you cannot, ' +
        'you may click the opposite button to intend your interest. In extreme circumstances, where no one can complete the engagement post, you will be automatically assigned to complete this task.\n' +
        '> \n' +
        '> United Airlines seeks more engaging content for your post. Basic or bland content will result in consequences.\n' +
        '-# ' + POLARIS_MARKUP + ' \u0262\u1D0F\u1D0F\u1D05 \u029F\u1D07\u1D00\u1D05\ua731 \u1D1B\u029C\u1D07 \u1D21\u1D00\u028F\n' +
        '-# ' + STARALLIANCE_MARKUP + ' \u1D00 \ua731\u1D1B\u1D00\u0280 \u1D00\u029F\u029F\u026A\u1D00\u0274\u1D04\u1D07 \u1D0D\u1D07\u1D0D\u0299\u1D07\u0280';
    return new EmbedBuilder()
        .setTitle(MAIL_MARKUP + ' Public Relations Assignment')
        .setColor(EMBED_COLOR)
        .setDescription(desc);
}

function buildFailureEmbed(userId) {
    var desc =
        '> ' + ARROW_MARKUP + 'Good evening, <@' + userId + '>. You have failed to complete your task for the day, which will result in a **point** addition to your punishment record at United Airlines. ' +
        'Please ensure to complete your task on time, as you most likely had the opportunity to reject this task, or submit an inactivity notice to be exempt from this task.\n' +
        '> \n' +
        '> A reminder that **3** points results in a suspension, and **6** points will result in a termination from United Airlines.\n' +
        '-# ' + POLARIS_MARKUP + ' \u0262\u1D0F\u1D0F\u1D05 \u029F\u1D07\u1D00\u1D05\ua731 \u1D1B\u029C\u1D07 \u1D21\u1D00\u028F\n' +
        '-# ' + STARALLIANCE_MARKUP + ' \u1D00 \ua731\u1D1B\u1D00\u0280 \u1D00\u029F\u029F\u026A\u1D00\u0274\u1D04\u1D07 \u1D0D\u1D07\u1D0D\u0299\u1D07\u0280';
    return new EmbedBuilder()
        .setTitle(MAIL_MARKUP + ' You are a Failure')
        .setColor(EMBED_COLOR)
        .setDescription(desc);
}

function buildForceAssignEmbed(userId, theme) {
    var desc =
        '> ' + ARROW_MARKUP + 'All other team members have declined today\'s engagement post. Per policy, you have been automatically assigned to complete it. ' +
        'Your topic is: ' + theme + '. You have until 11:59 PM Central Time to complete this task at https://discord.com/channels/' + MAIN_GUILD_ID + '/' + HEMISPHERES_CHANNEL_ID + ' with an **@**everyone notification.\n' +
        '-# ' + POLARIS_MARKUP + ' \u0262\u1D0F\u1D0F\u1D05 \u029F\u1D07\u1D00\u1D05\ua731 \u1D1B\u029C\u1D07 \u1D21\u1D00\u028F\n' +
        '-# ' + STARALLIANCE_MARKUP + ' \u1D00 \ua731\u1D1B\u1D00\u0280 \u1D00\u029F\u029F\u026A\u1D00\u0274\u1D04\u1D07 \u1D0D\u1D07\u1D0D\u0299\u1D07\u0280';
    return new EmbedBuilder()
        .setTitle(MAIL_MARKUP + ' Public Relations Assignment \u2014 Auto-Assigned')
        .setColor(EMBED_COLOR)
        .setDescription(desc);
}

function buildAcceptRejectRow(assignmentId, disabled) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('pr_accept_' + assignmentId)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(ACCEPT_EMOJI)
            .setDisabled(!!disabled),
        new ButtonBuilder()
            .setCustomId('pr_reject_' + assignmentId)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(DECLINE_EMOJI)
            .setDisabled(!!disabled),
    );
}

// ---- DM sending ----
async function sendAssignmentDM(client, assignment, userId) {
    var user;
    try {
        user = await client.users.fetch(userId);
    } catch (err) {
        console.error('[PR] User fetch failed for', userId, err);
        return false;
    }
    var embed = buildAssignmentEmbed(userId, assignment.theme);
    var row = buildAcceptRejectRow(assignment._id.toString(), false);
    try {
        var dm = await user.send({ embeds: [embed], components: [row] });
        assignment.dmMessages.push({
            userId: userId,
            channelId: dm.channelId,
            messageId: dm.id,
        });
        await assignment.save();
        return true;
    } catch (err) {
        console.error('[PR] DM failed for', userId, '(DMs closed or user left):', err.message);
        return false;
    }
}

// ---- Daily assignment run (12:00 PM Central) ----
async function runDailyAssignment(client) {
    var now = new Date();
    var today = centralDateString(now);

    var existing = await PRAssignment.findOne({ date: today });
    if (existing) {
        console.log('[PR] Assignment already exists for', today, '(status:', existing.status + ')');
        return;
    }

    var dow = centralDayOfWeek(now);
    var theme = THEMES[dow];

    var rotation = await getOrCreateWeeklyRotation(client, now);
    if (!rotation) {
        console.log('[PR] No PR members at all. Skipping', today);
        return;
    }

    var slot = null;
    for (var i = 0; i < rotation.assignments.length; i++) {
        if (rotation.assignments[i].date === today) { slot = rotation.assignments[i]; break; }
    }
    var rotationAssignee = slot ? slot.userId : null;

    // Decide the actual assignee: rotation pick if available, else random active substitute
    var assigneeId = null;
    if (rotationAssignee) {
        var onLeave = await isOnApprovedLeave(rotationAssignee, now);
        if (!onLeave) {
            // Also verify they're still in the server
            try {
                var volareGuild = await client.guilds.fetch(VOLARE_GUILD_ID);
                var member = await volareGuild.members.fetch(rotationAssignee).catch(function() { return null; });
                if (member && member.roles.cache.has(PR_ROLE_ID)) {
                    assigneeId = rotationAssignee;
                }
            } catch (e) {}
        }
    }

    if (!assigneeId) {
        var subs = await getActivePRMemberIds(client, now, []);
        if (subs.length === 0) {
            console.log('[PR] No available PR members (all on leave or none in server). Skipping', today);
            await PRAssignment.create({
                date: today,
                theme: theme,
                originalAssigneeId: rotationAssignee || '0',
                currentAssigneeId: rotationAssignee || '0',
                status: 'skipped',
            });
            return;
        }
        // Pick the substitute with the fewest assignments this week, with random tiebreak
        var weekStart = centralWeekStartString(now);
        var thisWeek = await WeeklyRotation.findOne({ weekStartDate: weekStart });
        var weekCounts = {};
        if (thisWeek && thisWeek.assignments) {
            for (var x = 0; x < thisWeek.assignments.length; x++) {
                var u = thisWeek.assignments[x].userId;
                if (u) weekCounts[u] = (weekCounts[u] || 0) + 1;
            }
        }
        var subRanked = subs.map(function(id) {
            return { id: id, count: weekCounts[id] || 0, jitter: Math.random() };
        });
        subRanked.sort(function(a, b) {
            if (a.count !== b.count) return a.count - b.count;
            return a.jitter - b.jitter;
        });
        assigneeId = subRanked[0].id;
    }

    var assignment;
    try {
        assignment = await PRAssignment.create({
            date: today,
            theme: theme,
            originalAssigneeId: assigneeId,
            currentAssigneeId: assigneeId,
        });
    } catch (err) {
        // Unique constraint race — already handled
        console.error('[PR] Assignment create error (possible race):', err.message);
        return;
    }

    var sent = await sendAssignmentDM(client, assignment, assigneeId);
    if (!sent) {
        // DMs closed — treat as a rejection and try another
        assignment.rejectedIds.push(assigneeId);
        await assignment.save();
        await advanceAfterRejection(client, assignment);
    }
}

// ---- Rejection chain advancement ----
async function advanceAfterRejection(client, assignment) {
    // Pick next un-asked, available member, weighted toward those with the fewest assignments this week
    var now = new Date();
    var exclude = assignment.rejectedIds.concat([]);
    var available = await getActivePRMemberIds(client, now, exclude);

    if (available.length > 0) {
        var weekStart = centralWeekStartString(now);
        var thisWeek = await WeeklyRotation.findOne({ weekStartDate: weekStart });
        var weekCounts = {};
        if (thisWeek && thisWeek.assignments) {
            for (var x = 0; x < thisWeek.assignments.length; x++) {
                var u = thisWeek.assignments[x].userId;
                if (u) weekCounts[u] = (weekCounts[u] || 0) + 1;
            }
        }
        var ranked = available.map(function(id) {
            return { id: id, count: weekCounts[id] || 0, jitter: Math.random() };
        });
        ranked.sort(function(a, b) {
            if (a.count !== b.count) return a.count - b.count;
            return a.jitter - b.jitter;
        });
        var next = ranked[0].id;
        assignment.currentAssigneeId = next;
        await assignment.save();
        var sent = await sendAssignmentDM(client, assignment, next);
        if (!sent) {
            assignment.rejectedIds.push(next);
            await assignment.save();
            return advanceAfterRejection(client, assignment); // recurse
        }
        return;
    }

    // Everyone has rejected — force assign to original
    assignment.currentAssigneeId = assignment.originalAssigneeId;
    assignment.acceptedBy = assignment.originalAssigneeId;
    assignment.status = 'accepted';
    assignment.acceptedAt = new Date();
    await assignment.save();

    try {
        var user = await client.users.fetch(assignment.originalAssigneeId);
        await user.send({ embeds: [buildForceAssignEmbed(assignment.originalAssigneeId, assignment.theme)] });
    } catch (err) {
        console.error('[PR] Force-assign DM failed:', err);
    }
}

// ---- Button handlers ----
async function handleAccept(interaction) {
    var assignmentId = interaction.customId.replace('pr_accept_', '');
    var assignment;
    try {
        assignment = await PRAssignment.findById(assignmentId);
    } catch (e) { assignment = null; }

    if (!assignment) {
        return interaction.reply({ content: DECLINE_MARKUP + ' This assignment no longer exists.', ephemeral: true });
    }
    if (assignment.status !== 'pending') {
        return interaction.reply({ content: DECLINE_MARKUP + ' This assignment is no longer active.', ephemeral: true });
    }
    if (interaction.user.id !== assignment.currentAssigneeId) {
        return interaction.reply({ content: DECLINE_MARKUP + ' This assignment is not yours.', ephemeral: true });
    }

    assignment.status = 'accepted';
    assignment.acceptedBy = interaction.user.id;
    assignment.acceptedAt = new Date();
    await assignment.save();

    var originalDesc = (interaction.message.embeds[0] && interaction.message.embeds[0].description) || '';
    var updated = EmbedBuilder.from(interaction.message.embeds[0])
        .setDescription(originalDesc + '\n\n' + ACCEPT_MARKUP + ' **Accepted** — complete your post in <#' + HEMISPHERES_CHANNEL_ID + '> by 11:59 PM Central.');
    await interaction.update({ embeds: [updated], components: [buildAcceptRejectRow(assignmentId, true)] });
}

async function handleReject(interaction) {
    var assignmentId = interaction.customId.replace('pr_reject_', '');
    var assignment;
    try {
        assignment = await PRAssignment.findById(assignmentId);
    } catch (e) { assignment = null; }

    if (!assignment) {
        return interaction.reply({ content: DECLINE_MARKUP + ' This assignment no longer exists.', ephemeral: true });
    }
    if (assignment.status !== 'pending') {
        return interaction.reply({ content: DECLINE_MARKUP + ' This assignment is no longer active.', ephemeral: true });
    }
    if (interaction.user.id !== assignment.currentAssigneeId) {
        return interaction.reply({ content: DECLINE_MARKUP + ' This assignment is not yours.', ephemeral: true });
    }

    if (assignment.rejectedIds.indexOf(interaction.user.id) === -1) {
        assignment.rejectedIds.push(interaction.user.id);
    }
    await assignment.save();

    var originalDesc = (interaction.message.embeds[0] && interaction.message.embeds[0].description) || '';
    var updated = EmbedBuilder.from(interaction.message.embeds[0])
        .setDescription(originalDesc + '\n\n' + DECLINE_MARKUP + ' **Declined** — finding another team member.');
    await interaction.update({ embeds: [updated], components: [buildAcceptRejectRow(assignmentId, true)] });

    await advanceAfterRejection(interaction.client, assignment);
}

// ---- Completion detection ----
async function onMessageCreate(message) {
    try {
        if (!message.guild) return;
        if (message.author.bot) return;
        if (message.channelId !== HEMISPHERES_CHANNEL_ID) return;
        if (!message.mentions.everyone) return;

        var today = centralDateString(new Date());
        var assignment = await PRAssignment.findOne({
            date: today,
            status: 'accepted',
            acceptedBy: message.author.id,
        });
        if (!assignment) return;

        assignment.status = 'completed';
        assignment.completedAt = new Date();
        await assignment.save();
        console.log('[PR] Post completed by', message.author.id, 'for', today);
    } catch (err) {
        console.error('[PR] onMessageCreate error:', err);
    }
}

// ---- End-of-day check (11:59 PM Central) ----
async function runEndOfDayCheck(client) {
    var now = new Date();
    var today = centralDateString(now);
    var assignment = await PRAssignment.findOne({ date: today });
    if (!assignment) return;
    if (assignment.failureProcessed) return;
    if (assignment.status === 'completed' || assignment.status === 'skipped' || assignment.status === 'failed') return;

    // One last catch-up scan in case we missed a messageCreate event
    if (assignment.status === 'accepted' && assignment.acceptedBy) {
        try {
            var mainGuild = await client.guilds.fetch(MAIN_GUILD_ID);
            var channel = await mainGuild.channels.fetch(HEMISPHERES_CHANNEL_ID);
            var since = assignment.acceptedAt || assignment.createdAt;
            var messages = await channel.messages.fetch({ limit: 100 });
            var found = false;
            messages.forEach(function(m) {
                if (found) return;
                if (m.author.id !== assignment.acceptedBy) return;
                if (!m.mentions.everyone) return;
                if (m.createdAt < since) return;
                if (centralDateString(m.createdAt) !== today) return;
                found = true;
            });
            if (found) {
                assignment.status = 'completed';
                assignment.completedAt = new Date();
                await assignment.save();
                console.log('[PR] End-of-day catch-up: completion found for', assignment.acceptedBy);
                return;
            }
        } catch (err) {
            console.error('[PR] End-of-day scan error:', err);
        }
    }

    var failedUserId = assignment.acceptedBy || assignment.originalAssigneeId;
    assignment.status = 'failed';
    assignment.failedAt = now;
    assignment.failureProcessed = true;
    await assignment.save();

    try {
        var user = await client.users.fetch(failedUserId);
        await user.send({ embeds: [buildFailureEmbed(failedUserId)] });
    } catch (err) {
        console.error('[PR] Failure DM error:', err);
    }

    // Add a sanction point for the failed engagement task
    try {
        await points.addPoint(client, failedUserId, {
            reason: 'Missed engagement post (' + assignment.theme + ')',
            addedBy: 'system',
        });
    } catch (err) {
        console.error('[PR] Failed to add sanction point:', err);
    }
}

// ---- Scheduler ----
var _scheduled = false;
var _lastNoonKey = null;
var _lastEndOfDayKey = null;
var _lastWeeklyRegenKey = null;

function start(client) {
    if (_scheduled) return;
    _scheduled = true;

    // Startup catch-up
    startupCatchUp(client).catch(function(err) { console.error('[PR] Startup catchup error:', err); });

    setInterval(function() {
        tick(client).catch(function(err) { console.error('[PR] Tick error:', err); });
    }, 60 * 1000);

    console.log('[PR] Engagement scheduler started');
}

async function tick(client) {
    var now = new Date();
    var c = centralParts(now);
    var hour = parseInt(c.hour, 10);
    var minute = parseInt(c.minute, 10);
    var dateKey = c.year + '-' + c.month + '-' + c.day;
    var dow = centralDayOfWeek(now);

    // Sunday at noon Central: regenerate the weekly rotation BEFORE the daily assignment runs.
    // The week-key prevents accidental re-runs within the same Sunday if the bot restarts.
    if (dow === 0 && hour === 12 && minute === 0 && _lastWeeklyRegenKey !== dateKey) {
        _lastWeeklyRegenKey = dateKey;
        try {
            var weekStart = centralWeekStartString(now);
            console.log('[PR] Sunday noon: regenerating weekly rotation for', weekStart);
            var result = await regenerateWeek(client, weekStart);
            if (result.ok) {
                console.log('[PR] Rotation regenerated. Locked:', result.lockedDates.length, '| Regenerated:', result.regeneratedDates.length);
            } else {
                console.error('[PR] Weekly regen failed:', result.error);
            }
        } catch (err) {
            console.error('[PR] Weekly regen error:', err);
        }
    }

    if (hour === 12 && minute === 0 && _lastNoonKey !== dateKey) {
        _lastNoonKey = dateKey;
        await runDailyAssignment(client);
    }

    if (hour === 23 && minute === 59 && _lastEndOfDayKey !== dateKey) {
        _lastEndOfDayKey = dateKey;
        await runEndOfDayCheck(client);
    }
}

async function startupCatchUp(client) {
    var now = new Date();
    var c = centralParts(now);
    var hour = parseInt(c.hour, 10);
    var dateKey = c.year + '-' + c.month + '-' + c.day;
    var dow = centralDayOfWeek(now);

    // If it's Sunday and we're past noon Central but no rotation exists for this week
    // (or the existing one predates our deploy), regenerate it before the daily assignment.
    if (dow === 0 && hour >= 12) {
        try {
            var weekStart = centralWeekStartString(now);
            var existingRotation = await WeeklyRotation.findOne({ weekStartDate: weekStart });
            // If this week's rotation hasn't been touched today and no Sunday assignment yet, regenerate.
            var sundayAssignment = await PRAssignment.findOne({ date: dateKey });
            if (!sundayAssignment) {
                console.log('[PR] Startup catch-up: missed Sunday-noon regen for', weekStart);
                var result = await regenerateWeek(client, weekStart);
                if (result.ok) {
                    console.log('[PR] Catch-up regen complete. Locked:', result.lockedDates.length, '| Regenerated:', result.regeneratedDates.length);
                }
            }
            _lastWeeklyRegenKey = dateKey; // prevent duplicate fire today
        } catch (err) {
            console.error('[PR] Startup weekly-regen error:', err);
        }
    }

    // If we're past noon Central and no assignment exists for today, run it now
    if (hour >= 12) {
        var existing = await PRAssignment.findOne({ date: dateKey });
        if (!existing) {
            console.log('[PR] Startup catch-up: running missed noon assignment for', dateKey);
            await runDailyAssignment(client);
        } else if (existing.status === 'accepted' && existing.acceptedBy) {
            // Check if completion happened while we were offline
            await catchUpCompletion(client, existing);
        }
        _lastNoonKey = dateKey; // prevent duplicate fire within the same day
    }
}

async function catchUpCompletion(client, assignment) {
    try {
        var mainGuild = await client.guilds.fetch(MAIN_GUILD_ID);
        var channel = await mainGuild.channels.fetch(HEMISPHERES_CHANNEL_ID);
        var messages = await channel.messages.fetch({ limit: 100 });
        var since = assignment.acceptedAt || assignment.createdAt;
        var found = false;
        messages.forEach(function(m) {
            if (found) return;
            if (m.author.id !== assignment.acceptedBy) return;
            if (!m.mentions.everyone) return;
            if (m.createdAt < since) return;
            if (centralDateString(m.createdAt) !== assignment.date) return;
            found = true;
        });
        if (found) {
            assignment.status = 'completed';
            assignment.completedAt = new Date();
            await assignment.save();
            console.log('[PR] Startup catch-up: detected completed post for', assignment.acceptedBy);
        }
    } catch (err) {
        console.error('[PR] catchUpCompletion error:', err);
    }
}

module.exports = {
    start: start,
    onMessageCreate: onMessageCreate,
    handleAccept: handleAccept,
    handleReject: handleReject,
    regenerateWeek: regenerateWeek,
    centralWeekStartString: centralWeekStartString,
};
