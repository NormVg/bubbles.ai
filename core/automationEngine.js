/**
 * Automation Engine — persistent scheduled tasks that run through the full agent stack.
 *
 * Automations are stored in .bubbles/automations/<name>/automation.json
 * and can be triggered by:
 *   - cron:     standard cron expressions (e.g. "0 9 * * *")
 *   - interval: every N minutes
 *   - watch:    file/folder changes via fs.watch
 *
 * When triggered, the automation's task prompt is sent through runAgent()
 * so it has access to ALL tools (webSearch, memoryWrite, etc.).
 * Results are delivered to the configured Discord channel.
 */

import cron from 'node-cron';
import { watch } from 'fs';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import config from '../config.js';
import logger from './logger.js';
import { runAgent } from '../agents/orchestrator.js';

const AUTOMATIONS_DIR = join(resolve(config.WORKING_DIR), '.bubbles', 'automations');

/** @type {Map<string, { definition: object, job: any, watcher: any }>} */
const activeAutomations = new Map();

/** Discord client reference — set via start() */
let discordClient = null;

// ── Public API ───────────────────────────────────────────────────

/**
 * Start the automation engine. Called once after Discord client is ready.
 * @param {import('discord.js').Client} client
 */
export function startAutomationEngine(client) {
  discordClient = client;

  if (!existsSync(AUTOMATIONS_DIR)) {
    mkdirSync(AUTOMATIONS_DIR, { recursive: true });
  }

  // Load all automations from disk
  const entries = readdirSync(AUTOMATIONS_DIR, { withFileTypes: true });
  let loaded = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const defPath = join(AUTOMATIONS_DIR, entry.name, 'automation.json');
    if (!existsSync(defPath)) continue;

    try {
      const def = JSON.parse(readFileSync(defPath, 'utf-8'));
      if (def.enabled) {
        scheduleAutomation(def);
        loaded++;
      }
      activeAutomations.set(def.name, { definition: def, job: activeAutomations.get(def.name)?.job, watcher: activeAutomations.get(def.name)?.watcher });
    } catch (err) {
      logger.warn('AutomationEngine', `Failed to load "${entry.name}": ${err.message}`);
    }
  }

  logger.info('AutomationEngine', `Started — ${loaded} active automation(s)`);
}

/**
 * Create and persist a new automation.
 */
export async function createAutomation(def) {
  const automationDir = join(AUTOMATIONS_DIR, def.name);
  await mkdir(automationDir, { recursive: true });

  def.createdAt = def.createdAt || new Date().toISOString();
  def.enabled = def.enabled !== false;
  def.lastRun = null;
  def.runCount = 0;

  await writeFile(join(automationDir, 'automation.json'), JSON.stringify(def, null, 2));

  if (def.enabled) {
    scheduleAutomation(def);
  }

  activeAutomations.set(def.name, {
    definition: def,
    job: activeAutomations.get(def.name)?.job,
    watcher: activeAutomations.get(def.name)?.watcher,
  });

  logger.info('AutomationEngine', `Created automation: "${def.name}" (${def.trigger.type})`);
  return def;
}

/**
 * List all automations.
 */
export function listAllAutomations() {
  if (!existsSync(AUTOMATIONS_DIR)) return [];

  const entries = readdirSync(AUTOMATIONS_DIR, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const defPath = join(AUTOMATIONS_DIR, entry.name, 'automation.json');
    if (!existsSync(defPath)) continue;

    try {
      const def = JSON.parse(readFileSync(defPath, 'utf-8'));
      result.push(def);
    } catch {
      result.push({ name: entry.name, error: 'Failed to read definition' });
    }
  }

  return result;
}

/**
 * Toggle an automation on/off.
 */
export async function toggleAutomation(name, enabled) {
  const defPath = join(AUTOMATIONS_DIR, name, 'automation.json');
  if (!existsSync(defPath)) return { success: false, error: `Automation "${name}" not found.` };

  const def = JSON.parse(readFileSync(defPath, 'utf-8'));
  def.enabled = enabled;
  writeFileSync(defPath, JSON.stringify(def, null, 2));

  if (enabled) {
    scheduleAutomation(def);
    logger.info('AutomationEngine', `Enabled: "${name}"`);
  } else {
    unscheduleAutomation(name);
    logger.info('AutomationEngine', `Disabled: "${name}"`);
  }

  return { success: true, name, enabled };
}

/**
 * Remove an automation completely.
 */
export async function removeAutomation(name) {
  unscheduleAutomation(name);

  const automationDir = join(AUTOMATIONS_DIR, name);
  if (existsSync(automationDir)) {
    const { rmSync } = await import('fs');
    rmSync(automationDir, { recursive: true, force: true });
  }

  activeAutomations.delete(name);
  logger.info('AutomationEngine', `Removed: "${name}"`);
  return { success: true };
}

/**
 * Manually trigger an automation right now. dryRun=true skips Discord posting.
 */
export async function triggerAutomation(name, { dryRun = false } = {}) {
  const defPath = join(AUTOMATIONS_DIR, name, 'automation.json');
  if (!existsSync(defPath)) return { success: false, error: `Automation "${name}" not found.` };

  const def = JSON.parse(readFileSync(defPath, 'utf-8'));
  return executeAutomation(def, {}, dryRun);
}

// ── Internal: Scheduling ─────────────────────────────────────────

