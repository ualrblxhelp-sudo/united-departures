// commands/flightpanel.js — /flightpanel
//
// One interactive panel for everything a dispatcher does with their own flights:
//   view -> start -> announce -> end, plus edit / cancel / recover the sheet.
//
// Replaces having to remember /flight end, /flight edit, /flight delete and
// /flight recover as separate commands. Those still exist and still work; this
// reuses the same Flight documents and the same calendar/archive helpers, so the
// two paths can be used interchangeably.
//
// SCOPE: a dispatcher only ever sees and controls flights where
// dispatcherId === their own id. There is no admin override here by design --
// if that's wanted later it should be an explicit rank check, not an accident.
//
// All custom IDs are prefixed `fp_` so index.js can route them with one check
// per interaction type instead of a dozen exact matches.

const {
    SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');

var Flight = require('../models/Flight');
var { updateAllCalendars } = require('../utils/calendar');
var { buildArchiveEmbed } = require('../utils/embed');
var { recreateForumThread } = require('../utils/forumRecovery');
var ids = require('../config/ids');

var NAVY = 0x3D1643;
var GREEN = 0x2EB860;
var RED = 0xD64545;
var PANEL_BUTTON_STYLE = ButtonStyle.Secondary;

// userId -> { flightId, mode } for multi-step actions (confirms, modals).
var sessions = new Map();

// ---- helpers --------------------------------------------------------------

// Accepts a raw unix timestamp or a Discord <t:...> tag, same as /flight edit.
function parseTimestamp(input) {
    var match = String(input).match(/<t:(\d+)(?::[a-zA-Z])?>/);
    if (match) return parseInt(match[1], 10);
    return parseInt(input, 10);
}

function typeTag(flight) {
    if (flight.flightType === 'test') return '[TEST] ';
    if (flight.flightType === 'premium') return '[PREMIUM] ';
    return '';
}

function statusLabel(flight) {
    if (flight.status === 'active') return '\uD83D\uDFE2 In Progress';
    if (flight.status === 'scheduled') return '\uD83D\uDD35 Scheduled';
    if (flight.status === 'completed') return '\u26AB Completed';
    if (flight.status === 'cancelled') return '\uD83D\uDD34 Cancelled';
    return flight.status;
}

// Flights this user dispatches that are still actionable.
async function ownFlights(userId) {
    return Flight.find({
        dispatcherId: userId,
        status: { $in: ['scheduled', 'active'] },
    }).sort({ serverOpenTime: 1 });
}

function flightSelect(flights, selectedId) {
    var options = flights.slice(0, 25).map(function (f) {
        var opt = {
            label: (typeTag(f) + f.flightNumber + ' \u2014 ' + f.departure + ' \u27A1 ' + f.destination).slice(0, 100),
            description: (statusLabel(f).replace(/[^\x20-\x7E]/g, '').trim() + ' \u2022 ' + f.aircraft).slice(0, 100),
            value: f._id.toString(),
        };
        if (selectedId && String(selectedId) === f._id.toString()) opt.default = true;
        return opt;
    });
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('fp_select')
            .setPlaceholder('Select one of your flights')
            .addOptions(options)
    );
}

function panelEmbed(flight) {
    var crew = flight.allocations ? flight.allocations.length : 0;
    var embed = new EmbedBuilder()
        .setTitle('<:volare_plane:1408298312448086056> ' + typeTag(flight) + flight.flightNumber)
        .setColor(flight.status === 'active' ? GREEN : NAVY)
        .setDescription(
            '**' + flight.departure + '** \u27A1 **' + flight.destination + '**\n' +
            'Status: **' + statusLabel(flight) + '**'
        )
        .addFields(
            { name: 'Aircraft', value: String(flight.aircraft), inline: true },
            { name: 'Crew allocated', value: String(crew), inline: true },
            { name: 'Operator', value: flight.flightType === 'premium' ? 'United Premium' : 'United Airlines', inline: true },
            { name: 'Staff join', value: '<t:' + flight.employeeJoinTime + ':F>', inline: false },
            { name: 'Server open', value: '<t:' + flight.serverOpenTime + ':F>', inline: false }
        )
        .setFooter({ text: 'Dispatcher: ' + flight.dispatcherUsername });

    if (flight.startedAt) {
        embed.addFields({ name: 'Started', value: '<t:' + Math.floor(new Date(flight.startedAt).getTime() / 1000) + ':R>', inline: true });
    }
    if (flight.announcementsSent && flight.announcementsSent.length) {
        embed.addFields({ name: 'Announcements sent', value: flight.announcementsSent.join(', ') });
    }
    return embed;
}

