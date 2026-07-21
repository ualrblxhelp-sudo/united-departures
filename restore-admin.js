// restore-admin.js — ONE-OFF recovery. Run once, then DELETE this file.
//
// Recreates an "admin" role with full Administrator and gives it to you.
// Uses your bot's existing token (BOT_TOKEN). The bot must currently have
// Administrator in the Volare server — a bot cannot grant a permission it
// doesn't hold. If it doesn't, the script tells you and does nothing.
//
// Run (from the bot folder, with BOT_TOKEN set in the environment):
//     node restore-admin.js

const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');

const GUILD_ID = '1309560657473179679'; // Volare
const USER_ID = '552663789770637317';   // you
const ROLE_NAME = 'admin';

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once('ready', async () => {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const me = await guild.members.fetchMe();

        if (!me.permissions.has(PermissionsBitField.Flags.Administrator)) {
            console.error(
                '\n[STOP] The bot does not have Administrator in this server, so it cannot create ' +
                'or grant an Administrator role. Have the server owner give the bot a role with ' +
                'Administrator (placed high in the list), then run this again.\n'
            );
            return;
        }

        // Create the role, or reuse one that already exists with this name.
        await guild.roles.fetch();
        let role = guild.roles.cache.find((r) => r.name === ROLE_NAME);
        if (!role) {
            role = await guild.roles.create({
                name: ROLE_NAME,
                permissions: [PermissionsBitField.Flags.Administrator],
                reason: 'Owner admin recovery (accidental role deletion)',
            });
            console.log(`Created role "${role.name}" (${role.id}).`);
        } else {
            await role.setPermissions([PermissionsBitField.Flags.Administrator]);
            console.log(`Reusing existing role "${role.name}" (${role.id}); ensured Administrator.`);
        }

        // Position it just under the bot's own top role (as high as the bot can place it).
        try {
            const target = Math.max(me.roles.highest.position - 1, 1);
            await role.setPosition(target);
            console.log(`Positioned "${role.name}" at ${target}.`);
        } catch (e) {
            console.warn('Could not reposition the role (not critical — Administrator still applies):', e.message);
        }

        const member = await guild.members.fetch(USER_ID);
        await member.roles.add(role, 'Owner admin recovery');
        console.log(`\nDone — gave "${role.name}" to ${member.user.tag} (${USER_ID}). Delete this file now.\n`);
    } catch (err) {
        console.error('Failed:', err);
    } finally {
        client.destroy();
    }
});

client.login(process.env.BOT_TOKEN);
