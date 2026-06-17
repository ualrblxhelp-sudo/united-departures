// commands/migrateapps.js — one-time tool to rebuild Accept/Reject buttons on
// application channels that were created before the button system existed.
const { SlashCommandBuilder, ChannelType } = require('discord.js');
const applications = require('../routes/applications');

var VOLARE_SERVER_ID = '1309560657473179679';
var MANAGEMENT_ROLE_ID = '1309724300156207216';

// Best-effort: resolve a Discord username (from an old channel topic) to a user ID
// by searching the server's members. Returns the ID string, or null if not found.
async function resolveId(guild, username) {
    var clean = String(username || '').trim().replace(/^@/, '').split('#')[0].toLowerCase();
    if (!clean) return null;
    try {
        var results = await guild.members.fetch({ query: clean, limit: 10 });
        var match = results.find(function(m) {
            return m.user.username.toLowerCase() === clean
                || (m.user.globalName && m.user.globalName.toLowerCase() === clean)
                || m.displayName.toLowerCase() === clean;
        });
        return match ? match.user.id : null;
    } catch (e) {
        return null;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('migrateapps')
        .setDescription('Rebuild the Accept/Reject buttons on existing application channels'),

    async execute(interaction) {
        if (interaction.guildId !== VOLARE_SERVER_ID) {
            return interaction.reply({ content: '\u274C This command can only be used in the United Volare server.', ephemeral: true });
        }
        if (!interaction.member.roles.cache.has(MANAGEMENT_ROLE_ID)) {
            return interaction.reply({ content: '\u274C You do not have permission to use this command.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        var guild = interaction.client.guilds.cache.get(VOLARE_SERVER_ID);
        var all = await guild.channels.fetch();
        var channels = all.filter(function(ch) {
            return ch && ch.type === ChannelType.GuildText && ch.parentId === applications.APPLICATION_CATEGORY_ID;
        });

        var migrated = 0, resolved = 0, unknown = 0, errors = 0;
        var details = [];

        for (const ch of channels.values()) {
            try {
                var topic = ch.topic || '';
                var applicantId = 'unknown';

                var idMatch = topic.match(/ID:\s*(\d{15,21})/);
                if (idMatch) {
                    applicantId = idMatch[1];
                } else {
                    var userMatch = topic.match(/Discord:\s*([^\u2022]+)/);
                    if (userMatch) {
                        var rid = await resolveId(guild, userMatch[1]);
                        if (rid) { applicantId = rid; resolved++; }
                    }
                }
                if (applicantId === 'unknown') unknown++;

                // Remove any existing Review Actions message(s) (old reactions or prior buttons)
                var msgs = await ch.messages.fetch({ limit: 50 });
                for (const m of msgs.values()) {
                    if (m.author && m.author.id === interaction.client.user.id &&
                        m.embeds[0] && m.embeds[0].title === 'Review Actions') {
                        await m.delete().catch(function() {});
                    }
                }

                // Post a fresh Review Actions embed + working buttons
                await ch.send({
                    embeds: [applications.buildReviewEmbed(applicantId)],
                    components: [applications.buildReviewRow(applicantId, false)],
                });

                migrated++;
                details.push('#' + ch.name + ' \u2192 ' + (applicantId === 'unknown' ? 'no ID' : applicantId));
            } catch (e) {
                console.error('[MigrateApps] error on ' + (ch && ch.name) + ':', e);
                errors++;
            }
        }

        var summary = '**Application migration complete.**\n' +
            'Channels updated: ' + migrated + '\n' +
            'IDs resolved from username: ' + resolved + '\n' +
            'Still missing an ID (accept won\'t auto-DM): ' + unknown + '\n' +
            (errors ? ('Errors: ' + errors + '\n') : '') +
            (details.length ? ('\n' + details.slice(0, 25).join('\n')) : '');

        await interaction.editReply({ content: summary.substring(0, 1900) });
    },
};