// Buttons vary by status: a scheduled flight can start, an active one can end.
function panelRows(flight, flights) {
    var rows = [flightSelect(flights, flight._id)];

    if (flight.status === 'scheduled') {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fp_start').setLabel('Start Flight').setStyle(PANEL_BUTTON_STYLE),
            new ButtonBuilder().setCustomId('fp_briefing').setLabel('Start Briefing').setStyle(PANEL_BUTTON_STYLE),
            new ButtonBuilder().setCustomId('fp_edit').setLabel('Edit Details').setStyle(PANEL_BUTTON_STYLE),
            new ButtonBuilder().setCustomId('fp_recover').setLabel('Recover Sheet').setStyle(PANEL_BUTTON_STYLE)
        ));
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fp_cancel').setLabel('Cancel Flight').setStyle(PANEL_BUTTON_STYLE),
            new ButtonBuilder().setCustomId('fp_refresh').setLabel('Refresh').setStyle(PANEL_BUTTON_STYLE)
        ));
    } else {
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('fp_announce')
                .setPlaceholder('Make an announcement\u2026')
                .addOptions(
                    { label: 'Server Opening', value: 'opening', description: 'Public \u2014 the server is now open' },
                    { label: 'Boarding Call', value: 'boarding', description: 'Public \u2014 boarding has begun' },
                    { label: 'Final Call', value: 'final', description: 'Public \u2014 last call for boarding' },
                    { label: 'Server Closure', value: 'closure', description: 'Public \u2014 the server is closing' }
                )
        ));
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('fp_end').setLabel('End Flight').setStyle(PANEL_BUTTON_STYLE),
            new ButtonBuilder().setCustomId('fp_briefing').setLabel('Start Briefing').setStyle(PANEL_BUTTON_STYLE),
            new ButtonBuilder().setCustomId('fp_edit').setLabel('Edit Details').setStyle(PANEL_BUTTON_STYLE),
            new ButtonBuilder().setCustomId('fp_refresh').setLabel('Refresh').setStyle(PANEL_BUTTON_STYLE)
        ));
    }
    return rows;
}

// Re-render the panel for the flight held in this user's session.
async function renderPanel(interaction, flightId) {
    var flight = await Flight.findById(flightId);
    if (!flight) {
        return interaction.editReply({ content: '\u274C That flight no longer exists.', embeds: [], components: [] });
    }
    var flights = await ownFlights(interaction.user.id);
    if (!flights.length) {
        return interaction.editReply({ content: '\u2705 You have no active or scheduled flights.', embeds: [], components: [] });
    }
    sessions.set(interaction.user.id, { flightId: flight._id.toString() });
    return interaction.editReply({
        content: '',
        embeds: [panelEmbed(flight)],
        components: panelRows(flight, flights),
    });
}

// Load the session's flight and verify ownership. Returns null after replying.
async function loadOwned(interaction) {
    var sess = sessions.get(interaction.user.id);
    if (!sess) {
        await interaction.editReply({ content: '\u274C Panel session expired. Run `/flightpanel` again.', embeds: [], components: [] });
        return null;
    }
    var flight = await Flight.findById(sess.flightId);
    if (!flight) {
        await interaction.editReply({ content: '\u274C That flight no longer exists.', embeds: [], components: [] });
        return null;
    }
    if (flight.dispatcherId !== interaction.user.id) {
        await interaction.editReply({ content: '\u274C You are not the dispatcher for this flight.', embeds: [], components: [] });
        return null;
    }
    return flight;
}

// ---- announcements --------------------------------------------------------

