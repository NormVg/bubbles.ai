/**
 * Automation Tools — agent-facing tools for managing automations.
 *
 * IMPORTANT: Automations are NOT projects. The agent should NEVER create
 * workspace folders, scripts, or files for automations. The `createAutomation`
 * tool is a single call that sets up everything internally.
 *
 * Tools:
 *   createAutomation   — ONE tool call to create a complete automation
 *   listAutomations    — list all automations and their status
 *   toggleAutomation   — enable/disable an automation
 *   removeAutomation   — delete an automation
 *   triggerAutomation  — manually fire an automation right now
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  createAutomation,
  listAllAutomations,
  toggleAutomation,
  removeAutomation,
  triggerAutomation,
} from '../core/automationEngine.js';
import logger from '../core/logger.js';

// ── createAutomation ─────────────────────────────────────────────
export const createAutomationToolFactory = (channelId) => tool({
  description:
    'Create a persistent automation in ONE call. Do NOT create workspace folders, scripts, or files — ' +
    'this tool handles everything internally. The "task" parameter is a natural language prompt that the ' +
    'full agent will execute each time the automation fires (with access to all tools like webSearch, memoryWrite, etc.). ' +
    'Trigger types: "cron" (cron expression), "interval" (every N minutes), "watch" (file/folder changes). ' +
    'After creation, a quick validation is run to verify the config is correct.',
  parameters: z.object({
    name: z.string().describe('Unique name in kebab-case (e.g. "stock-morning-report", "inbox-watcher")'),
    description: z.string().describe('What this automation does'),
    triggerType: z.enum(['cron', 'interval', 'watch']).describe('Trigger type: cron, interval, or watch'),
    schedule: z.string().optional().describe('For cron: cron expression like "0 9 * * *" or "*/30 * * * *"'),
    minutes: z.number().optional().describe('For interval: how often in minutes (e.g. 30)'),
    watchPath: z.string().optional().describe('For watch: relative path to watch (e.g. "./workspace/inbox/")'),
    task: z.string().describe(
      'The FULL task prompt the agent executes when triggered. Be detailed and specific. ' +
      'Example: "Search for the current Nifty 50 price using webSearch, then send me a 3-line summary with the price, change, and trend."'
    ),
  }),
  execute: async ({ name, description, triggerType, schedule, minutes, watchPath, task }) => {
    // Validate triggerType
    if (!triggerType || !['cron', 'interval', 'watch'].includes(triggerType)) {
      return { success: false, error: `Invalid triggerType "${triggerType}". Must be one of: cron, interval, watch.` };
    }

    // Validate trigger-specific params
    if (triggerType === 'cron' && !schedule) {
      return { success: false, error: 'Cron trigger requires a "schedule" param (e.g. "0 9 * * *").' };
    }
    if (triggerType === 'watch' && !watchPath) {
      return { success: false, error: 'Watch trigger requires a "watchPath" param (e.g. "./workspace/inbox/").' };
    }

    // Build trigger config
    const trigger = { type: triggerType };
    if (triggerType === 'cron') trigger.schedule = schedule;
    else if (triggerType === 'interval') trigger.minutes = minutes || 15;
    else if (triggerType === 'watch') trigger.path = watchPath;

    try {
      const def = await createAutomation({
        name,
        description,
        trigger,
        task,
        output: { type: 'discord', channelId },
        enabled: true,
      });

      return {
        success: true,
        automation: {
          name: def.name,
          description: def.description,
          trigger: def.trigger,
          enabled: def.enabled,
          createdAt: def.createdAt,
        },
        message: `[Success] Automation "${name}" created and scheduled! It will fire based on the ${triggerType} trigger and send results to the current Discord channel.`,
      };
    } catch (err) {
      return { success: false, error: `Failed to create automation: ${err.message}` };
    }
  },
});

// ── listAutomations ──────────────────────────────────────────────
export const listAutomationsTool = tool({
  description: 'List all automations with their status, trigger, last run time, and run count.',
  parameters: z.object({}),
  execute: async () => {
    const automations = listAllAutomations();
    if (automations.length === 0) return { automations: [], message: 'No automations created yet.' };

    return {
      automations: automations.map(a => ({
        name: a.name,
        description: a.description,
        trigger: a.trigger,
        enabled: a.enabled,
        lastRun: a.lastRun || 'never',
        runCount: a.runCount || 0,
      })),
      count: automations.length,
    };
  },
});

// ── toggleAutomation ─────────────────────────────────────────────
export const toggleAutomationTool = tool({
  description: 'Enable or disable an automation without deleting it.',
  parameters: z.object({
    name: z.string().describe('Automation name'),
    enabled: z.boolean().describe('true to enable, false to disable'),
  }),
  execute: async ({ name, enabled }) => toggleAutomation(name, enabled),
});

// ── removeAutomation ─────────────────────────────────────────────
export const removeAutomationTool = tool({
  description: 'Permanently delete an automation.',
  parameters: z.object({
    name: z.string().describe('Automation name to delete'),
  }),
  execute: async ({ name }) => removeAutomation(name),
});

// ── triggerAutomation ────────────────────────────────────────────
export const triggerAutomationTool = tool({
  description: 'Manually fire an automation right now — great for testing. Results are sent to Discord.',
  parameters: z.object({
    name: z.string().describe('Automation name to trigger'),
  }),
  execute: async ({ name }) => triggerAutomation(name),
});
