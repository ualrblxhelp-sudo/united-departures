const { EmbedBuilder } = require('discord.js');
const ids = require('../config/ids');
const TrainingAssignment = require('../models/TrainingAssignment');
const TraineeProfile = require('../models/TraineeProfile');

var PANEL_TITLE = 'United Aviate — Training Panel';
var PANEL_FOOTER = 'United Aviate • Training';

var DEPT_LABEL = {
    'customer-service': 'Customer Service',
    'flight-crew': 'Flight Crew',
    'ramp-services': 'Ramp Services',
};

function deptLabel(key) {
    return DEPT_LABEL[key] || key;
}

// Embed field values cap at 1024 chars.
function fieldValue(lines) {
    if (lines.length === 0) return '—';
    var text = lines.join('\n');
    if (text.length <= 1024) return text;
    var out = [];
    var len = 0;
    for (var i = 0; i < lines.length; i++) {
        if (len + lines[i].length + 1 > 990) {
            out.push('…and ' + (lines.length - i) + ' more');
            break;
        }
        out.push(lines[i]);
        len += lines[i].length + 1;
    }
    return out.join('\n');
}

async function buildTrainingPanelEmbed() {
    var active = await TrainingAssignment.find({ status: 'active' }).sort({ assignedAt: 1 }).lean().catch(function () { return []; });
    var completed = await TrainingAssignment.find({ status: 'completed' }).sort({ completedAt: -1 }).limit(40).lean().catch(function () { return []; });
    var profiles = await TraineeProfile.find({ completedTrainings: { $exists: true, $ne: [] } }).lean().catch(function () { return []; });

    var embed = new EmbedBuilder()
        .setColor(ids.EMBED_COLOR)
        .setTitle(PANEL_TITLE)
        .setTimestamp()
        .setFooter({ text: PANEL_FOOTER });

    if (active.length === 0) {
        embed.addFields({ name: 'Active Assignments', value: 'None right now.' });
    } else {
        var byInstructor = {};
        active.forEach(function (a) {
            (byInstructor[a.instructorId] = byInstructor[a.instructorId] || []).push(a);
        });
        var lines = [];
        Object.keys(byInstructor).forEach(function (iid) {
            lines.push('**<@' + iid + '>** — ' + byInstructor[iid].length + ' trainee(s)');
            byInstructor[iid].forEach(function (a) {
                lines.push('\u2022 <@' + a.studentId + '> — ' + deptLabel(a.department));
            });
        });
        embed.addFields({ name: 'Active Assignments (' + active.length + ')', value: fieldValue(lines) });
    }

    if (completed.length) {
        var clines = completed.map(function (a) {
            return '\u2022 <@' + a.studentId + '> — ' + deptLabel(a.department) + ' (logged by <@' + (a.completedBy || a.instructorId) + '>)';
        });
        embed.addFields({ name: 'Recently Completed (' + completed.length + ')', value: fieldValue(clines) });
    }

    if (profiles.length) {
        var plines = profiles.map(function (p) {
            var done = (p.completedTrainings || []).map(deptLabel).join(', ');
            return '\u2022 <@' + p.discordId + '> — ' + done;
        });
        embed.addFields({ name: 'Trainees with Completed Training (' + profiles.length + ')', value: fieldValue(plines) });
    }

    if (active.length === 0 && completed.length === 0 && profiles.length === 0) {
        embed.setDescription('No training data yet — no active assignments and nothing logged as complete.');
    }

    return embed;
}

function isPanelMessage(message) {
    if (!message || !message.author || !message.author.bot) return false;
    if (!Array.isArray(message.embeds) || message.embeds.length === 0) return false;
    var embed = message.embeds[0];
    return embed && embed.title === PANEL_TITLE;
}

async function findPanelMessage(thread) {
    var pinned = await thread.messages.fetchPinned().catch(function () { return null; });
    if (pinned) {
        var pinnedMatch = pinned.find(isPanelMessage);
        if (pinnedMatch) return pinnedMatch;
    }

    var recent = await thread.messages.fetch({ limit: 100 }).catch(function () { return null; });
    if (!recent) return null;
    return recent.find(isPanelMessage) || null;
}

async function resolvePanelThread(client) {
    if (!ids.TRAINING_PANEL_THREAD_ID) return null;
    return client.channels.fetch(ids.TRAINING_PANEL_THREAD_ID).catch(function () { return null; });
}

async function syncTrainingPanel(client) {
    var thread = await resolvePanelThread(client);
    if (!thread || typeof thread.send !== 'function') {
        console.error('[TrainingPanel] Panel thread not reachable:', ids.TRAINING_PANEL_THREAD_ID);
        return null;
    }

    var embed = await buildTrainingPanelEmbed();
    var message = await findPanelMessage(thread);
    if (message) {
        await message.edit({ embeds: [embed] });
        return message;
    }

    var sent = await thread.send({ embeds: [embed] });
    await sent.pin().catch(function () {});
    return sent;
}

module.exports = {
    buildTrainingPanelEmbed,
    syncTrainingPanel,
};
