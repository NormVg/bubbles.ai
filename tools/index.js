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
import { createPlanTool, markStepTool } from './taskTools.js';
import { webSearchTool, webScrapeTool } from './web.js';
import { memoryReadTool, memoryWriteTool, memoryRecallTool, memoryListTool, memoryCaptureTool } from './memoryTools.js';
import { visionAnalyzeTool } from './vision.js';
import { bgRunTool, bgListTool, bgReadTool, bgKillTool } from './bgProcess.js';
import { forgeToolTool, listForgedTool, removeForgedTool, loadCustomTools, getCustomTools } from './toolForge.js';

/** Core tools that are always available */
export const coreTools = {
  shell: shellTool,
  readFile: readFileTool,
  writeFile: writeFileTool,
  listDir: listDirTool,
  sendFile: sendFileTool,
  createPlan: createPlanTool,
  markStep: markStepTool,
  webSearch: webSearchTool,
  webScrape: webScrapeTool,
  memoryRead: memoryReadTool,
  memoryWrite: memoryWriteTool,
  memoryList: memoryListTool,
  memoryCapture: memoryCaptureTool,
  visionAnalyze: visionAnalyzeTool,
  bgRun: bgRunTool,
  bgList: bgListTool,
  bgRead: bgReadTool,
  bgKill: bgKillTool,
  forgeTool: forgeToolTool,
  listForged: listForgedTool,
  removeForged: removeForgedTool,
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

  // Merge any custom tools created via forgeTool
  const custom = getCustomTools();
  Object.assign(tools, custom);

  return tools;
}

// Re-export for startup wiring
export { loadCustomTools };

// Default export for backward compat (static tools only)
export const allTools = coreTools;
export default coreTools;
