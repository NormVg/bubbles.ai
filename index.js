import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder,
} from 'discord.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { get } from 'https';
import { get as httpGet } from 'http';
import config from './config.js';
import { runAgent } from './agents/orchestrator.js';
import { getPendingFiles } from './tools/filesystem.js';
import logger from './core/logger.js';

const execAsync = promisify(exec);
let activeTerminal = null;

// ── Discord Client ─────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const token = config.DISCORD_TOKEN;
const guildId = config.DISCORD_GUILD_ID;

// ── Slash Commands ─────────────────────────────────────────────
async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!').toJSON(),
    new SlashCommandBuilder().setName('update').setDescription('Pulls latest code and restarts (Owner only)').toJSON(),
    new SlashCommandBuilder().setName('restart').setDescription('Restarts the bot (Owner only)').toJSON(),
    new SlashCommandBuilder().setName('terminal').setDescription('Starts a web terminal via Cloudflare Tunnel (Owner only)').toJSON(),
    new SlashCommandBuilder().setName('closeterminal').setDescription('Closes terminal session (Owner only)').toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
    logger.info('Discord', `Registered slash commands for guild ${guildId}`);
    return;
  }

  const guildIds = [...client.guilds.cache.keys()];
  if (guildIds.length === 0) {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    logger.info('Discord', 'Registered global slash commands');
    return;
  }

  for (const id of guildIds) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, id), { body: commands });
  }
  logger.info('Discord', `Registered slash commands in ${guildIds.length} guild(s)`);
}

// ── Helper: Download Attachment ────────────────────────────────
async function downloadAttachment(url, filename) {
  const tempDir = resolve(config.WORKSPACE_DIR, 'attachments');
  await mkdir(tempDir, { recursive: true });
  const filePath = join(tempDir, filename);

  return new Promise((resolve, reject) => {
    const httpModule = url.startsWith('https') ? get : httpGet;
    httpModule(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        downloadAttachment(res.headers.location, filename).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', async () => {
        await writeFile(filePath, Buffer.concat(chunks));
        resolve(filePath);
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Helper: Extract Message Content ────────────────────────────
async function extractMessageContent(message) {
  // Strip the bot mention from the message text
  let text = message.content.replace(/<@!?\d+>/g, '').trim();

  const extraParts = [];

  // Handle attachments (files, images)
  if (message.attachments.size > 0) {
    const attachmentInfo = [];
    for (const [, attachment] of message.attachments) {
      try {
        const filePath = await downloadAttachment(attachment.url, attachment.name);

        // For text-like files, read the content
        const textExtensions = ['.txt', '.js', '.ts', '.py', '.json', '.md', '.yml', '.yaml', '.toml', '.sh', '.css', '.html', '.xml', '.csv', '.log', '.env.example'];
        const isTextFile = textExtensions.some((ext) => attachment.name.toLowerCase().endsWith(ext));

        if (isTextFile) {
          const { readFile } = await import('fs/promises');
          const content = await readFile(filePath, 'utf-8');
          attachmentInfo.push(`**File: ${attachment.name}**\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
        } else {
          attachmentInfo.push(`**File: ${attachment.name}** (saved to ${filePath}, ${attachment.size} bytes)`);
        }
      } catch (err) {
        logger.warn('Discord', `Failed to download attachment: ${err.message}`);
        attachmentInfo.push(`**File: ${attachment.name}** (failed to download)`);
      }
    }
    if (attachmentInfo.length) {
      extraParts.push(attachmentInfo.join('\n'));
    }
  }

  // Handle referenced/replied messages
  if (message.reference) {
    try {
      const referencedMsg = await message.channel.messages.fetch(message.reference.messageId);
      if (referencedMsg) {
        extraParts.push(`**Referenced message from ${referencedMsg.author.username}:**\n${referencedMsg.content.slice(0, 1000)}`);
      }
    } catch {
      // Ignore if can't fetch referenced message
    }
  }

  const extraContext = extraParts.length > 0 ? extraParts.join('\n\n') : null;
  return { text, extraContext };
}

// ── Helper: Split Long Messages ────────────────────────────────
function splitMessage(text, maxLength = 1900) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex <= 0) {
      // Fall back to splitting at a space
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex <= 0) {
      // Hard split
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

// ── Update Command ─────────────────────────────────────────────
async function executeUpdate(replyFn) {
  await replyFn('Fetching latest updates from GitHub...');
  try {
    const { stdout: gitOut } = await execAsync('git pull');
    await replyFn(`\`git pull\` output:\n\`\`\`\n${gitOut.substring(0, 1500)}\n\`\`\``);

    const { stdout: npmOut } = await execAsync('npm install');
    await replyFn(`\`npm install\` output:\n\`\`\`\n${npmOut.substring(0, 1500)}\n\`\`\``);

    await replyFn('Restarting bot...');
    process.exit(0);
  } catch (error) {
    await replyFn(`Error during update:\n\`\`\`\n${error.message}\n\`\`\``);
  }
}

// ── Bot Ready ──────────────────────────────────────────────────
client.once('clientReady', async () => {
  logger.info('Discord', `Logged in as ${client.user.tag}`);

  const guilds = [...client.guilds.cache.values()].map((g) => `${g.name} (${g.id})`).join(', ');
  if (guilds) logger.info('Discord', `Connected guilds: ${guilds}`);

  try {
    await registerSlashCommands();
  } catch (err) {
    logger.error('Discord', `Failed to register slash commands: ${err.message}`);
  }

  logger.info('Discord', '── Agent ready ──');
});

// ── @Mention Chat Handler ──────────────────────────────────────
const activeRequests = new Set();

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!client.user) return;

  const isMentioned = message.mentions.has(client.user);
  if (!isMentioned) return;

  // Prevent duplicate processing
  if (activeRequests.has(message.id)) return;
  activeRequests.add(message.id);

  try {
    // Show typing indicator
    await message.channel.sendTyping();
    const typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => { });
    }, 8000);

    // Extract text and any attachments/references
    const { text, extraContext } = await extractMessageContent(message);

    if (!text && !extraContext) {
      clearInterval(typingInterval);
      activeRequests.delete(message.id);
      await message.reply("Hey! Mention me with a message and I'll help you out. 🫧");
      return;
    }

    logger.info('Discord', `@mention from ${message.author.username}: "${text.slice(0, 80)}..."`);

    // Run the agent
    const result = await runAgent(text, {
      extraContext,
      onStep: () => {
        // Keep typing indicator alive during multi-step operations
        message.channel.sendTyping().catch(() => { });
      },
    });

    clearInterval(typingInterval);

    // Collect any files the agent queued for sending
    const filesToSend = getPendingFiles();
    const attachments = [];

    for (const file of filesToSend) {
      try {
        const attachment = new AttachmentBuilder(file.path);
        attachments.push(attachment);
      } catch (err) {
        logger.warn('Discord', `Failed to create attachment for ${file.path}: ${err.message}`);
      }
    }

    // Send response (split if needed) with any file attachments
    const chunks = splitMessage(result.text);
    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;
      const isLast = i === chunks.length - 1;
      const opts = { content: chunks[i] };

      // Attach files on the last text chunk
      if (isLast && attachments.length > 0) {
        opts.files = attachments;
      }

      if (isFirst) {
        await message.reply(opts);
      } else {
        await message.channel.send(opts);
      }
    }

    // If there are attachments but no text, send just the files
    if (chunks.length === 0 && attachments.length > 0) {
      await message.reply({ files: attachments });
    }

    // Log metadata
    logger.info('Discord', `Response sent (${result.steps} steps, ${result.toolCalls.length} tool calls)`);
  } catch (err) {
    logger.error('Discord', `Message handler error: ${err.message}`);
    try {
      await message.reply(`⚠️ Something went wrong:\n\`\`\`\n${err.message.slice(0, 500)}\n\`\`\``);
    } catch {
      // If we can't even reply, just log it
    }
  } finally {
    activeRequests.delete(message.id);
  }
});

