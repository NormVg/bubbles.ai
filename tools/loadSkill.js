/**
 * loadSkill tool — allows the agent to load full skill instructions on demand.
 * Uses progressive disclosure: only loads the full SKILL.md body when called.
 */

import { z } from 'zod';
import { tool } from 'ai';
import { loadSkillContent } from '../core/skillLoader.js';
import logger from '../core/logger.js';

/**
 * Create the loadSkill tool with access to the discovered skills array.
 *
 * @param {import('../core/skillLoader.js').SkillMetadata[]} skills
 * @returns {ReturnType<typeof tool>}
 */
export function createLoadSkillTool(skills) {
  return tool({
    description:
      'Load a skill to get specialized instructions for a specific task. ' +
      'Call this when the user\'s request matches an available skill description. ' +
      'Returns the full skill instructions and the skill directory path.',
    parameters: z.object({
      name: z
        .string()
        .describe('The name of the skill to load (e.g. "pdf-processing")'),
    }),
    execute: async ({ name }) => {
      logger.info('LoadSkillTool', `Loading skill: ${name}`);
      const result = await loadSkillContent(skills, name);

      if (result.error) {
        logger.warn('LoadSkillTool', result.error);
      } else {
        logger.info('LoadSkillTool', `Skill loaded: ${name} (${result.content.length} chars)`);
      }

      return result;
    },
  });
}

export default { createLoadSkillTool };
