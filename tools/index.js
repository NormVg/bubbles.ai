/**
 * Tool registry — exports all tools as a single object
 * for the orchestration agent.
 *
 * Static tools are always available.
 * Dynamic tools (like loadSkill) are added at runtime via buildTools().
 */

import { shellTool } from './shell.js';
import { readFileTool, writeFileTool, listDirTool, sendFileTool } from './filesystem.js';
import { createLoadSkillTool } from './loadSkill.js';

/** Core tools that are always available */
export const coreTools = {
  shell: shellTool,
  readFile: readFileTool,
  writeFile: writeFileTool,
  listDir: listDirTool,
  sendFile: sendFileTool,
};

/**
 * Build the full tool set, including dynamic tools like loadSkill.
 *
 * @param {object} [options]
 * @param {import('../core/skillLoader.js').SkillMetadata[]} [options.skills] - Discovered skills
 * @returns {object} All tools for the agent
 */
export function buildTools(options = {}) {
  const tools = { ...coreTools };

  // Add loadSkill tool if skills are available
  if (options.skills && options.skills.length > 0) {
    tools.loadSkill = createLoadSkillTool(options.skills);
  }

  return tools;
}

// Default export for backward compat (static tools only)
export const allTools = coreTools;
export default coreTools;