// ── Slash Command Handler ──────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const isOwner = !config.OWNER_ID || interaction.user.id === config.OWNER_ID;

  if (commandName === 'ping') {
    await interaction.reply('Pong! 🫧');
  } else if (commandName === 'update') {
    if (!isOwner) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
    let replied = false;
    await executeUpdate(async (text) => {
      if (!replied) { await interaction.reply(text); replied = true; }
      else { await interaction.followUp(text); }
    });
  } else if (commandName === 'restart') {
    if (!isOwner) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
    await interaction.reply('Restarting... 🔄');
    process.exit(0);
  } else if (commandName === 'terminal') {
    if (!isOwner) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
    if (activeTerminal) return interaction.reply({ content: 'Terminal already running. Use `/closeterminal` first.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const user = config.TERMINAL_USERNAME;
    const pass = config.TERMINAL_PASSWORD;
    if (!user || !pass) return interaction.editReply('Error: Set TERMINAL_USERNAME and TERMINAL_PASSWORD in .env');

    const port = Math.floor(Math.random() * 1000) + 8000;
    const ttydProc = spawn('ttyd', ['-W', '-p', port.toString(), '-c', `${user}:${pass}`, 'zsh']);
    const cfProc = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`]);
    activeTerminal = { ttyd: ttydProc, cloudflared: cfProc };

    let urlFound = false;
    cfProc.stderr.on('data', (data) => {
      if (urlFound) return;
      const match = data.toString().match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        urlFound = true;
        setTimeout(() => {
          interaction.editReply(`Terminal started!\n**URL:** ${match[0]}\n**Username:** \`${user}\`\n*Use \`/closeterminal\` when done.*`).catch(console.error);
        }, 4000);
      }
    });

    setTimeout(() => {
      if (!urlFound) {
        interaction.editReply('Failed: Cloudflare tunnel timed out.').catch(console.error);
        if (activeTerminal) {
          activeTerminal.ttyd.kill();
          activeTerminal.cloudflared.kill();
          activeTerminal = null;
        }
      }
    }, 15000);
  } else if (commandName === 'closeterminal') {
    if (!isOwner) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
    if (!activeTerminal) return interaction.reply({ content: 'No active terminal.', ephemeral: true });

    activeTerminal.ttyd.kill();
    activeTerminal.cloudflared.kill();
    activeTerminal = null;
    await interaction.reply({ content: 'Terminal closed. 🔒', ephemeral: true });
  }
});

// ── Start ──────────────────────────────────────────────────────
if (!token || token === 'your_bot_token_here') {
  logger.error('Discord', 'Please set a valid DISCORD_TOKEN in your .env file.');
} else {
  client.login(token);
}
