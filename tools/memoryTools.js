/**
 * Memory tools — Agent-facing interface to the long-term memory system.
 *
 * Five tools:
 * - memoryRead:    Read a specific memory
 * - memoryWrite:   Store new knowledge (always appends)
 * - memoryRecall:  Search memories by keyword/topic
 * - memoryList:    Browse available memories by category
 * - memoryCapture: ASCII tree view of the memory directory
 */

import { tool } from 'ai';
import { z } from 'zod';
import { readMemory, writeMemory, searchMemories, listMemories, captureMemoryTree } from '../core/memoryStore.js';
import logger from '../core/logger.js';

const MEMORY_TYPES = ['episodic', 'projects', 'knowledge', 'tasks', 'system'];

/**
 * memoryRead — Read a specific memory file.
 */
export const memoryReadTool = tool({
  description:
    'Read a memory from long-term storage. Returns the latest entry and metadata. ' +
    'Use when you need to recall specific information about a project, task, or topic.',
  parameters: z.object({
    type: z.enum(MEMORY_TYPES).describe('Memory category: episodic, projects, knowledge, or tasks'),
    name: z.string().describe('Memory name (kebab-case, e.g. "music-player" or "user-preferences")'),
    full: z.boolean().optional().describe('If true, return all timeline entries, not just latest'),
  }),
  execute: async ({ type, name, full = false }) => {
    logger.info('MemoryTool', `Reading: ${type}/${name}`);
    const result = await readMemory(type, name, { full });

    if (!result) {
      return { found: false, message: `No memory found: ${type}/${name}` };
    }

    return {
      found: true,
      title: result.metadata.title,
      importance: result.metadata.importance,
      relations: result.metadata.relations || [],
      latest: result.latest,
      entries: result.entries,
    };
  },
});

/**
 * memoryWrite — Store new knowledge in long-term memory.
 */
export const memoryWriteTool = tool({
  description:
    'Save information to long-term memory. Appends a new timestamped entry (never overwrites). ' +
    'Use to remember: project details, user preferences, completed tasks, important facts, ' +
    'technical decisions, or anything worth remembering across sessions.',
  parameters: z.object({
    type: z.enum(MEMORY_TYPES).describe(
      'Category: "projects" for project work, "knowledge" for facts/preferences, ' +
      '"tasks" for active goals, "episodic" for events/conversations, "system" for agent self-knowledge'
    ),
    name: z.string().describe('Memory name in kebab-case (e.g. "music-player", "user-preferences")'),
    content: z.string().describe('The information to store'),
    title: z.string().optional().describe('Human-readable title (defaults to name)'),
    importance: z.number().optional().describe('Importance 1-10 (default 5)'),
    relations: z.array(z.string()).optional().describe('Related memory names to link to'),
  }),
  execute: async ({ type, name, content, title, importance, relations }) => {
    // Fallback if type is invalid/undefined
    const safeType = MEMORY_TYPES.includes(type) ? type : 'knowledge';
    logger.info('MemoryTool', `Writing: ${safeType}/${name}`);

    await writeMemory(safeType, name, content, { title, importance, relations });
    return { saved: true, path: `${safeType}/${name}`, message: `Memory stored: ${safeType}/${name}` };
  },
});

/**
 * memoryRecall — Search memories by keyword or topic.
 */
export const memoryRecallTool = tool({
  description:
    'Search long-term memory by keyword or topic. Returns matching memories with snippets. ' +
    'Use when: user references past work, asks "remember when...", or you need context ' +
    'about user preferences, previous projects, or stored knowledge.',
  parameters: z.object({
    query: z.string().describe('Search query — keywords or topic to recall'),
    maxResults: z.number().optional().describe('Max results (default: 5)'),
  }),
  execute: async ({ query, maxResults = 5 }) => {
    logger.info('MemoryTool', `Recalling: "${query}"`);
    const results = await searchMemories(query, maxResults);

    if (results.length === 0) {
      return { found: false, message: 'No matching memories found.', results: [] };
    }

    return {
      found: true,
      count: results.length,
      results: results.map(r => ({
        type: r.type,
        name: r.name,
        title: r.title,
        snippet: r.snippet,
      })),
    };
  },
});

/**
 * memoryList — List available memories by category.
 */
export const memoryListTool = tool({
  description:
    'List all stored memories, optionally filtered by category. ' +
    'Use to browse what the agent knows, discover related memories, or check available knowledge.',
  parameters: z.object({
    type: z.enum([...MEMORY_TYPES, 'all']).optional().describe(
      'Filter by category, or "all" to list everything (default: all)'
    ),
  }),
  execute: async ({ type }) => {
    logger.info('MemoryTool', `Listing: ${type || 'all'}`);
    const filterType = type === 'all' ? undefined : type;
    const results = await listMemories(filterType);

    if (results.length === 0) {
      return { count: 0, message: 'No memories stored yet.', memories: [] };
    }

    return {
      count: results.length,
      memories: results.map(r => ({
        type: r.type,
        name: r.name,
        title: r.title,
        importance: r.importance,
      })),
    };
  },
});

/**
 * memoryCapture — ASCII tree of the memory directory.
 */
export const memoryCaptureTool = tool({
  description:
    'Get an ASCII tree view of the entire memory directory. Shows all stored memories ' +
    'organized by category with file counts. Use to discover what knowledge is available ' +
    'before deciding what to read. Set withMetadata=true to include importance and relations.',
  parameters: z.object({
    withMetadata: z.boolean().optional().describe('Include importance and relation metadata (default: false)'),
  }),
  execute: async ({ withMetadata = false }) => {
    logger.info('MemoryTool', `Capturing tree (metadata: ${withMetadata})`);
    const tree = await captureMemoryTree(withMetadata);
    return { tree };
  },
});

export default { memoryReadTool, memoryWriteTool, memoryRecallTool, memoryListTool, memoryCaptureTool };
