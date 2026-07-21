// utils/embed.js
const { EmbedBuilder } = require('discord.js');
const { getPositionsForAircraft, DEPARTMENTS } = require('../config/aircraft');
const { airportLabel } = require('../config/airports');
const ids = require('../config/ids');

/**
 * Build the flight info embed (first embed in forum post)
 */
function buildFlightInfoEmbed(flight) {
    const route = `${flight.departure} ➜ ${flight.destination}`;

    const embed = new EmbedBuilder()
        .setTitle('<:volare_click:1408484978362290287> Flight Information')
        .setColor(0x551e5f)
        .setDescription(
            `Hello, Volare employees!\n\n` +
            `<:volare_arrow:1408485394747490385> A flight has been scheduled for the near future. Please find the necessary information below to allocate for this flight. ` +
            `If you are available, kindly use the \`/allocate\` command in <#${ids.CMDS_CHANNEL_ID}> to secure a position for this flight. ` +
            `Please note that your allocation is binding, and you are required to work on this flight. ` +
            `If you change your mind or become unavailable, please use the \`/unallocate\` command.\n\n` +
            `> **Dispatcher:** <@${flight.dispatcherId}>\n` +
            `> **Flight Number:** ${flight.flightNumber}\n` +
            `> **Route:** ${route}\n` +
            `> **Aircraft:** ${flight.aircraft}\n` +
            `> **Staff Join Time:** <t:${flight.employeeJoinTime}:F>\n` +
            `> **Server Open Time:** <t:${flight.serverOpenTime}:F>`
        )
        .setTimestamp();

    return embed;
}

/**
 * Build the allocation sheet embed (second embed in forum post)
 */
function buildAllocationEmbed(flight) {
    const positions = getPositionsForAircraft(flight.aircraft);
    if (!positions) return null;

    const embed = new EmbedBuilder()
        .setTitle('<:volare_fa:1408298318861176920> Allocations')
        .setColor(0x551e5f)

    // Build allocation lookup: position -> [user mentions]
    const allocationMap = {};
    for (const alloc of (flight.allocations || [])) {
        if (!allocationMap[alloc.position]) allocationMap[alloc.position] = [];
        allocationMap[alloc.position].push(`<@${alloc.userId}>`);
    }

    // Add dispatcher to the description
    let description = `**Dispatcher:** <@${flight.dispatcherId}>\n\n`;

    // Build each department section
    for (const dept of DEPARTMENTS) {
        description += `**__${dept}__**\n`;

        // Get positions in this department
        const deptPositions = Object.entries(positions)
            .filter(([_, config]) => config.department === dept);

        for (const [role, config] of deptPositions) {
            const allocated = allocationMap[role] || [];
            const filled = allocated.length;
            const max = config.max;

            description += `> **${role}** (${filled}/${max})\n`;

            if (allocated.length > 0) {
                for (const mention of allocated) {
                    description += `> ┃ ${mention}\n`;
                }
            } else {
                description += `> ┃ *Open*\n`;
            }
            description += `\n`;
        }
    }

    embed.setDescription(description);
    embed.setTimestamp();

    return embed;
}

/**
 * Build the archive embed (sent when a flight is deleted)
 */
function buildArchiveEmbed(flight) {
    const allocationEmbed = buildAllocationEmbed(flight);
    const infoEmbed = buildFlightInfoEmbed(flight);

    const archiveEmbed = new EmbedBuilder()
        .setTitle(`🗄️ Archived: ${flight.flightNumber}`)
        .setColor(0x808080) // gray
        .setDescription(
            `**Flight Number:** ${flight.flightNumber}\n` +
            `**Route:** ${flight.departure} ➜ ${flight.destination}\n` +
            `**Aircraft:** ${flight.aircraft}\n` +
            `**Dispatcher:** <@${flight.dispatcherId}>\n` +
            `**Staff Join Time:** <t:${flight.employeeJoinTime}:F>\n` +
            `**Server Open Time:** <t:${flight.serverOpenTime}:F>\n` +
            `**Status:** ${flight.status}\n` +
            `**Archived At:** <t:${Math.floor(Date.now() / 1000)}:F>`
        )
        .setTimestamp();

    return { archiveEmbed, allocationEmbed };
}

/**
 * Build the per-flight "card" embed that the allocation thread hangs off.
 * This replaces reposting the calendar per flight — one permanent calendar
 * stays put, and each flight gets this card + its own linked thread.
 */
function buildFlightCardEmbed(flight) {
    // "United Airlines 1812" — the numeric portion of the flight number.
    var digits = String(flight.flightNumber).replace(/[^0-9]/g, '');
    var numberLabel = digits || String(flight.flightNumber);

    var bullets =
        '\u2022 United Airlines **' + numberLabel + '**\n' +
        '\u2022 ' + airportLabel(flight.departure) + ' -> ' + airportLabel(flight.destination) + '\n' +
        '\u2022 <t:' + flight.serverOpenTime + ':f>';

    return new EmbedBuilder()
        .setTitle('<:e_plane:1397829563249328138> ' + flight.flightNumber)
        .setColor(0x3D1643)
        .setDescription(
            'A new flight has been scheduled. Please read related information regarding this departure below and **allocate** using the linked thread.'
        )
        .addFields({ name: '\u200b', value: bullets });
}

module.exports = { buildFlightInfoEmbed, buildAllocationEmbed, buildArchiveEmbed, buildFlightCardEmbed };
