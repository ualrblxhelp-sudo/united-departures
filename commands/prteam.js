const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

var VOLARE_GUILD_ID = '1309560657473179679';
var MANAGEMENT_ROLE_ID = '1309724300156207216';
var PR_ROLE_ID = '1345906382536441958';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('prteam')
        .setDescription('Diagnostic: show all members the bot currently sees with the Public Relations role'),

    async execute(interaction) {
        if (interaction.guildId !== VOLARE_GUILD_ID) {
            return interaction.reply({ content: '<:e_decline:1397829342079483904> This command can only be used in the United Volare server.', ephemeral: true });
        }
        if (!interaction.member.roles.cache.has(MANAGEMENT_ROLE_ID)) {
            return interaction.reply({ content: '<:e_decline:1397829342079483904> You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            var guild = await interaction.client.guilds.fetch(VOLARE_GUILD_ID);

            // Always do a full fetch so the cache is complete
            var fetchStart = Date.now();
            var fetchError = null;
            try {
                var fetchPromise = guild.members.fetch();
                var timeoutPromise = new Promise(function(_, reject) {
                    setTimeout(function() { reject(new Error('timed out after 30s')); }, 30 * 1000);
                });
                await Promise.race([fetchPromise, timeoutPromise]);
            } catch (err) {
                fetchError = err.message;
            }
            var fetchMs = Date.now() - fetchStart;

            var role = guild.roles.cache.get(PR_ROLE_ID) || await guild.roles.fetch(PR_ROLE_ID).catch(function() { return null; });

            var lines = [];
            lines.push('**Volare guild:** `' + guild.id + '`');
            lines.push('**Total cached members:** ' + guild.memberCount + ' total / ' + guild.members.cache.size + ' cached');
            lines.push('**Members fetch:** ' + (fetchError ? '\u274C ' + fetchError : '\u2705 completed in ' + fetchMs + 'ms'));
            lines.push('');

            if (!role) {
                lines.push('<:e_decline:1397829342079483904> **Role `' + PR_ROLE_ID + '` not found in guild.**');
            } else {
                var members = role.members;
                lines.push('**Role:** ' + role.name + ' (`' + role.id + '`)');
                lines.push('**Members with this role:** ' + members.size);
                lines.push('');
                if (members.size === 0) {
                    lines.push('_No members visible — likely a cache or intent issue._');
                } else {
                    var entries = [];
                    members.forEach(function(m) {
                        entries.push('\u2022 <@' + m.id + '> \u2014 nick: `' + (m.nickname || '(none)') + '` \u2014 user: `' + m.user.username + '`');
                    });
                    if (entries.length <= 25) {
                        lines.push(entries.join('\n'));
                    } else {
                        lines.push(entries.slice(0, 25).join('\n'));
                        lines.push('_\u2026 and ' + (entries.length - 25) + ' more_');
                    }
                }
            }

            var embed = new EmbedBuilder()
                .setTitle('PR Team Diagnostic')
                .setColor(0x080C96)
                .setDescription(lines.join('\n'))
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('[prteam] Error:', err);
            try {
                await interaction.editReply({
                    content: '<:e_decline:1397829342079483904> Diagnostic failed: `' + (err && err.message ? err.message : String(err)).slice(0, 1500) + '`',
                });
            } catch (e) {}
        }
    },
};
