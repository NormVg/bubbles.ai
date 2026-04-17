/**
 * Automation Tools — agent-facing tools for managing automations.
 *
 * Tools:
 *   createAutomation   — create a new automation with trigger + task
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
export const createAutomationTool = tool({
  description:
    'Create a persistent automation that runs automatically on a schedule or trigger. ' +
    'The automation runs through the full agent stack with access to ALL tools. ' +
    'Trigger types: "cron" (cron expression), "interval" (every N minutes), "watch" (file/folder changes). ' +
    'After creation, the automation is automatically test-fired to verify it works.',
  parameters: z.object({
    name: z.string().describe('Unique name in kebab-case (e.g. "stock-morning-report", "inbox-watcher")'),
    description: z.string().describe('What this automation does — shown in listings'),
    triggerType: z.enum(['cron', 'interval', 'watch']).describe('Type of trigger'),
    schedule: z.string().optional().describe('For cron: cron expression (e.g. "0 9 * * *"). For interval: not needed.'),
    minutes: z.number().optional().describe('For interval: how often in minutes (e.g. 30)'),
    watchPath: z.string().optional().describe('For watch: relative path to watch (e.g. "./workspace/inbox/")'),
    task: z.string().describe('The full task prompt — what the agent should do when triggered. Be specific and detailed.'),
    channelId: z.string().describe('Discord channel ID where results should be sent'),
  }),
  execute: async ({ name, description, triggerType, schedule, minutes, watchPath, task, channelId }) => {
    // Build trigger config
    const trigger = { type: triggerType };
    if (triggerType === 'cron') {
      if (!schedule) return { success: false, error: 'Cron trigger requires a "schedule" (cron expression).' };
      trigger.schedule = schedule;
    } else if (triggerType === 'interval') {
      trigger.minutes = minutes || 15;
    } else if (triggerType === 'watch') {
      if (!watchPath) return { success: false, error: 'Watch trigger requires a "watchPath".' };
      trigger.path = watchPath;
    }

    try {
      const def = await createAutomation({
        name,
        description,
        trigger,
        task,
        output: { type: 'discord', channelId },
        enabled: true,
      });

      // Auto-verification: fire a test run immediately
      logger.info('AutomationTools', `Auto-testing "${name}"...`);
      const testResult = await triggerAutomation(name);

      return {
        success: true,
        automation: {
          name: def.name,
          trigger: def.trigger,
          enabled: def.enabled,
          createdAt: def.createdAt,
        },
        testRun: {
          success: testResult.success,
          output: testResult.output?.slice(0, 300),
          error: testResult.error,
          durationMs: testResult.durationMs,
        },
        message: testResult.success
          ? `✅ Automation "${name}" created and verified! Test run passed in ${(testResult.durationMs / 1000).toFixed(1)}s.`
          : `⚠️ Automation "${name}" created but test run had issues: ${testResult.error || 'check output'}`,
      };
    } catch (err) {
      return { success: false, error: `Failed to create automation: ${err.message}` };
    }
  },
});

// ── listAutomations ──────────────────────────────────────────────
export const listAutomationsTool = tool({
  description: 'List all automations with their status, trigger type, schedule, last run time, and run count.',
  parameters: z.object({}),
  execute: async () => {
    const automations = listAllAutomations();

    if (automations.length === 0) {
      return { automations: [], message: 'No automations created yet.' };
    }

    const list = automations.map(a => ({
      name: a.name,
      description: a.description,
      trigger: a.trigger,
      enabled: a.enabled,
      lastRun: a.lastRun || 'never',
      runCount: a.runCount || 0,
    }));

    return { automations: list, count: list.length };
  },
});

// ── toggleAutomation ─────────────────────────────────────────────
export const toggleAutomationTool = tool({
  description: 'Enable or disable an automation without deleting it.',
  parameters: z.object({
    name: z.string().describe('Name of the automation to toggle'),
    enabled: z.boolean().describe('Set to true to enable, false to disable'),
  }),
  execute: async ({ name, enabled }) => {
    return toggleAutomation(name, enabled);
  },
});

// ── removeAutomation ─────────────────────────────────────────────
export const removeAutomationTool = tool({
  description: 'Permanently delete an automation and its schedule/watcher.',
  parameters: z.object({
    name: z.string().describe('Name of the automation to delete'),
  }),
  execute: async ({ name }) => {
    return removeAutomation(name);
  },
});

// ── triggerAutomation ────────────────────────────────────────────
export const triggerAutomationTool = tool({
  description: 'Manually fire an automation right now, regardless of its schedule. Great for testing.',
  parameters: z.object({
    name: z.string().describe('Name of the automation to trigger'),
  }),
  execute: async ({ name }) => {
    return triggerAutomation(name);
  },
});
