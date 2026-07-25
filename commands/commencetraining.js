const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const ids = require('../config/ids');
const TraineeProfile = require('../models/TraineeProfile');
const TrainingAssignment = require('../models/TrainingAssignment');

// Departments line up with the /traininglog training types and DEPARTMENT_ROLES.
var DEPARTMENTS = [
    { key: 'customer-service', label: 'Customer Service' },
    { key: 'flight-crew', label: 'Flight Crew' },
    { key: 'ramp-services', label: 'Ramp Services' },
];

function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }
    return a;
}

async function safeDM(member, payload) {
    try {
        await member.send(payload);
        return true;
    } catch (err) {
        return false;
    }
}

function instructorDM(student, deptLabel) {
    return {
        embeds: [new EmbedBuilder()
            .setColor(ids.EMBED_COLOR)
            .setTitle('New Trainee Assigned')
            .setDescription(
                'You have been assigned a student to train in **' + deptLabel + '**.\n\n' +
                '**Student:** ' + student.user.username + ' (<@' + student.id + '>)\n\n' +
                'When you have finished training them, confirm it with `/traininglog` \u2014 set ' +
                '**users** to your student and **trainingtype** to ' + deptLabel + '. ' +
                'That closes out the assignment and removes their in-training role.'
            )
            .setTimestamp()
            .setFooter({ text: 'United Aviate \u2022 Training' })],
    };
}

