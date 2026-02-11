// index.js
// United Volare Discord Bot - Flight operations & crew allocation

require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
});

// ============================================================
// Load commands
// ============================================================
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data) {
        client.commands.set(command.data.name, command);
    }
}

// ============================================================
// Interaction handler - routes slash commands, modals, buttons, selects
// ============================================================
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        // ---- Slash Commands ----
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (command) await command.execute(interaction);
            return;
        }

        // ---- String Select Menus ----
        if (interaction.isStringSelectMenu()) {
            const id = interaction.customId;

            // /create step 1: aircraft select
            if (id === 'create_aircraft') {
                const create = client.commands.get('create');
                return await create.handleAircraftSelect(interaction);
            }

            // /allocate step 1: flight select
            if (id === 'allocate_flight') {
                const allocate = client.commands.get('allocate');
                return await allocate.handleFlightSelect(interaction);
            }

            // /allocate step 2: position select
            if (id === 'allocate_position') {
                const allocate = client.commands.get('allocate');
                return await allocate.handlePositionSelect(interaction);
            }

            // /unallocate: flight select
            if (id === 'unallocate_flight') {
                const unallocate = client.commands.get('unallocate');
                return await unallocate.handleFlightSelect(interaction);
            }

            return;
        }

        // ---- Modal Submissions ----
        if (interaction.isModalSubmit()) {
            const id = interaction.customId;

            // /create step 2: flight details modal
            if (id === 'create_modal') {
                const create = client.commands.get('create');
                return await create.handleModalSubmit(interaction);
            }

            // /edit modal
            if (id.startsWith('edit_modal_')) {
                const edit = client.commands.get('edit');
                return await edit.handleModalSubmit(interaction);
            }

            return;
        }

        // ---- Buttons ----
        if (interaction.isButton()) {
            const id = interaction.customId;

            // /create confirm/cancel
            if (id === 'create_confirm') {
                const create = client.commands.get('create');
                return await create.handleConfirm(interaction);
            }
            if (id === 'create_cancel') {
                const create = client.commands.get('create');
                return await create.handleCancel(interaction);
            }

            // /delete confirm/cancel
            if (id === 'delete_confirm') {
                const del = client.commands.get('delete');
                return await del.handleConfirm(interaction);
            }
            if (id === 'delete_cancel') {
                const del = client.commands.get('delete');
                return await del.handleCancel(interaction);
            }

            return;
        }
    } catch (err) {
        console.error('[Bot] Interaction error:', err);
        try {
            const reply = { content: '❌ An error occurred. Please try again.', ephemeral: true };
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        } catch {} // silently fail if we can't even reply
    }
});

// ============================================================
// Ready
// ============================================================
client.once(Events.ClientReady, (c) => {
    console.log(`✅ Logged in as ${c.user.tag}`);
    console.log(`   Servers: ${c.guilds.cache.map(g => g.name).join(', ')}`);

    // Initial calendar refresh
    const { updateCalendar } = require('./utils/calendar');
    updateCalendar(client).catch(err => console.error('[Boot] Calendar update error:', err));
});

// ============================================================
// Connect to MongoDB and start bot
// ============================================================
async function start() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    }

    try {
        await client.login(process.env.BOT_TOKEN);
    } catch (err) {
        console.error('❌ Discord login error:', err);
        process.exit(1);
    }
}

start();
