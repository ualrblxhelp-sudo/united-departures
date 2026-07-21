// commands/rankupmiles.js — promote a Roblox member to a group rank (staff).
// You pass the exact RANK NAME; if valid, the member is set to that rank in the
// Roblox group. Discord roles then sync via Bloxlink.
// Executor must be AT OR ABOVE role 1309642670406369331 in the MAIN United server.
// Requires env ROBLOX_OPENCLOUD_KEY (group:write scope for group 15667508).
const { SlashCommandBuilder } = require('discord.js');
var roblox = require('../services/roblox');
var perms = require('../services/permissions');

var MAIN_GUILD = process.env.CALENDAR_SERVER_ID || '1007704123312967760';
var ADMIN_ROLE = process.env.MILES_ADMIN_ROLE_ID || '1309642670406369331';
var GROUP_ID = process.env.MILES_GROUP_ID || '15667508';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rankupmiles')
        .setDescription('Promote a Roblox member to a group rank')
        .addStringOption(function (o) { return o.setName('username').setDescription('Roblox username').setRequired(true); })
        .addStringOption(function (o) { return o.setName('rank').setDescription('Exact group rank name to set').setRequired(true); }),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        var ok = await perms.atOrAboveRole(interaction.client, interaction.user.id, MAIN_GUILD, ADMIN_ROLE);
        if (!ok) return interaction.editReply('You don\'t have permission to use this command.');

        var username = interaction.options.getString('username');
        var rank = interaction.options.getString('rank');
        var who = await roblox.usernameToUserId(username);
        if (!who) return interaction.editReply('Couldn\'t find the Roblox user **' + username + '**.');

        var res = await roblox.setGroupRank(GROUP_ID, who.userId, rank);
        if (res.ok) {
            return interaction.editReply('Promoted **' + who.username + '** to **' + res.rank + '** in the group. Discord roles will sync via Bloxlink.');
        }
        if (res.reason === 'not_configured') {
            return interaction.editReply('Group ranking isn\'t set up yet (missing Open Cloud API key).');
        }
        if (res.reason === 'unknown_rank') {
            var list = (res.roles || []).join(', ');
            return interaction.editReply('**' + rank + '** isn\'t a valid rank. Valid ranks: ' + (list || '(none found)'));
        }
        if (res.reason === 'not_in_group') {
            return interaction.editReply('**' + who.username + '** isn\'t a member of the group.');
        }
        return interaction.editReply('Ranking failed' + (res.status ? ' (HTTP ' + res.status + ')' : '') + '. Check the Open Cloud key\'s scope and that it outranks the target rank.');
    },
};
