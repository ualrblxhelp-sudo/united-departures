const { EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const ids = require('../../config/ids');
const TraineeProfile = require('../../models/TraineeProfile');
const TrainingAssignment = require('../../models/TrainingAssignment');
const trainingPanel = require('../../utils/trainingPanel');

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

function studentMessage(instructor) {
    return `-# _ _
> ### <:uaaviate_staff:1465428477132935251>**Stage 2: Instructional Training**
-# **Training Assignment** — The Presidency

> Firstly, congratulations on passing your orientation exam. We are delighted to see your progress through the Aviate Academy with such brightness. At Stage 2, you will go through a **hands-on** training session at our hub in Chicago and Newark. You will learn about the items, tasks, and controls necessary to become a successful employee at United Airlines.You will now be **assigned** **an instructor, who will lead your growth and training curriculum for your program in the United Aviate Academy.**

<:uaaviate_info:1465428271637201034> If you would like to request a training session, please contact your **trainer**, <@${instructor.id}>, or **@**${instructor.user.username}. Please direct message them, as they most likely will not respond to you if you contact them in this server. Additionally, if an Instructor remains **ignorant** to your requests, please contact an executive with your complaints.

<:uaaviate_staff:1465428477132935251> **Charles L.**
> -# President, United Airlines`;
}

function instructorMessage(students) {
    var list = students.map(function(st) { return '> - <@' + st.id + '>'; }).join('\n');
    return `-# _ _
> ### <:uaaviate_staff:1465428477132935251>**Instructional Training Assignment**
-# **Training Assignment** — The Presidency

> Hello, Instructor! Due to the new hiring batch of students, you will be assigned to **train** an individual, or multiple individuals depending on your luck. Please instruct them with regards to our **training guidelines** and instruct them with **discipline, quality, and kindness**. For every session you commence and train an individual, please **log** it using the **/attendance** command in the Aviate Server. Once you are done training your trainee and your student has graduated, please use the **/traininglog** command to indicate the **user** who has graduated. This will log the user who graduated in our database.

<:ua_1:1331079891193696331> Your trainee list is listed below, please contact them as soon as possible.
${list}

<:uaaviate_staff:1465428477132935251> **Charles L.**
> -# President, United Airlines`;
}

async function primeTrainingMembers(guild) {
    try {
        var after = undefined;
        var total = 0;
        var pages = 0;

        while (true) {
            var batch = await guild.members.list({ after: after, limit: 1000, cache: true });
            if (!batch || batch.size === 0) break;

            total += batch.size;
            pages += 1;
            after = batch.lastKey();

            if (batch.size < 1000) break;
        }

        return {
            ok: true,
            mode: 'rest',
            note: total > 0 ? 'Loaded ' + total + ' member(s) across ' + pages + ' page(s) using the REST member list.' : '',
        };
    } catch (err) {
        var cachedCount = guild.members.cache ? guild.members.cache.size : 0;
        console.error('[CommenceTraining] members.list failed:', err);
        if (cachedCount > 0) {
            return {
                ok: true,
                mode: 'cache',
                note: 'REST member loading failed, so assignments were generated from the currently cached member list only.',
                error: err,
            };
        }
        return { ok: false, mode: 'none', error: err };
    }
}

async function runAssignmentPass(interaction, options) {
    options = options || {};

    if (interaction.guildId !== ids.AVIATE_SERVER_ID) {
        return interaction.reply({ content: 'This command can only be used in the United Aviate server.', flags: MessageFlags.Ephemeral });
    }
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Only server administrators can use this command.', flags: MessageFlags.Ephemeral });
    }

    if (!options.skipDefer) {
        await interaction.reply({ content: 'Building training assignments...', flags: MessageFlags.Ephemeral });
    }

    var guild = interaction.guild;
    var instructorRoleId = ids.TRAINING_STAFF_ROLE_ID;

    // Load the full member list so role-based matching is accurate.
    // This also ensures role add/remove later in the pass has live members.
    var memberPrime = await primeTrainingMembers(guild);
    if (!memberPrime.ok) {
        var fetchReason = memberPrime.error && memberPrime.error.message ? memberPrime.error.message : 'unknown error';
        return interaction.editReply({ content: 'Could not load the member list for training assignments. Fetch error: `' + fetchReason + '`' });
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
        var allAssignments = [];      // { student, instructor, deptLabel }
        var byInstructor = {};        // instructorId -> { instructor, students: [] }
        var skippedNoInstructor = []; // { deptLabel, count }

        // ---- 1) Match students to instructors, assign role + save record ----
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
                if (alreadyAssigned[member.id]) return;                // has an active assignment
                if (assignedThisRun[member.id]) return;                // assigned earlier this run
                var done = completedByUser[member.id] || [];
                if (done.indexOf(dept.key) !== -1) return;             // already completed this dept
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
                var instructor = shuffledInstructors[s % shuffledInstructors.length]; // even, random spread
                assignedThisRun[student.id] = true;

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

                await student.roles.add(ids.TRAINING_INTRAINING_ROLE_ID).catch(function () {});

                allAssignments.push({ student: student, instructor: instructor, deptLabel: dept.label });
                if (!byInstructor[instructor.id]) {
                    byInstructor[instructor.id] = { instructor: instructor, students: [] };
                }
                byInstructor[instructor.id].students.push(student);
            }
        }

        if (allAssignments.length === 0 && skippedNoInstructor.length === 0) {
            return interaction.editReply({ content: 'No eligible students were found to assign.' });
        }

        // ---- 2) DM students (one each), then instructors (one grouped each) ----
        var studentDMFailed = {};
        for (var i = 0; i < allAssignments.length; i++) {
            var a = allAssignments[i];
            var ok = await safeDM(a.student, { content: studentMessage(a.instructor) });
            if (!ok) studentDMFailed[a.student.id] = true;
        }

        var instructorDMFailed = {};
        var instructorIds = Object.keys(byInstructor);
        for (var g = 0; g < instructorIds.length; g++) {
            var grp = byInstructor[instructorIds[g]];
            var okI = await safeDM(grp.instructor, { content: instructorMessage(grp.students) });
            if (!okI) instructorDMFailed[grp.instructor.id] = true;
        }

        // ---- 3) Cross-notify closed DMs (best effort) ----
        for (var gi = 0; gi < instructorIds.length; gi++) {
            var grp2 = byInstructor[instructorIds[gi]];
            if (instructorDMFailed[grp2.instructor.id]) {
                for (var st = 0; st < grp2.students.length; st++) {
                    await safeDM(grp2.students[st], 'Heads up: your assigned instructor **' + grp2.instructor.user.username +
                        '** (<@' + grp2.instructor.id + '>) has DMs closed — please reach out to them directly.');
                }
            }
        }
        for (var ai = 0; ai < allAssignments.length; ai++) {
            var a2 = allAssignments[ai];
            if (studentDMFailed[a2.student.id] && !instructorDMFailed[a2.instructor.id]) {
                await safeDM(a2.instructor, 'Heads up: your assigned trainee **' + a2.student.user.username +
                    '** (<@' + a2.student.id + '>) has DMs closed — please reach out to them directly.');
            }
        }

        // ---- 4) Admin summary ----
        var lines = [];
        instructorIds.forEach(function(iid) {
            var grp3 = byInstructor[iid];
            lines.push('**<@' + grp3.instructor.id + '>** — ' + grp3.students.length + ' trainee(s)');
            grp3.students.forEach(function(stM) {
                lines.push('\u2022 <@' + stM.id + '>');
            });
        });

        skippedNoInstructor.forEach(function(sk) {
            lines.push('\u23ed\ufe0f **' + sk.deptLabel + '** — skipped ' + sk.count + ' student(s), no available instructor');
        });

        var closedStudents = Object.keys(studentDMFailed);
        var closedInstructors = Object.keys(instructorDMFailed);
        if (closedStudents.length || closedInstructors.length) {
            lines.push('');
            lines.push('**DM issues:**');
            closedStudents.forEach(function(id) { lines.push('\u2022 Student <@' + id + '> has DMs closed'); });
            closedInstructors.forEach(function(id) { lines.push('\u2022 Instructor <@' + id + '> has DMs closed'); });
        }

        var summary = new EmbedBuilder()
            .setColor(ids.EMBED_COLOR)
            .setTitle(options.summaryTitle || 'Training Commenced')
            .setDescription(lines.join('\n').slice(0, 4000))
            .setFooter({ text: 'United Aviate \u2022 ' + allAssignments.length + ' assignment(s)' })
            .setTimestamp();

        if (options.summaryNote) {
            summary.addFields({ name: 'Reset Note', value: options.summaryNote.slice(0, 1024) });
        }
        if (memberPrime.note) {
            summary.addFields({ name: 'Member Fetch Note', value: memberPrime.note.slice(0, 1024) });
        }

        trainingPanel.syncTrainingPanel(interaction.client).catch(function (err) {
            console.error('[CommenceTraining] Panel sync error:', err);
        });

        return interaction.editReply({ embeds: [summary] });
}

module.exports = {
    async execute(interaction) {
        return runAssignmentPass(interaction);
    },
    runAssignmentPass: runAssignmentPass,
};
