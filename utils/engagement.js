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
async function getActivePRMemberIds(client, date, excludeIds) {
    excludeIds = excludeIds || [];
    var guild;
    try {
        guild = await client.guilds.fetch(VOLARE_GUILD_ID);
    } catch (err) {
        console.error('[PR] Failed to fetch Volare guild:', err);
        return [];
    }
    try {
        await guild.members.fetch();
    } catch (err) {
        console.error('[PR] Members fetch error:', err);
    }
    var role = guild.roles.cache.get(PR_ROLE_ID) || await guild.roles.fetch(PR_ROLE_ID).catch(function() { return null; });
    if (!role) { console.error('[PR] PR role not found'); return []; }

    var all = role.members.map(function(m) { return m.id; });
    var active = [];
    for (var i = 0; i < all.length; i++) {
        if (excludeIds.indexOf(all[i]) !== -1) continue;
        if (await isOnApprovedLeave(all[i], date)) continue;
        active.push(all[i]);
    }
    return active;
}

async function getAllPRMemberIds(client) {
    var guild;
    try {
        guild = await client.guilds.fetch(VOLARE_GUILD_ID);
    } catch (err) {
        console.error('[PR] Failed to fetch Volare guild:', err);
        return [];
    }
    try {
        await guild.members.fetch();
    } catch (err) {
        console.error('[PR] Members fetch error:', err);
    }
    var role = guild.roles.cache.get(PR_ROLE_ID) || await guild.roles.fetch(PR_ROLE_ID).catch(function() { return null; });
    if (!role) return [];
    return role.members.map(function(m) { return m.id; });
}

// ---- Weekly rotation ----
async function getOrCreateWeeklyRotation(client, nowDate) {
    var weekStart = centralWeekStartString(nowDate);
    var existing = await WeeklyRotation.findOne({ weekStartDate: weekStart });
    if (existing) return existing;

    var members = await getAllPRMemberIds(client);
    if (members.length === 0) return null;

    shuffle(members);
    var assignments = [];
    for (var i = 0; i < 7; i++) {
        var d = addDaysToYMD(weekStart, i);
        assignments.push({ date: d, userId: members[i % members.length] });
    }
    return await WeeklyRotation.create({ weekStartDate: weekStart, assignments: assignments });
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
        assigneeId = subs[Math.floor(Math.random() * subs.length)];
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
    // Pick next random un-asked, available member
    var now = new Date();
    var exclude = assignment.rejectedIds.concat([]);
    var available = await getActivePRMemberIds(client, now, exclude);

    if (available.length > 0) {
        var next = available[Math.floor(Math.random() * available.length)];
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
};
