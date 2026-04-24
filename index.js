require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, REST, Routes } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const express = require('express');
const engagement = require('./utils/engagement');
const expressApp = express();
expressApp.use(express.json());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
});

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(function(f) { return f.endsWith('.js'); });

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data) {
        client.commands.set(command.data.name, command);
    }
}

client.on(Events.InteractionCreate, async function(interaction) {
    try {
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (command) await command.execute(interaction);
            return;
        }

        if (interaction.isStringSelectMenu()) {
            var id = interaction.customId;
            if (id === 'create_type') {
                return await client.commands.get('create').handleTypeSelect(interaction);
            }
            if (id === 'create_aircraft') {
                return await client.commands.get('create').handleAircraftSelect(interaction);
            }
            if (id === 'allocate_flight') {
                return await client.commands.get('allocate').handleFlightSelect(interaction);
            }
            if (id === 'allocate_position') {
                return await client.commands.get('allocate').handlePositionSelect(interaction);
            }
            if (id === 'unallocate_flight') {
                return await client.commands.get('unallocate').handleFlightSelect(interaction);
            }
            if (id === 'delete_flight') {
                return await client.commands.get('delete').handleFlightSelect(interaction);
            }
            if (id === 'edit_flight') {
                return await client.commands.get('edit').handleFlightSelect(interaction);
            }
            if (id === 'edit_action') {
                return await client.commands.get('edit').handleActionSelect(interaction);
            }
            if (id === 'edit_unallocate_crew') {
                return await client.commands.get('edit').handleUnallocateCrew(interaction);
            }
            if (id === 'end_flight') {
                return await client.commands.get('end').handleFlightSelect(interaction);
            }
            if (id === 'bugreport_type') {
                return await client.commands.get('bugreport').handleTypeSelect(interaction);
            }
            return;
            return;
        }

        if (interaction.isModalSubmit()) {
            var mid = interaction.customId;
            if (mid === 'create_modal') {
                return await client.commands.get('create').handleModalSubmit(interaction);
            }
            if (mid === 'edit_modal') {
                return await client.commands.get('edit').handleModalSubmit(interaction);
            }
            if (mid === 'edit_transfer_modal') {
                return await client.commands.get('edit').handleTransferModal(interaction);
            }
            if (mid === 'edit_replace_modal') {
                return await client.commands.get('edit').handleReplaceModal(interaction);
            }
            if (mid === 'bugreport_modal') {
                return await client.commands.get('bugreport').handleModalSubmit(interaction);
            }
            if (mid === 'inactivity_modal') {
                return await client.commands.get('inactivity').handleModalSubmit(interaction);
            }
            if (mid === 'suggest_modal') {
                return await client.commands.get('suggest').handleModalSubmit(interaction);
            }
            return;
        }

        if (interaction.isButton()) {
            var bid = interaction.customId;
            if (bid === 'create_confirm') {
                return await client.commands.get('create').handleConfirm(interaction);
            }
            if (bid === 'create_cancel') {
                return await client.commands.get('create').handleCancel(interaction);
            }
            if (bid === 'delete_confirm') {
                return await client.commands.get('delete').handleConfirm(interaction);
            }
            if (bid === 'delete_cancel') {
                return await client.commands.get('delete').handleCancel(interaction);
            }
            if (bid === 'end_confirm') {
                return await client.commands.get('end').handleConfirm(interaction);
            }
            if (bid === 'end_cancel') {
                return await client.commands.get('end').handleCancel(interaction);
            }
            if (bid === 'edit_replace_yes') {
                return await client.commands.get('edit').handleReplaceYes(interaction);
            }
            if (bid === 'edit_replace_no') {
                return await client.commands.get('edit').handleReplaceNo(interaction);
            }
            if (bid === 'edit_replace_cancel') {
                return await client.commands.get('edit').handleReplaceCancel(interaction);
            }
            if (bid.startsWith('inactivity_approve_')) {
                var userId = bid.replace('inactivity_approve_', '');
                return await client.commands.get('inactivity').handleApprove(interaction, userId);
            }
            if (bid.startsWith('inactivity_deny_')) {
                var userId = bid.replace('inactivity_deny_', '');
                return await client.commands.get('inactivity').handleDeny(interaction, userId);
            }
            if (bid === 'fire_confirm') {
                return await client.commands.get('fire').handleConfirm(interaction);
            }
            if (bid === 'fire_cancel') {
                return await client.commands.get('fire').handleCancel(interaction);
            }
            if (bid === 'suggest_up') {
                return await client.commands.get('suggest').handleVote(interaction, 'up');
            }
            if (bid === 'suggest_down') {
                return await client.commands.get('suggest').handleVote(interaction, 'down');
            }
            if (bid.startsWith('pr_accept_')) {
                return await engagement.handleAccept(interaction);
            }
            if (bid.startsWith('pr_reject_')) {
                return await engagement.handleReject(interaction);
            }
            return;
        }
    } catch (err) {
        console.error('[Bot] Interaction error:', err);
        try {
            var reply = { content: 'An error occurred. Please try again.', ephemeral: true };
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        } catch (e) {}
    }
});

