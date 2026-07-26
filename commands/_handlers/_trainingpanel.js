const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const ids = require('../../config/ids');
const TrainingAssignment = require('../../models/TrainingAssignment');
const TraineeProfile = require('../../models/TraineeProfile');

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

module.exports = {
    async execute(interaction) {
        if (interaction.guildId !== ids.AVIATE_SERVER_ID) {
            return interaction.reply({ content: 'This command can only be used in the United Aviate server.', ephemeral: true });
        }
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Only server administrators can use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        var active = await TrainingAssignment.find({ status: 'active' }).sort({ assignedAt: 1 }).lean().catch(function () { return []; });
        var completed = await TrainingAssignment.find({ status: 'completed' }).sort({ completedAt: -1 }).limit(40).lean().catch(function () { return []; });
        var profiles = await TraineeProfile.find({ completedTrainings: { $exists: true, $ne: [] } }).lean().catch(function () { return []; });

        var embed = new EmbedBuilder()
            .setColor(ids.EMBED_COLOR)
            .setTitle('United Aviate — Training Panel')
            .setTimestamp()
            .setFooter({ text: 'United Aviate • Training' });

        // ---- Active assignments, grouped by instructor ----
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

        // ---- Recently closed-out assignments ----
        if (completed.length) {
            var clines = completed.map(function (a) {
                return '\u2022 <@' + a.studentId + '> — ' + deptLabel(a.department) + ' (logged by <@' + (a.completedBy || a.instructorId) + '>)';
            });
            embed.addFields({ name: 'Recently Completed (' + completed.length + ')', value: fieldValue(clines) });
        }

        // ---- Trainees with completed trainings (from their profile) ----
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

        return interaction.editReply({ embeds: [embed] });
    },
};
