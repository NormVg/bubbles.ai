import { readFile } from 'fs/promises';
import { resolve } from 'path';
import config from '../config.js';
import {
  taskDecompositionPrompt,
  toolUsagePrompt,
  errorHandlingPrompt,
  responseFormattingPrompt,
} from './templates.js';
import { buildSkillsPrompt } from '../core/skillLoader.js';

/**
 * Load soul.md from disk. Returns empty string if missing.
 */
async function loadSoul() {
  try {
    const soulPath = resolve(config.SOUL_FILE);
    return await readFile(soulPath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Build the full system prompt for the orchestration agent.
 *
 * @param {object} [context]
 * @param {string} [context.taskPlan]       - Current task plan markdown (if any)
 * @param {string} [context.extraContext]   - Additional context from attachments
 * @param {import('../core/skillLoader.js').SkillMetadata[]} [context.skills] - Discovered skills
 * @returns {Promise<string>}
 */
export async function buildSystemPrompt(context = {}) {
  const soul = await loadSoul();

  const sections = [
    soul,
    taskDecompositionPrompt(),
    toolUsagePrompt(),
    errorHandlingPrompt(),
    responseFormattingPrompt(),
  ];

  // Inject skill summaries if skills are discovered
  if (context.skills && context.skills.length > 0) {
    sections.push(buildSkillsPrompt(context.skills));
  }

  // Inject active task plan if present
  if (context.taskPlan) {
    sections.push(`
## Current Task Plan
${context.taskPlan}

Work through the uncompleted items in order. Mark them done as you complete them.
`.trim());
  }

  // Inject extra context (e.g. file contents from Discord attachments)
  if (context.extraContext) {
    sections.push(`
## User-Provided Context
${context.extraContext}
`.trim());
  }

  return sections.filter(Boolean).join('\n\n---\n\n');
}

export default { buildSystemPrompt };