client.once(Events.ClientReady, async function(c) {
    console.log('Logged in as ' + c.user.tag);
    console.log('Servers: ' + c.guilds.cache.map(function(g) { return g.name; }).join(', '));

    try {
        var rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        var cmds = [];
        client.commands.forEach(function(cmd) {
            cmds.push(cmd.data.toJSON());
        });
        // Register all commands to Volare staff server
        if (process.env.STAFF_SERVER_ID) {
            await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.STAFF_SERVER_ID), { body: cmds });
            console.log('All commands registered to staff server');
        }

        // Register only public commands to main United server
        var publicCommands = ['bugreport'];
        var publicCmds = [];
        client.commands.forEach(function(cmd) {
            if (publicCommands.indexOf(cmd.data.name) !== -1) {
                publicCmds.push(cmd.data.toJSON());
            }
        });
        if (process.env.CALENDAR_SERVER_ID) {
            await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.CALENDAR_SERVER_ID), { body: publicCmds });
            console.log('Public commands registered to main server');
        }
    } catch (err) {
        console.error('Command registration error:', err);
    }

    var calendar = require('./utils/calendar');
    calendar.updateAllCalendars(client).catch(function(err) {
        console.error('Calendar update error:', err);
    });

    // Reschedule any un-tallied suggestions that were pending at shutdown
    try {
        var suggestCmd = client.commands.get('suggest');
        if (suggestCmd && typeof suggestCmd.initPendingTallies === 'function') {
            await suggestCmd.initPendingTallies(client);
        }
    } catch (err) {
        console.error('[Suggest] Pending tally init error:', err);
    }

    // Start the PR engagement scheduler (noon-Central daily assignment + 23:59 end-of-day check)
    try {
        engagement.start(client);
    } catch (err) {
        console.error('[PR] Engagement start error:', err);
    }
});

// PR engagement completion detection (watches #hemispheres for @everyone posts)
client.on(Events.MessageCreate, function(message) {
    engagement.onMessageCreate(message).catch(function(err) {
        console.error('[PR] MessageCreate handler error:', err);
    });
});

async function start() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    }
    try {
        await client.login(process.env.BOT_TOKEN);
    } catch (err) {
        console.error('Discord login error:', err);
        process.exit(1);
    }

    // Setup application route
    var { setupApplicationRoute } = require('./routes/applications');
    setupApplicationRoute(client, expressApp);

    // Health check
    expressApp.get('/', function(req, res) { res.send('Bot is running'); });

    var PORT = process.env.PORT || 3000;
    expressApp.listen(PORT, function() {
        console.log('API listening on port ' + PORT);
    });
}

start();
