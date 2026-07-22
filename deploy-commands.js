// deploy-commands.js
// Run once: node deploy-commands.js
// Registers slash commands globally (or per-guild for faster testing)

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const ids = require('./config/ids');

const allCommands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if (command.data) allCommands.push(command.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        console.log(`Preparing ${allCommands.length} commands...`);

        const globalCommands = ['mymiles', 'addmiles', 'removemiles', 'rankupmiles'];
        const publicCommands = ['bugreport'];
        const aviateCommands = ['traininglog', 'attendance'];

        const volareGuildCommands = allCommands.filter(function(command) {
            return globalCommands.indexOf(command.name) === -1 && aviateCommands.indexOf(command.name) === -1;
        });
        const mainGuildCommands = allCommands.filter(function(command) {
            return publicCommands.indexOf(command.name) !== -1 && globalCommands.indexOf(command.name) === -1;
        });
        const aviateguildCommands = allCommands.filter(function(command) {
            return aviateCommands.indexOf(command.name) !== -1;
        });
        const globalGuildCommands = allCommands.filter(function(command) {
            return globalCommands.indexOf(command.name) !== -1;
        });

        if (process.env.STAFF_SERVER_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.STAFF_SERVER_ID),
                { body: volareGuildCommands },
            );
            console.log(`✅ Registered ${volareGuildCommands.length} commands to Volare`);
        }

        if (process.env.CALENDAR_SERVER_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.CALENDAR_SERVER_ID),
                { body: mainGuildCommands },
            );
            console.log(`✅ Registered ${mainGuildCommands.length} commands to the main server`);
        }

        if (ids.AVIATE_SERVER_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, ids.AVIATE_SERVER_ID),
                { body: aviateguildCommands },
            );
            console.log(`✅ Registered ${aviateguildCommands.length} commands to Aviate`);
        }

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: globalGuildCommands },
        );
        console.log(`✅ Registered ${globalGuildCommands.length} global commands`);

        console.log('Done!');
    } catch (err) {
        console.error('Error:', err);
    }
