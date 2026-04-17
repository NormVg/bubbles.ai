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
import { join, resolve as pathResolve } from 'path';
import { get } from 'https';
import { get as httpGet } from 'http';
import config from './config.js';
import { runAgent } from './agents/orchestrator.js';
import { getPendingFiles } from './tools/filesystem.js';
import taskManager from './core/taskManager.js';
import logger from './core/logger.js';
import { getHistory, addToHistory, loadPersistedHistory } from './core/chatHistory.js';
import { logInteraction } from './core/interactionLog.js';
import { startAutomationEngine } from './core/automationEngine.js';

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
  const tempDir = pathResolve(config.WORKSPACE_DIR, 'attachments');
  await mkdir(tempDir, { recursive: true });

  // Add timestamp to prevent overwrites: report.pdf → report_1713193200000.pdf
  const dotIdx = filename.lastIndexOf('.');
  const uniqueName = dotIdx > 0
    ? `${filename.slice(0, dotIdx)}_${Date.now()}${filename.slice(dotIdx)}`
    : `${filename}_${Date.now()}`;
  const filePath = join(tempDir, uniqueName);

  return new Promise((res, reject) => {
    const httpModule = url.startsWith('https') ? get : httpGet;
    httpModule(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Follow redirect
        downloadAttachment(response.headers.location, filename).then(res).catch(reject);
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', async () => {
        await writeFile(filePath, Buffer.concat(chunks));
        res(filePath);
      });
      response.on('error', reject);
    }).on('error', reject);
  });
}

// ── Helper: Extract Message Content ────────────────────────────
async function extractMessageContent(message) {
  // Strip the bot mention from the message text
  let text = message.content.replace(/<@!?\d+>/g, '').trim();

  const extraParts = [];
  const visionFiles = [];

  // Handle attachments (files, images)
  if (message.attachments.size > 0) {
    const attachmentInfo = [];
    for (const [, attachment] of message.attachments) {
      try {
        const filePath = await downloadAttachment(attachment.url, attachment.name);

        // For text-like files, read the content
        const textExtensions = ['.txt', '.js', '.ts', '.py', '.json', '.md', '.yml', '.yaml', '.toml', '.sh', '.css', '.html', '.xml', '.csv', '.log', '.env.example'];
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

        const isTextFile = textExtensions.some((ext) => attachment.name.toLowerCase().endsWith(ext));
        const isImageFile = imageExtensions.some((ext) => attachment.name.toLowerCase().endsWith(ext));

        if (isTextFile) {
          const { readFile } = await import('fs/promises');
          const content = await readFile(filePath, 'utf-8');
          attachmentInfo.push(`**File: ${attachment.name}**\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
        } else if (isImageFile) {
          const { readFile } = await import('fs/promises');
          const buffer = await readFile(filePath);
          visionFiles.push({ buffer, mimeType: attachment.contentType || 'image/jpeg' });
          attachmentInfo.push(`**Image: ${attachment.name}** (passed securely to vision model)`);
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
  return { text, extraContext, visionFiles };
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

  // Load persisted chat history from disk
  await loadPersistedHistory();

  try {
    await registerSlashCommands();
  } catch (err) {
    logger.error('Discord', `Failed to register slash commands: ${err.message}`);
  }

  const banner = `
  ____        _     _     _
 |  _ \\      | |   | |   | |
 | |_) |_   _| |__ | |__ | | ___  ___
 |  _ <| | | | '_ \\| '_ \\| |/ _ \\/ __|
 | |_) | |_| | |_) | |_) | |  __/\\__ \\
 |____/ \\__,_|_.__/|_.__/|_|\\___||___/

        Autonomous Discord Agent
 `;

  console.log('\n\x1b[36m%s\x1b[0m', banner);
  logger.info('Discord', '── Agent ready ──');

  // Start automation engine after bot is ready
  startAutomationEngine(client);
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
    const { text, extraContext, visionFiles } = await extractMessageContent(message);

    if (!text && !extraContext && (!visionFiles || visionFiles.length === 0)) {
      clearInterval(typingInterval);
      activeRequests.delete(message.id);
      await message.reply("Hey! Mention me with a message and I'll help you out. 🫧");
      return;
    }

    logger.info('Discord', `@mention from ${message.author.username}: "${text.slice(0, 80)}..."`);

    let progressMessage = null;
    let updateQueue = Promise.resolve();

    // Set up the task progress handler (serialized through queue)
    taskManager.setUpdateHandler((plan) => {
      updateQueue = updateQueue.then(async () => {
        try {
          const summary = taskManager.getFormattedSummary(plan.id);
          if (!summary) return;

          if (!progressMessage) {
            progressMessage = await message.reply(summary);
            logger.debug('Discord', 'Progress message created');
          } else {
            await progressMessage.edit(summary);
          }
        } catch (err) {
          logger.warn('Discord', `Failed to update progress message: ${err.message}`);
        }
      });
    });

    // Run the agent with conversation history
    const history = getHistory();
    const startTime = Date.now();

    const result = await runAgent(text, {
      extraContext,
      visionFiles,
      history,
      channelId: message.channel.id,
      onStep: () => {
        // Keep typing indicator alive during multi-step operations
        message.channel.sendTyping().catch(() => { });
      },
    });

    // Store this exchange in session history
    await addToHistory(text, result.text);

    // Log the interaction
    logInteraction({
      userId: message.author.id,
      userName: message.author.username,
      channelId: message.channel.id,
      userMessage: text,
      agentResponse: result.text,
      steps: result.steps,
      toolsUsed: [...new Set((result.toolCalls || []).map(tc => tc.tool))],
      durationMs: Date.now() - startTime,
    }).catch(() => { });

    // Clean up task handler & typing
    taskManager.setUpdateHandler(null);
    clearInterval(typingInterval);

    // Wait for any pending progress updates to finish, then delete
    await updateQueue;
    if (progressMessage) {
      try {
        await progressMessage.delete();
      } catch (err) {
        logger.warn('Discord', `Failed to delete progress message: ${err.message}`);
      }
    }

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