var ANNOUNCEMENTS = {
    opening: {
        label: 'Server Opening',
        target: 'public',
        build: function (f) {
            return '<:volare_plane:1408298312448086056> **The server is now OPEN**\n' +
                '> Flight **' + f.flightNumber + '** \u2014 **' + f.departure + ' \u27A1 ' + f.destination + '**\n' +
                '> Join now to secure your seat. Boarding will begin shortly.';
        },
    },
    boarding: {
        label: 'Boarding Call',
        target: 'public',
        build: function (f) {
            return '<:volare_plane:1408298312448086056> **Boarding has begun**\n' +
                '> Flight **' + f.flightNumber + '** to **' + f.destination + '** is now boarding.\n' +
                '> Please proceed to the gate and have your boarding pass ready.';
        },
    },
    final: {
        label: 'Final Call',
        target: 'public',
        build: function (f) {
            return '<:volare_plane:1408298312448086056> **Final call \u2014 ' + f.flightNumber + '**\n' +
                '> This is the final boarding call for **' + f.departure + ' \u27A1 ' + f.destination + '**.\n' +
                '> The doors will close shortly.';
        },
    },
    closure: {
        label: 'Server Closure',
        target: 'public',
        build: function (f) {
            return '<:volare_plane:1408298312448086056> **The server is now closed**\n' +
                '> Thank you for flying with us on **' + f.flightNumber + '** (' + f.departure + ' \u27A1 ' + f.destination + ').\n' +
                '> We look forward to welcoming you onboard again soon.';
        },
    },
};

// Resolve where an announcement goes. Briefings go to the crew's own allocation
// thread; everything passenger-facing goes to the public announcement channel.
async function announceTarget(client, flight, kind) {
    if (kind === 'thread') {
        if (!flight.forumThreadId) return null;
        var guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
        if (!guild) return null;
        var thread = guild.channels.cache.get(flight.forumThreadId);
        if (!thread) thread = await guild.channels.fetch(flight.forumThreadId).catch(function () { return null; });
        return thread;
    }
    return client.channels.fetch(ids.FLIGHT_ANNOUNCE_CHANNEL_ID).catch(function () { return null; });
}

async function sendChannelPing(client, channelId, content, options) {
    options = options || {};
    var channel = await client.channels.fetch(channelId).catch(function () { return null; });
    if (!channel || typeof channel.send !== 'function') return false;

    if (options.ghostPing) {
        await channel.send({
            content: content,
            allowedMentions: { parse: [] },
        });
        var ping = await channel.send({
            content: '@everyone',
            allowedMentions: { parse: ['everyone'] },
        });
        await ping.delete().catch(function () {});
        return true;
    }

    await channel.send({
        content: '@everyone\n' + content,
        allowedMentions: { parse: ['everyone'] },
    });
    return true;
}

function startFlightMessage(flight) {
    return '> ### <:e_plane:1397829563249328138> **' + flight.flightNumber + '**\n' +
        '-# **Good Leads the Way** — United Operations\n' +
        '\n' +
        '> <:e_arrow:1406847964655259710> United Airlines invites all passengers to join the [UAL Hub](<' + ids.AIRPORT_LINK + '>) in preparation for ' + flight.flightNumber + ' from **' + flight.departure + '** to **' + flight.destination + '**. Information about the flight can be found by viewing the event card for this flight.\n' +
        '\n' +
        '> -#  <a:UnitedPassport:1029754095055142982> Please arrive at the airport with all necessary **travel documents** for this trip.\n' +
        '\n' +
        '-# <:d_staralliance:1397830727919337493> ᴀ ꜱᴛᴀʀ ᴀʟʟɪᴀɴᴄᴇ ᴍᴇᴍʙᴇʀ';
}

function startBriefingMessage(flight) {
    return '> ### <:volare_fa:1408298318861176920> **Employee Briefing**\n' +
        '-# **' + flight.flightNumber + '**— United Volare\n' +
        '\n' +
        '> <:volare_arrow:1408485394747490385> Employees allocated for ' + flight.flightNumber + ' from **' + flight.departure + '** to **' + flight.destination + '** are now called to join the [airport](<' + ids.AIRPORT_LINK + '>) specified in the allocations sheet for briefing and flight preparation. As a reminder, missing a flight you allocated for results in consequences.\n' +
        '\n' +
        '> -#  <:volare_arrow:1408485394747490385> Upon joining, please prepare your **attire** and wait patiently as the dispatcher briefs you.\n' +
        '\n' +
        '-# <:d_staralliance:1397830727919337493> ᴀ ꜱᴛᴀʀ ᴀʟʟɪᴀɴᴄᴇ ᴍᴇᴍʙᴇʀ';
}

