/**
 * Skill Loader — discovers and loads Agent Skills from SKILL.md files.
 *
 * Uses progressive disclosure:
 *  1. Discovery: scan directories, parse only frontmatter (name + description)
 *  2. Activation: loadSkill tool reads the full SKILL.md body on demand
 *
 * Skill directories searched (in order, first name wins):
 *  - .agents/skills/   (project-level)
 *  - .agent/skills/    (alt project-level)
 *  - _agents/skills/   (alt project-level)
 *  - ~/.config/agent/skills/  (user-level)
 */

import { readFile, readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import config from '../config.js';
import logger from './logger.js';

/**
 * @typedef {Object} SkillMetadata
 * @property {string} name
 * @property {string} description
 * @property {string} path - absolute path to the skill directory
 */

/**
 * Parse YAML-like frontmatter from a SKILL.md file.
 * Handles simple `key: value` pairs without requiring a YAML library.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) return null;

  const meta = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    meta[key] = value;
  }
  return meta;
}

/**
 * Strip frontmatter from SKILL.md content, returning just the body.
 */
export function stripFrontmatter(content) {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

/**
 * Discover all skills from the configured directories.
 * Returns an array of SkillMetadata (name, description, path).
 *
 * @returns {Promise<SkillMetadata[]>}
 */
export async function discoverSkills() {
  const workDir = resolve(config.WORKING_DIR);
  const directories = [
    join(workDir, '.agents', 'skills'),
    join(workDir, '.agent', 'skills'),
    join(workDir, '_agents', 'skills'),
    join(homedir(), '.config', 'agent', 'skills'),
  ];

  /** @type {SkillMetadata[]} */
  const skills = [];
  const seenNames = new Set();

  for (const dir of directories) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // Directory doesn't exist, skip
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = join(dir, entry.name);
      const skillFile = join(skillDir, 'SKILL.md');

      try {
        const content = await readFile(skillFile, 'utf-8');
        const meta = parseFrontmatter(content);

        if (!meta?.name || !meta?.description) {
          logger.warn('SkillLoader', `Skipping ${skillFile}: missing name or description in frontmatter`);
          continue;
        }

        // First skill with a given name wins (allows project overrides)
        if (seenNames.has(meta.name)) continue;
        seenNames.add(meta.name);

        skills.push({
          name: meta.name,
          description: meta.description,
          path: skillDir,
        });

        logger.debug('SkillLoader', `Discovered skill: ${meta.name} (${skillDir})`);
      } catch {
        continue; // No valid SKILL.md, skip
      }
    }
  }

  logger.info('SkillLoader', `Discovered ${skills.length} skill(s)`);
  return skills;
}

/**
 * Load the full content of a skill by name.
 *
 * @param {SkillMetadata[]} skills - discovered skills array
 * @param {string} name - skill name to load
 * @returns {Promise<{ skillDirectory: string, content: string } | { error: string }>}
 */
export async function loadSkillContent(skills, name) {
  const skill = skills.find(
    (s) => s.name.toLowerCase() === name.toLowerCase()
  );

  if (!skill) {
    return { error: `Skill '${name}' not found. Available: ${skills.map(s => s.name).join(', ')}` };
  }

  const skillFile = join(skill.path, 'SKILL.md');

  try {
    const content = await readFile(skillFile, 'utf-8');
    const body = stripFrontmatter(content);

    logger.info('SkillLoader', `Loaded skill: ${skill.name}`);

    return {
      skillDirectory: skill.path,
      content: body,
    };
  } catch (err) {
    return { error: `Failed to read skill '${name}': ${err.message}` };
  }
}

/**
 * Build the skills section for the system prompt.
 * Only includes name + description (progressive disclosure).
 *
 * @param {SkillMetadata[]} skills
 * @returns {string}
 */
export function buildSkillsPrompt(skills) {
  if (skills.length === 0) return '';

  const skillsList = skills
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join('\n');

  return `
## Available Skills

You have access to specialized skills. Use the \`loadSkill\` tool to load a skill's full instructions when the user's request would benefit from specialized knowledge.

${skillsList}

**How to use**: Call the \`loadSkill\` tool with the skill name. The full instructions will be loaded into your context. Then follow those instructions to complete the task.
`.trim();
}

export default {
  discoverSkills,
  loadSkillContent,
  buildSkillsPrompt,
  stripFrontmatter,
};
