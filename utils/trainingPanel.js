const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const ids = require('../config/ids');
const TrainingAssignment = require('../models/TrainingAssignment');
const TraineeProfile = require('../models/TraineeProfile');

var PANEL_TITLE = 'United Aviate — Training Panel';
var PANEL_FOOTER = 'United Aviate • Training';
var FIELDS_PER_PAGE = 4;

var DEPT_LABEL = {
    'customer-service': 'Customer Service',
    'flight-crew': 'Flight Crew',
    'ramp-services': 'Ramp Services',
};

function deptLabel(key) {
    return DEPT_LABEL[key] || key;
}

function chunkLines(lines, maxLen) {
    var limit = maxLen || 1000;
    var chunks = [];
    var current = [];
    var len = 0;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var add = line.length + (current.length ? 1 : 0);
        if (current.length && len + add > limit) {
            chunks.push(current.join('\n'));
            current = [line];
            len = line.length;
            continue;
        }
        current.push(line);
        len += add;
    }

    if (current.length) chunks.push(current.join('\n'));
    return chunks;
}

function buildSectionFields(name, lines) {
    if (!lines.length) return [{ name: name, value: '—' }];
    var chunks = chunkLines(lines, 1000);
    return chunks.map(function (chunk, index) {
        return {
            name: index === 0 ? name : name + ' (cont. ' + (index + 1) + ')',
            value: chunk,
        };
    });
}

async function loadTrainingPanelData() {
    var active = await TrainingAssignment.find({ status: 'active' }).sort({ assignedAt: 1 }).lean().catch(function () { return []; });
    var completed = await TrainingAssignment.find({ status: 'completed' }).sort({ completedAt: -1 }).limit(40).lean().catch(function () { return []; });
    var profiles = await TraineeProfile.find({ completedTrainings: { $exists: true, $ne: [] } }).lean().catch(function () { return []; });

    return {
        active: active,
        completed: completed,
        profiles: profiles,
    };
}

function buildTrainingPanelFields(data) {
    var fields = [];

    if (data.active.length === 0) {
        fields.push({ name: 'Active Assignments', value: 'None right now.' });
    } else {
        var byInstructor = {};
        data.active.forEach(function (a) {
            (byInstructor[a.instructorId] = byInstructor[a.instructorId] || []).push(a);
        });
        var lines = [];
        Object.keys(byInstructor).forEach(function (iid) {
            lines.push('**<@' + iid + '>** — ' + byInstructor[iid].length + ' trainee(s)');
            byInstructor[iid].forEach(function (a) {
                lines.push('\u2022 <@' + a.studentId + '> — ' + deptLabel(a.department));
            });
        });
        fields = fields.concat(buildSectionFields('Active Assignments (' + data.active.length + ')', lines));
    }

    if (data.completed.length) {
        var clines = data.completed.map(function (a) {
            return '\u2022 <@' + a.studentId + '> — ' + deptLabel(a.department) + ' (logged by <@' + (a.completedBy || a.instructorId) + '>)';
        });
        fields = fields.concat(buildSectionFields('Recently Completed (' + data.completed.length + ')', clines));
    }

    if (data.profiles.length) {
        var plines = data.profiles.map(function (p) {
            var done = (p.completedTrainings || []).map(deptLabel).join(', ');
            return '\u2022 <@' + p.discordId + '> — ' + done;
        });
        fields = fields.concat(buildSectionFields('Trainees with Completed Training (' + data.profiles.length + ')', plines));
    }

    return fields;
}

function buildPanelDescription(data) {
    return [
        '**Active assignments:** ' + data.active.length,
        '**Recently completed:** ' + data.completed.length,
        '**Profiles with completed training:** ' + data.profiles.length,
    ].join('\n');
}

function parseCurrentPage(message) {
    if (!message || !Array.isArray(message.embeds) || !message.embeds.length) return 1;
    var footer = message.embeds[0] && message.embeds[0].footer ? message.embeds[0].footer.text : '';
    var match = String(footer || '').match(/Page (\d+) of (\d+)/);
    return match ? Number(match[1]) || 1 : 1;
}

function buildComponents(page, totalPages) {
    var prevPage = Math.max(1, page - 1);
    var nextPage = Math.min(totalPages, page + 1);
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('tp_prev_' + prevPage)
                .setLabel('Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page <= 1),
            new ButtonBuilder()
                .setCustomId('tp_info')
                .setLabel('Page ' + page + '/' + totalPages)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId('tp_next_' + nextPage)
                .setLabel('Next')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages)
        ),
    ];
}

async function buildTrainingPanelView(page) {
    var data = await loadTrainingPanelData();
    var fields = buildTrainingPanelFields(data);
    var totalPages = Math.max(1, Math.ceil(fields.length / FIELDS_PER_PAGE));
    var safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
    var start = (safePage - 1) * FIELDS_PER_PAGE;
    var pageFields = fields.slice(start, start + FIELDS_PER_PAGE);

    var embed = new EmbedBuilder()
        .setColor(ids.EMBED_COLOR)
        .setTitle(PANEL_TITLE)
        .setDescription(buildPanelDescription(data))
        .setTimestamp()
        .setFooter({ text: PANEL_FOOTER + ' • Page ' + safePage + ' of ' + totalPages });

    if (pageFields.length) embed.addFields(pageFields);

    if (data.active.length === 0 && data.completed.length === 0 && data.profiles.length === 0) {
        embed.setDescription('No training data yet — no active assignments and nothing logged as complete.');
    }

    return {
        embed: embed,
        components: buildComponents(safePage, totalPages),
        page: safePage,
        totalPages: totalPages,
    };
}

function isPanelMessage(message) {
    if (!message || !message.author || !message.author.bot) return false;
    if (!Array.isArray(message.embeds) || message.embeds.length === 0) return false;
    var embed = message.embeds[0];
    return embed && embed.title === PANEL_TITLE;
}

function findFirstMessage(source, predicate) {
    if (!source) return null;
    if (typeof source.find === 'function') {
        return source.find(predicate) || null;
    }
    if (Array.isArray(source)) {
        for (var i = 0; i < source.length; i++) {
            if (predicate(source[i])) return source[i];
        }
        return null;
    }
    if (typeof source.values === 'function') {
        var iter = source.values();
        var next = iter.next();
        while (!next.done) {
            if (predicate(next.value)) return next.value;
            next = iter.next();
        }
    }
    return null;
}

async function findPanelMessage(thread) {
    var pinned = await thread.messages.fetchPins().catch(function () { return null; });
    if (pinned) {
        var pinnedMatch = findFirstMessage(pinned, isPanelMessage);
        if (pinnedMatch) return pinnedMatch;
    }

    var recent = await thread.messages.fetch({ limit: 100 }).catch(function () { return null; });
    if (!recent) return null;
    return findFirstMessage(recent, isPanelMessage);
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

    var message = await findPanelMessage(thread);
    var currentPage = parseCurrentPage(message);
    var view = await buildTrainingPanelView(currentPage);
    if (message) {
        await message.edit({ embeds: [view.embed], components: view.components });
        return message;
    }

    var sent = await thread.send({ embeds: [view.embed], components: view.components });
    await sent.pin().catch(function () {});
    return sent;
}

module.exports = {
    buildTrainingPanelView,
    parseCurrentPage,
    syncTrainingPanel,
};
