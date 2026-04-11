require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

// Set up intents (required for reading message content)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // Required for reading message text
    ]
});

const PREFIX = '!';

// Event: When the bot is ready
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log('------');
});

// Event: When a message is created
client.on('messageCreate', message => {
    // Ignore messages from bots
    if (message.author.bot) return;

    // Check if the message starts with our prefix
    if (message.content.startsWith(PREFIX)) {
        // Extract the command name
        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // Handle the ping command
        if (command === 'ping') {
            message.reply('Pong!');
        }
    }
});

// Get the token from the environment variable
const token = process.env.DISCORD_TOKEN;

// Start the bot
if (!token || token === 'your_bot_token_here') {
    console.error("Error: Please set a valid DISCORD_TOKEN in your .env file.");
} else {
    client.login(token);
}