function scheduleAutomation(def) {
  // Clean up any existing schedule
  unscheduleAutomation(def.name);

  const entry = activeAutomations.get(def.name) || { definition: def };

  switch (def.trigger.type) {
    case 'cron': {
      if (!cron.validate(def.trigger.schedule)) {
        logger.error('AutomationEngine', `Invalid cron expression for "${def.name}": ${def.trigger.schedule}`);
        return;
      }
      entry.job = cron.schedule(def.trigger.schedule, () => {
        logger.info('AutomationEngine', `⏰ Cron triggered: "${def.name}"`);
        executeAutomation(def).catch(err =>
          logger.error('AutomationEngine', `Execution failed for "${def.name}": ${err.message}`)
        );
      });
      logger.info('AutomationEngine', `Scheduled cron: "${def.name}" → ${def.trigger.schedule}`);
      break;
    }

    case 'interval': {
      const ms = (def.trigger.minutes || 15) * 60 * 1000;
      entry.job = setInterval(() => {
        logger.info('AutomationEngine', `⏰ Interval triggered: "${def.name}"`);
        executeAutomation(def).catch(err =>
          logger.error('AutomationEngine', `Execution failed for "${def.name}": ${err.message}`)
        );
      }, ms);
      logger.info('AutomationEngine', `Scheduled interval: "${def.name}" → every ${def.trigger.minutes}m`);
      break;
    }

    case 'watch': {
      const watchPath = resolve(config.WORKING_DIR, def.trigger.path);
      if (!existsSync(watchPath)) {
        logger.warn('AutomationEngine', `Watch path doesn't exist yet for "${def.name}": ${watchPath}`);
        mkdirSync(watchPath, { recursive: true });
      }

      let debounce = null;
      entry.watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
        // Debounce rapid events (e.g. file saves)
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          logger.info('AutomationEngine', `👁 Watch triggered: "${def.name}" (${eventType}: ${filename})`);
          executeAutomation(def, { eventType, filename }).catch(err =>
            logger.error('AutomationEngine', `Execution failed for "${def.name}": ${err.message}`)
          );
        }, 1000);
      });
      logger.info('AutomationEngine', `Watching: "${def.name}" → ${watchPath}`);
      break;
    }

    default:
      logger.warn('AutomationEngine', `Unknown trigger type for "${def.name}": ${def.trigger.type}`);
  }

  activeAutomations.set(def.name, entry);
}

function unscheduleAutomation(name) {
  const entry = activeAutomations.get(name);
  if (!entry) return;

  // Stop cron job
  if (entry.job && typeof entry.job.stop === 'function') {
    entry.job.stop();
  }
  // Stop interval
  if (entry.job && typeof entry.job === 'number') {
    clearInterval(entry.job);
  }
  // Stop watcher
  if (entry.watcher && typeof entry.watcher.close === 'function') {
    entry.watcher.close();
  }

  entry.job = null;
  entry.watcher = null;
}

// ── Internal: Execution ──────────────────────────────────────────

async function executeAutomation(def, triggerContext = {}, dryRun = false) {
  const startTime = Date.now();

  // Build the task prompt with trigger context
  let taskPrompt = def.task;
  if (triggerContext.filename) {
    taskPrompt += `\n\n[Trigger context: File "${triggerContext.filename}" was ${triggerContext.eventType}d]`;
  }

  logger.info('AutomationEngine', `▶ Executing: "${def.name}" — "${taskPrompt.slice(0, 80)}..."`);

  try {
    const result = await runAgent(taskPrompt, {
      extraContext: `This is an automated background task named "${def.name}".
CRITICAL AUTOMATION RULES:
1. Gather the requested information and format it nicely as your ONLY response.
2. DO NOT attempt to use any tools to send messages (e.g. to Discord). Your text is routed automatically.
3. DO NOT include meta-commentary about the delivery mechanism, automation rules, or that the message will be sent. Just output the raw requested data.
4. Do not use emojis in your text output unless explicitly asked to. Use professional formatting.
Description of this task: ${def.description || ''}`,
    });

    const durationMs = Date.now() - startTime;
    logger.info('AutomationEngine', `✅ "${def.name}" completed in ${(durationMs / 1000).toFixed(1)}s`);

    // Update run stats
    def.lastRun = new Date().toISOString();
    def.runCount = (def.runCount || 0) + 1;
    const defPath = join(AUTOMATIONS_DIR, def.name, 'automation.json');
    writeFileSync(defPath, JSON.stringify(def, null, 2));

    // Send result to Discord if configured and not a dry run
    if (!dryRun && def.output?.type === 'discord' && discordClient) {
      await sendToDiscord(def, result.text);
    } else if (dryRun) {
      logger.info('AutomationEngine', `[DryRun] Skipping Discord post for "${def.name}"`);
    }

    return {
      success: true,
      name: def.name,
      output: result.text?.slice(0, 500),
      durationMs,
      steps: result.steps,
    };
  } catch (err) {
    logger.error('AutomationEngine', `❌ "${def.name}" failed: ${err.message}`);
    return { success: false, name: def.name, error: err.message };
  }
}

async function sendToDiscord(def, text) {
  if (!discordClient) return;

  try {
    const channelId = def.output.channelId;
    const channel = await discordClient.channels.fetch(channelId);
    if (!channel) {
      logger.warn('AutomationEngine', `Discord channel ${channelId} not found`);
      return;
    }

    const content = text || '(no output)';

    // Split if too long
    if (content.length <= 2000) {
      await channel.send(content);
    } else {
      const chunks = content.match(/[\s\S]{1,1990}/g) || [];
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    }

    logger.info('AutomationEngine', `📤 Sent result to Discord channel ${channelId}`);
  } catch (err) {
    logger.warn('AutomationEngine', `Failed to send to Discord: ${err.message}`);
  }
}

export default {
  startAutomationEngine,
  createAutomation,
  listAllAutomations,
  toggleAutomation,
  removeAutomation,
  triggerAutomation,
};