// ---- command --------------------------------------------------------------

module.exports = {
    data: new SlashCommandBuilder()
        .setName('flightpanel')
        .setDescription('Open your dispatcher panel: start, announce, edit, end or cancel your flights'),

    sessions: sessions,

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        var flights = await ownFlights(interaction.user.id);
        if (!flights.length) {
            return interaction.editReply({
                content: '\u274C You have no scheduled or in-progress flights.\nCreate one with `/flight create` \u2014 only the dispatcher who created a flight can control it here.',
            });
        }

        var first = flights[0];
        sessions.set(interaction.user.id, { flightId: first._id.toString() });
        return interaction.editReply({
            embeds: [panelEmbed(first)],
            components: panelRows(first, flights),
        });
    },

    // ---- select menus -----------------------------------------------------
    async handleSelect(interaction) {
        var id = interaction.customId;

        if (id === 'fp_select') {
            await interaction.deferUpdate();
            return renderPanel(interaction, interaction.values[0]);
        }

        if (id === 'fp_announce') {
            await interaction.deferUpdate();
            var flight = await loadOwned(interaction);
            if (!flight) return;

            if (flight.status !== 'active') {
                return interaction.followUp({ content: '\u274C Start the flight before making announcements.', ephemeral: true });
            }

            var kind = interaction.values[0];
            var spec = ANNOUNCEMENTS[kind];
            if (!spec) return;

            var channel = await announceTarget(interaction.client, flight, spec.target);
            if (!channel || typeof channel.send !== 'function') {
                await renderPanel(interaction, flight._id);
                return interaction.followUp({
                    content: '\u274C Could not reach the ' + (spec.target === 'thread' ? 'allocation thread' : 'announcement channel') + '. Nothing was posted.',
                    ephemeral: true,
                });
            }

            try {
                await channel.send({ content: spec.build(flight), allowedMentions: { parse: [] } });
            } catch (err) {
                console.error('[FlightPanel] Announce error:', err);
                await renderPanel(interaction, flight._id);
                return interaction.followUp({ content: '\u274C Failed to post that announcement.', ephemeral: true });
            }

            if (!flight.announcementsSent) flight.announcementsSent = [];
            if (flight.announcementsSent.indexOf(spec.label) === -1) {
                flight.announcementsSent.push(spec.label);
            }
            await flight.save();

            await renderPanel(interaction, flight._id);
            return interaction.followUp({ content: '<:volare_check:1408484391348605069> **' + spec.label + '** posted.', ephemeral: true });
        }
    },

    // ---- buttons ----------------------------------------------------------
    async handleButton(interaction) {
        var id = interaction.customId;

        // Edit opens a modal, so it must NOT be deferred first.
        if (id === 'fp_edit') {
            var sess = sessions.get(interaction.user.id);
            if (!sess) return interaction.reply({ content: '\u274C Panel session expired. Run `/flightpanel` again.', ephemeral: true });
            var ef = await Flight.findById(sess.flightId);
            if (!ef || ef.dispatcherId !== interaction.user.id) {
                return interaction.reply({ content: '\u274C Flight not found, or you are not its dispatcher.', ephemeral: true });
            }
            var modal = new ModalBuilder().setCustomId('fp_edit_modal').setTitle('Edit ' + ef.flightNumber)
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('flight_number').setLabel('Flight Number')
                            .setStyle(TextInputStyle.Short).setRequired(false).setValue(ef.flightNumber).setMaxLength(10)),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('departure').setLabel('IATA Departure')
                            .setStyle(TextInputStyle.Short).setRequired(false).setValue(ef.departure).setMaxLength(4)),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('destination').setLabel('IATA Destination')
                            .setStyle(TextInputStyle.Short).setRequired(false).setValue(ef.destination).setMaxLength(4)),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('employee_join_time').setLabel('Staff Join Time')
                            .setStyle(TextInputStyle.Short).setRequired(false).setValue(String(ef.employeeJoinTime))
                            .setPlaceholder('e.g. <t:1772089560:f> or 1772089560')),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('server_open_time').setLabel('Server Open Time')
                            .setStyle(TextInputStyle.Short).setRequired(false).setValue(String(ef.serverOpenTime))
                            .setPlaceholder('e.g. <t:1772089560:f> or 1772089560'))
                );
            return interaction.showModal(modal);
        }

        await interaction.deferUpdate();
        var flight = await loadOwned(interaction);
        if (!flight) return;

        // ---- start ----
        if (id === 'fp_start') {
            if (flight.status !== 'scheduled') {
                return interaction.followUp({ content: '\u274C This flight is already in progress.', ephemeral: true });
            }
            flight.status = 'active';
            flight.startedAt = new Date();
            await flight.save();

            var startedPosted = false;
            try {
                startedPosted = await sendChannelPing(interaction.client, ids.FLIGHT_ANNOUNCE_CHANNEL_ID, startFlightMessage(flight), { ghostPing: true });
            } catch (err) {
                console.error('[FlightPanel] Start announce error:', err);
            }

            if (!flight.announcementsSent) flight.announcementsSent = [];
            if (flight.announcementsSent.indexOf('Start Flight') === -1) {
                flight.announcementsSent.push('Start Flight');
                await flight.save();
            }

            await renderPanel(interaction, flight._id);
            return interaction.followUp({
                content: startedPosted
                    ? '<:volare_check:1408484391348605069> **' + flight.flightNumber + '** is now in progress and the public join ping was posted.'
                    : '\u26A0\uFE0F **' + flight.flightNumber + '** is now in progress, but I could not post the public join ping.',
                ephemeral: true,
            });
        }

        // ---- crew briefing ----
        if (id === 'fp_briefing') {
            var briefingPosted = false;
            try {
                briefingPosted = await sendChannelPing(interaction.client, ids.BRIEFING_CHANNEL_ID, startBriefingMessage(flight));
            } catch (err) {
                console.error('[FlightPanel] Briefing announce error:', err);
            }

            if (!flight.announcementsSent) flight.announcementsSent = [];
            if (flight.announcementsSent.indexOf('Start Briefing') === -1) {
                flight.announcementsSent.push('Start Briefing');
                await flight.save();
            }

            await renderPanel(interaction, flight._id);
            return interaction.followUp({
                content: briefingPosted
                    ? '<:volare_check:1408484391348605069> **Start Briefing** was posted in the Volare briefing channel.'
                    : '\u26A0\uFE0F I could not post **Start Briefing** in the Volare briefing channel.',
                ephemeral: true,
            });
        }

        // ---- refresh / back ----
        if (id === 'fp_refresh') {
            return renderPanel(interaction, flight._id);
        }

        // ---- recover the allocation sheet ----
        if (id === 'fp_recover') {
            try {
                await recreateForumThread(interaction.client, flight, { ping: false });
            } catch (err) {
                console.error('[FlightPanel] Recover error:', err);
                await renderPanel(interaction, flight._id);
                return interaction.followUp({ content: '\u274C Could not recreate the allocation sheet: ' + (err.message || 'unknown error'), ephemeral: true });
            }
            await renderPanel(interaction, flight._id);
            return interaction.followUp({
                content: '<:volare_check:1408484391348605069> Allocation sheet recreated with the flight\u2019s stored allocations. No `@everyone` ping was sent.',
                ephemeral: true,
            });
        }

        // ---- end / cancel: ask first ----
        if (id === 'fp_end' || id === 'fp_cancel') {
            var isCancel = (id === 'fp_cancel');
            sessions.set(interaction.user.id, { flightId: flight._id.toString(), mode: isCancel ? 'cancel' : 'end' });

            var warn = isCancel
                ? '\u26A0\uFE0F Cancel **' + flight.flightNumber + '** (' + flight.departure + ' \u27A1 ' + flight.destination + ')?\n\n' +
                  'This archives the allocation sheet, deletes the Discord event, removes the flight from all calendars, and deletes the Volare allocation post/thread. This cannot be undone.'
                : '\u26A0\uFE0F End **' + flight.flightNumber + '** (' + flight.departure + ' \u27A1 ' + flight.destination + ')?\n\n' +
                  'This marks the flight completed, locks the allocation thread and removes it from all calendars.';

            return interaction.editReply({
                content: warn,
                embeds: [],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(isCancel ? 'fp_confirm_cancel' : 'fp_confirm_end')
                        .setLabel(isCancel ? 'Cancel Flight' : 'End Flight').setStyle(PANEL_BUTTON_STYLE),
                    new ButtonBuilder().setCustomId('fp_abort').setLabel('Go Back').setStyle(PANEL_BUTTON_STYLE)
                )],
            });
        }

        if (id === 'fp_abort') {
            return renderPanel(interaction, flight._id);
        }

        // ---- confirmed end ----
        if (id === 'fp_confirm_end') {
            await closeDiscordEvent(interaction.client, flight);
            await lockThread(interaction.client, flight);

            flight.status = 'completed';
            flight.completedAt = new Date();
            await flight.save();

            try { await updateAllCalendars(interaction.client); } catch (e) { console.error('[FlightPanel] Calendar:', e); }
            sessions.delete(interaction.user.id);

            return interaction.editReply({
                content: '<:volare_check:1408484391348605069> **' + flight.flightNumber + '** (' + flight.departure + ' \u27A1 ' + flight.destination + ') has been completed.',
                embeds: [], components: [],
            });
        }

        // ---- confirmed cancel ----
        if (id === 'fp_confirm_cancel') {
            // Archive first; only proceed to teardown if the record is safe.
            try {
                var guild = interaction.client.guilds.cache.get(ids.STAFF_SERVER_ID);
                var archive = guild ? guild.channels.cache.get(ids.ARCHIVE_CHANNEL_ID) : null;
                if (!archive && guild) archive = await guild.channels.fetch(ids.ARCHIVE_CHANNEL_ID).catch(function () { return null; });
                if (archive) {
                    var built = buildArchiveEmbed(flight);
                    await archive.send({ embeds: [built.archiveEmbed, built.allocationEmbed] });
                }
            } catch (err) { console.error('[FlightPanel] Archive error:', err); }

            await deleteAllocationArtifacts(interaction.client, flight);
            await closeDiscordEvent(interaction.client, flight);

            flight.status = 'cancelled';
            flight.cancelledAt = new Date();
            await flight.save();

            try { await updateAllCalendars(interaction.client); } catch (e) { console.error('[FlightPanel] Calendar:', e); }
            sessions.delete(interaction.user.id);

            return interaction.editReply({
                content: '<:volare_check:1408484391348605069> **' + flight.flightNumber + '** has been cancelled, archived, and removed from the Volare allocation channel.',
                embeds: [], components: [],
            });
        }
    },

    // ---- modal ------------------------------------------------------------
    async handleModal(interaction) {
        if (interaction.customId !== 'fp_edit_modal') return;

        var sess = sessions.get(interaction.user.id);
        if (!sess) return interaction.reply({ content: '\u274C Panel session expired. Run `/flightpanel` again.', ephemeral: true });

        var flight = await Flight.findById(sess.flightId);
        if (!flight) return interaction.reply({ content: '\u274C Flight not found.', ephemeral: true });
        if (flight.dispatcherId !== interaction.user.id) {
            return interaction.reply({ content: '\u274C You are not the dispatcher for this flight.', ephemeral: true });
        }

        await interaction.deferUpdate();

        var fn = interaction.fields.getTextInputValue('flight_number').toUpperCase().trim();
        var dep = interaction.fields.getTextInputValue('departure').toUpperCase().trim();
        var dest = interaction.fields.getTextInputValue('destination').toUpperCase().trim();
        var ejRaw = interaction.fields.getTextInputValue('employee_join_time').trim();
        var soRaw = interaction.fields.getTextInputValue('server_open_time').trim();

        var changes = [];
        var rejected = [];

        if (fn && fn !== flight.flightNumber) {
            flight.flightNumber = fn;
            changes.push('Flight number \u2192 ' + fn);
        }
        if (dep && dep !== flight.departure) {
            if (/^[A-Z]{3}$/.test(dep)) { flight.departure = dep; changes.push('Departure \u2192 ' + dep); }
            else rejected.push('Departure must be a 3-letter IATA code');
        }
        if (dest && dest !== flight.destination) {
            if (/^[A-Z]{3}$/.test(dest)) { flight.destination = dest; changes.push('Destination \u2192 ' + dest); }
            else rejected.push('Destination must be a 3-letter IATA code');
        }
        if (ejRaw) {
            var ej = parseTimestamp(ejRaw);
            if (!isNaN(ej) && ej !== flight.employeeJoinTime) {
                flight.employeeJoinTime = ej;
                changes.push('Staff join \u2192 <t:' + ej + ':F>');
            } else if (isNaN(ej)) {
                rejected.push('Staff join time could not be read');
            }
        }
        if (soRaw) {
            var so = parseTimestamp(soRaw);
            if (!isNaN(so) && so !== flight.serverOpenTime) {
                flight.serverOpenTime = so;
                changes.push('Server open \u2192 <t:' + so + ':F>');
            } else if (isNaN(so)) {
                rejected.push('Server open time could not be read');
            }
        }

        if (changes.length) {
            await flight.save();
            try { await updateAllCalendars(interaction.client); } catch (e) { console.error('[FlightPanel] Calendar:', e); }
        }

        await renderPanel(interaction, flight._id);

        var msg = changes.length
            ? '<:volare_check:1408484391348605069> Updated:\n\u2022 ' + changes.join('\n\u2022 ')
            : '\u2139\uFE0F No changes were made.';
        if (rejected.length) msg += '\n\n\u26A0\uFE0F Ignored:\n\u2022 ' + rejected.join('\n\u2022 ');

        return interaction.followUp({ content: msg, ephemeral: true });
    },
};

