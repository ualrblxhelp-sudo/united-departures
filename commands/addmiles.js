// commands/addmiles.js — grant MileagePlus miles to a Roblox member (staff).
// Executor must be AT OR ABOVE role 1309642670406369331 in the MAIN United server.
const { SlashCommandBuilder } = require('discord.js');
var sb = require('../services/supabase');
var roblox = require('../services/roblox');
var perms = require('../services/permissions');

var MAIN_GUILD = process.env.CALENDAR_SERVER_ID || '1007704123312967760';
var ADMIN_ROLE = process.env.MILES_ADMIN_ROLE_ID || '1309642670406369331';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addmiles')
        .setDescription('Grant MileagePlus miles to a Roblox member')
        .addStringOption(function (o) { return o.setName('username').setDescription('Roblox username').setRequired(true); })
        .addIntegerOption(function (o) { return o.setName('amount').setDescription('Miles to add').setRequired(true).setMinValue(1); }),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        var ok = await perms.atOrAboveRole(interaction.client, interaction.user.id, MAIN_GUILD, ADMIN_ROLE);
        if (!ok) return interaction.editReply('You don\'t have permission to use this command.');
        if (!sb.configured()) return interaction.editReply('The MileagePlus system isn\'t available right now.');

        var username = interaction.options.getString('username');
        var amount = interaction.options.getInteger('amount');
        var who = await roblox.usernameToUserId(username);
        if (!who) return interaction.editReply('Couldn\'t find the Roblox user **' + username + '**.');
        try {
            await sb.rpc('grant_currency', { p_user_id: who.userId, p_miles: amount, p_reason: 'Added by ' + interaction.user.tag });
            return interaction.editReply('Added **' + amount.toLocaleString('en-US') + '** miles to **' + who.username + '**.');
        } catch (err) {
            console.error('[addmiles]', err);
            return interaction.editReply('Couldn\'t add miles right now. Please try again.');
        }
    },
};
