require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
} = require('discord.js');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');

const execAsync = promisify(exec);
let activeTerminal = null;

// Set up intents (required for reading message content)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // Required for reading message text
    ]
});

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

async function registerSlashCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Replies with Pong!')
            .toJSON(),
        new SlashCommandBuilder()
            .setName('update')
            .setDescription('Pulls the latest code from GitHub and restarts the bot (Owner only)')
            .toJSON(),
        new SlashCommandBuilder()
            .setName('restart')
            .setDescription('Restarts the bot (Owner only)')
            .toJSON(),
        new SlashCommandBuilder()
            .setName('terminal')
            .setDescription('Starts a web terminal session via Cloudflare Tunnel (Owner only)')
            .toJSON(),
        new SlashCommandBuilder()
            .setName('closeterminal')
            .setDescription('Closes the active web terminal session (Owner only)')
            .toJSON(),
    ];

    const rest = new REST({ version: '10' }).setToken(token);

    if (guildId) {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, guildId),
            { body: commands }
        );
        console.log(`Registered slash commands for guild ${guildId}.`);
        return;
    }

    const guildIds = [...client.guilds.cache.keys()];

    if (guildIds.length === 0) {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Registered global slash commands (can take up to 1 hour to appear).');
        return;
    }

    for (const currentGuildId of guildIds) {
        await rest.put(
            Routes.applicationGuildCommands(client.user.id, currentGuildId),
            { body: commands }
        );
    }

    console.log(`Registered slash commands in ${guildIds.length} guild(s).`);
}

async function executeUpdate(replyFn) {
    await replyFn('Fetching latest updates from GitHub...');
    try {
        const { stdout: gitOut } = await execAsync('git pull');
        await replyFn(`\`git pull\` output:\n\`\`\`\n${gitOut.substring(0, 1500)}\n\`\`\``);
        
        const { stdout: pnpmOut } = await execAsync('pnpm install');
        await replyFn(`\`pnpm install\` output:\n\`\`\`\n${pnpmOut.substring(0, 1500)}\n\`\`\``);
        
        await replyFn('Restarting bot...');
        process.exit(0);
    } catch (error) {
        await replyFn(`Error during update:\n\`\`\`\n${error.message}\n\`\`\``);
    }
}

// Event: When the bot is ready
client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const guildSummary = [...client.guilds.cache.values()]
        .map(guild => `${guild.name} (${guild.id})`)
        .join(', ');

    if (guildSummary) {
        console.log(`Connected guilds: ${guildSummary}`);
    }

    try {
        await registerSlashCommands();
    } catch (error) {
        console.error('Failed to register slash commands:', error);
    }

    console.log('------');
});

// Event: When a message is created
client.on('messageCreate', async message => {
    // Ignore messages from bots
    if (message.author.bot) return;
    if (!client.user) return;

    const isMentioned = message.mentions.has(client.user);
    if (!isMentioned) return;

    await message.reply('Hi! I now exclusively use slash commands. Try typing `/ping`, `/update`, or `/restart`!');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply('Pong!');
    } else if (interaction.commandName === 'update') {
        if (process.env.OWNER_ID && interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
        }
        
        let replied = false;
        await executeUpdate(async (text) => {
            if (!replied) {
                await interaction.reply(text);
                replied = true;
            } else {
                await interaction.followUp(text);
            }
        });
    } else if (interaction.commandName === 'restart') {
        if (process.env.OWNER_ID && interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
        }
        await interaction.reply('Restarting bot...');
        process.exit(0);
    } else if (interaction.commandName === 'terminal') {
        if (process.env.OWNER_ID && interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
        }

        if (activeTerminal) {
            return interaction.reply({ content: 'A terminal session is already running. Use `/closeterminal` first.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const user = process.env.TERMINAL_USERNAME;
        const pass = process.env.TERMINAL_PASSWORD;

        if (!user || !pass) {
            return interaction.editReply('Error: `TERMINAL_USERNAME` and `TERMINAL_PASSWORD` must be set in your `.env` file to use the terminal securely.');
        }

        const port = Math.floor(Math.random() * 1000) + 8000;

        const ttydProc = spawn('ttyd', ['-W', '-p', port.toString(), '-c', `${user}:${pass}`, 'zsh']);
        const cfProc = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`]);

        activeTerminal = { ttyd: ttydProc, cloudflared: cfProc };

        let urlFound = false;

        cfProc.stderr.on('data', (data) => {
            if (urlFound) return;
            const output = data.toString();
            const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
            if (match) {
                urlFound = true;
                // Wait a few seconds for Cloudflare's DNS to propagate the new tunnel URL
                setTimeout(() => {
                    interaction.editReply(`Terminal started!\n**URL:** ${match[0]}\n**Username:** \`${user}\`\n*Use \`/closeterminal\` when you're done.*\n\n⚠️ *If you get a "Server Not Found" error, wait 5-10 seconds and refresh the page (Cloudflare is still setting up the link).*`).catch(console.error);
                }, 4000);
            }
        });

        // Timeout in case cloudflared fails or hangs
        setTimeout(() => {
            if (!urlFound) {
                interaction.editReply('Failed to start terminal: Cloudflare tunnel timed out.').catch(console.error);
                if (activeTerminal) {
                    activeTerminal.ttyd.kill();
                    activeTerminal.cloudflared.kill();
                    activeTerminal = null;
                }
            }
        }, 15000);

    } else if (interaction.commandName === 'closeterminal') {
        if (process.env.OWNER_ID && interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
        }

        if (!activeTerminal) {
            return interaction.reply({ content: 'No active terminal session to close.', ephemeral: true });
        }

        activeTerminal.ttyd.kill();
        activeTerminal.cloudflared.kill();
        activeTerminal = null;

        await interaction.reply({ content: 'Terminal session closed securely.', ephemeral: true });
    }
});

// Start the bot
if (!token || token === 'your_bot_token_here') {
    console.error("Error: Please set a valid DISCORD_TOKEN in your .env file.");
} else {
    client.login(token);
}