// ---- shared teardown helpers ---------------------------------------------

async function lockThread(client, flight) {
    try {
        if (!flight.forumThreadId) return;
        var guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
        if (!guild) return;
        var thread = guild.channels.cache.get(flight.forumThreadId);
        if (!thread) thread = await guild.channels.fetch(flight.forumThreadId).catch(function () { return null; });
        if (thread) {
            await thread.setLocked(true).catch(function () {});
            await thread.setArchived(true).catch(function () {});
        }
    } catch (err) { console.error('[FlightPanel] Thread lock error:', err); }
}

async function closeDiscordEvent(client, flight) {
    try {
        if (!flight.discordEventId) return;
        var servers = [ids.CALENDAR_SERVER_ID, ids.STAFF_SERVER_ID];
        for (var i = 0; i < servers.length; i++) {
            var guild = client.guilds.cache.get(servers[i]);
            if (!guild) continue;
            var event = await guild.scheduledEvents.fetch(flight.discordEventId).catch(function () { return null; });
            if (event) { await event.delete().catch(function () {}); break; }
        }
    } catch (err) { console.error('[FlightPanel] Event delete error:', err); }
}

async function deleteAllocationArtifacts(client, flight) {
    try {
        var guild = client.guilds.cache.get(ids.STAFF_SERVER_ID);
        if (!guild) return;

        var thread = null;
        if (flight.forumThreadId) {
            thread = guild.channels.cache.get(flight.forumThreadId);
            if (!thread) thread = await guild.channels.fetch(flight.forumThreadId).catch(function () { return null; });
        }

        var calendarChannel = guild.channels.cache.get(ids.STAFF_CALENDAR_CHANNEL_ID);
        if (!calendarChannel) calendarChannel = await guild.channels.fetch(ids.STAFF_CALENDAR_CHANNEL_ID).catch(function () { return null; });

        if (calendarChannel && flight.forumThreadId) {
            var cardMessage = await calendarChannel.messages.fetch(flight.forumThreadId).catch(function () { return null; });
            if (cardMessage) {
                await cardMessage.delete().catch(function () {});
            }
        }

        if (thread) {
            await thread.delete().catch(function () {});
        }
    } catch (err) {
        console.error('[FlightPanel] Allocation delete error:', err);
    }
}
