import { readFile } from 'fs/promises';
import { resolve } from 'path';
import config from '../config.js';
import {
  taskDecompositionPrompt,
  workspacePrompt,
  toolUsagePrompt,
  memoryUsagePrompt,
  errorHandlingPrompt,
  responseFormattingPrompt,
} from './templates.js';
import { buildSkillsPrompt } from '../core/skillLoader.js';
import { initMemory, searchMemories, listMemories, readMemory } from '../core/memoryStore.js';

let memoryInitialized = false;

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
 * Load system-level memories (agent's own notes, learned preferences).
 * These are always injected regardless of query.
 */
async function loadSystemMemories() {
  try {
    if (!memoryInitialized) {
      await initMemory();
      memoryInitialized = true;
    }

    const systemMems = await listMemories('system');
    if (systemMems.length === 0) return '';

    const entries = [];
    for (const mem of systemMems.slice(0, 5)) { // cap at 5 system memories
      const data = await readMemory('system', mem.name);
      if (data?.latest) {
        entries.push(`- **${data.metadata.title || mem.name}**: ${data.latest.replace(/^@\d{4}-\d{2}-\d{2}\n/, '').slice(0, 300)}`);
      }
    }

    if (entries.length === 0) return '';

    return `## Agent State (from memory/system/)
${entries.join('\n')}`;
  } catch {
    return '';
  }
}

/**
 * Load relevant memories for the current query.
 */
async function loadMemoryContext(userQuery) {
  try {
    if (!memoryInitialized) {
      await initMemory();
      memoryInitialized = true;
    }

    if (!userQuery) return '';

    const results = await searchMemories(userQuery, 3);
    if (results.length === 0) return '';

    const memoryLines = results.map(r =>
      `**${r.title}** (${r.type}): ${r.snippet}`
    );

    return `## Memory Context
The following memories from past sessions may be relevant:

${memoryLines.join('\n\n')}

Use memoryRead to get full details, memoryWrite to store new knowledge.`;
  } catch {
    return '';
  }
}

/**
 * Build the full system prompt for the orchestration agent.
 *
 * @param {object} [context]
 * @param {string} [context.taskPlan]       - Current task plan markdown
 * @param {string} [context.extraContext]   - Additional context from attachments
 * @param {string} [context.userQuery]      - The user's message (for memory search)
 * @param {import('../core/skillLoader.js').SkillMetadata[]} [context.skills] - Discovered skills
 * @returns {Promise<string>}
 */
export async function buildSystemPrompt(context = {}) {
  const soul = await loadSoul();

  const sections = [
    soul,
    taskDecompositionPrompt(),
    workspacePrompt(),
    toolUsagePrompt(),
    memoryUsagePrompt(),
    errorHandlingPrompt(),
    responseFormattingPrompt(),
  ];

  // Inject skill summaries
  if (context.skills && context.skills.length > 0) {
    sections.push(buildSkillsPrompt(context.skills));
  }

  // Inject system memories (agent's persistent state)
  const systemContext = await loadSystemMemories();
  if (systemContext) {
    sections.push(systemContext);
  }

  // Inject current environment context
  if (context.channelId) {
    sections.push(`
## Current Environment
**Discord Channel ID**: \`${context.channelId}\`
Use this ID whenever a tool requires a channelId to deliver results back to the user.
    `.trim());
  }

  // Inject relevant memories from long-term storage
  const memoryContext = await loadMemoryContext(context.userQuery);
  if (memoryContext) {
    sections.push(memoryContext);
  }

  // Inject active task plan
  if (context.taskPlan) {
    sections.push(`
## Execution Plan
The orchestrator has decomposed the user's request into these steps. You will execute them one at a time. The orchestrator will tell you which step to work on.

${context.taskPlan}

Focus entirely on the step the orchestrator assigns you. Use previous step results as context but do not redo completed work.
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
