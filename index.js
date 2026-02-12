require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events, REST, Routes } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

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
            return;
        }

        if (interaction.isModalSubmit()) {
            var mid = interaction.customId;
            if (mid === 'create_modal') {
                return await client.commands.get('create').handleModalSubmit(interaction);
            }
            if (mid.startsWith('edit_modal_')) {
                return await client.commands.get('edit').handleModalSubmit(interaction);
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
        var servers = [process.env.STAFF_SERVER_ID, process.env.CALENDAR_SERVER_ID];
        for (var i = 0; i < servers.length; i++) {
            if (servers[i]) {
                await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, servers[i]), { body: cmds });
                console.log('Commands registered to server ' + servers[i]);
            }
        }
    } catch (err) {
        console.error('Command registration error:', err);
    }

    var calendar = require('./utils/calendar');
    calendar.updateCalendar(client).catch(function(err) {
        console.error('Calendar update error:', err);
    });
    calendar.updateStaffCalendar(client).catch(function(err) {
        console.error('Calendar update error:', err);
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
}

start();