function studentDM(instructor, deptLabel) {
    return {
        embeds: [new EmbedBuilder()
            .setColor(ids.EMBED_COLOR)
            .setTitle('Your Training Instructor')
            .setDescription(
                'You have been selected for **' + deptLabel + '** training.\n\n' +
                '**Instructor:** ' + instructor.user.username + ' (<@' + instructor.id + '>)\n\n' +
                'They will reach out to begin your training.'
            )
            .setTimestamp()
            .setFooter({ text: 'United Aviate \u2022 Training' })],
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('commencetraining')
        .setDescription('Randomly assign eligible students to instructors by department and DM both sides.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (interaction.guildId !== ids.AVIATE_SERVER_ID) {
            return interaction.reply({ content: 'This command can only be used in the United Aviate server.', ephemeral: true });
        }
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Only server administrators can use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        var guild = interaction.guild;
        var instructorRoleId = ids.TRAINING_STAFF_ROLE_ID;
        var inTrainingRoleId = ids.TRAINING_INTRAINING_ROLE_ID;

        // Need the full member list to find instructors and students.
        try {
            await guild.members.fetch();
        } catch (err) {
            console.error('[CommenceTraining] members.fetch failed:', err);
            return interaction.editReply({ content: 'Could not load the member list (is the Server Members intent enabled?).' });
        }

        // Exclude students who already finished their department's training.
        var completedByUser = {};
        try {
            var profiles = await TraineeProfile.find({}).lean();
            profiles.forEach(function(p) {
                completedByUser[p.discordId] = Array.isArray(p.completedTrainings) ? p.completedTrainings : [];
            });
        } catch (err) {
            console.error('[CommenceTraining] profile load failed:', err);
        }

        // Exclude students who already have an active assignment.
        var alreadyAssigned = {};
        try {
            var active = await TrainingAssignment.find({ status: 'active' }).lean();
            active.forEach(function(a) { alreadyAssigned[a.studentId] = true; });
        } catch (err) {
            console.error('[CommenceTraining] assignment load failed:', err);
        }

        var assignedThisRun = {};
        var results = [];             // { deptLabel, student, instructor, roleOk }
        var skippedNoInstructor = []; // { deptLabel, count }
        var dmNotes = [];

        for (var d = 0; d < DEPARTMENTS.length; d++) {
            var dept = DEPARTMENTS[d];
            var deptRoleId = ids.DEPARTMENT_ROLES[dept.key];
            if (!deptRoleId) continue;

            var instructors = [];
            var students = [];

            guild.members.cache.forEach(function(member) {
                if (member.user.bot) return;
                if (!member.roles.cache.has(deptRoleId)) return;

                if (member.roles.cache.has(instructorRoleId)) {
                    instructors.push(member);
                    return;
                }
                // Student candidate filters.
                if (member.roles.cache.has(inTrainingRoleId)) return;   // already mid-training
                if (alreadyAssigned[member.id]) return;                  // has an active assignment
                if (assignedThisRun[member.id]) return;                  // assigned earlier this run
                var done = completedByUser[member.id] || [];
                if (done.indexOf(dept.key) !== -1) return;               // already completed this dept
                students.push(member);
            });

            if (students.length === 0) continue;
            if (instructors.length === 0) {
                skippedNoInstructor.push({ deptLabel: dept.label, count: students.length });
                continue;
            }

            var shuffledInstructors = shuffle(instructors);
            var shuffledStudents = shuffle(students);

            for (var s = 0; s < shuffledStudents.length; s++) {
                var student = shuffledStudents[s];
                // Round-robin over shuffled instructors -> even spread, still random.
                var instructor = shuffledInstructors[s % shuffledInstructors.length];
                assignedThisRun[student.id] = true;

                // 1) In-training role.
                var roleOk = true;
                try {
                    await student.roles.add(inTrainingRoleId, 'Assigned for ' + dept.label + ' training');
                } catch (err) {
                    roleOk = false;
                    console.error('[CommenceTraining] role add failed for', student.id, err);
                }

                // 2) Persist the assignment.
                try {
                    await TrainingAssignment.create({
                        studentId: student.id,
                        studentUsername: student.user.username,
                        instructorId: instructor.id,
                        instructorUsername: instructor.user.username,
                        department: dept.key,
                        status: 'active',
                    });
                } catch (err) {
                    console.error('[CommenceTraining] assignment save failed:', err);
                }

                // 3) DM both sides; cross-notify if one has DMs closed.
                var instructorOk = await safeDM(instructor, instructorDM(student, dept.label));
                var studentOk = await safeDM(student, studentDM(instructor, dept.label));

                if (!studentOk) {
                    await safeDM(instructor, 'Heads up: your assigned student **' + student.user.username +
                        '** (<@' + student.id + '>) has DMs closed \u2014 please reach out to them directly.');
                    dmNotes.push('Student <@' + student.id + '> has DMs closed (instructor <@' + instructor.id + '> notified).');
                }
                if (!instructorOk) {
                    await safeDM(student, 'Heads up: your assigned instructor **' + instructor.user.username +
                        '** (<@' + instructor.id + '>) has DMs closed \u2014 please reach out to them directly.');
                    dmNotes.push('Instructor <@' + instructor.id + '> has DMs closed (student <@' + student.id + '> notified).');
                }

                results.push({ deptLabel: dept.label, student: student, instructor: instructor, roleOk: roleOk });
            }
        }

        if (results.length === 0 && skippedNoInstructor.length === 0) {
            return interaction.editReply({ content: 'No eligible students were found to assign.' });
        }

        var lines = [];
        var byDept = {};
        results.forEach(function(r) {
            (byDept[r.deptLabel] = byDept[r.deptLabel] || []).push(r);
        });
        Object.keys(byDept).forEach(function(deptLabel) {
            lines.push('**' + deptLabel + '** \u2014 ' + byDept[deptLabel].length + ' assigned');
            byDept[deptLabel].forEach(function(r) {
                lines.push('\u2022 <@' + r.student.id + '> \u2192 <@' + r.instructor.id + '>' + (r.roleOk ? '' : ' \u26a0\ufe0f role not added'));
            });
        });
        skippedNoInstructor.forEach(function(sk) {
            lines.push('\u23ed\ufe0f **' + sk.deptLabel + '** \u2014 skipped ' + sk.count + ' student(s), no available instructor');
        });
        if (dmNotes.length) {
            lines.push('');
            lines.push('**DM issues:**');
            dmNotes.forEach(function(n) { lines.push('\u2022 ' + n); });
        }

        var summary = new EmbedBuilder()
            .setColor(ids.EMBED_COLOR)
            .setTitle('Training Commenced')
            .setDescription(lines.join('\n').slice(0, 4000))
            .setFooter({ text: 'United Aviate \u2022 ' + results.length + ' assignment(s)' })
            .setTimestamp();

        return interaction.editReply({ embeds: [summary] });
    },
};
