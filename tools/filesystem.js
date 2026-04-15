import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { resolve, relative, join } from 'path';
import { tool } from 'ai';
import { z } from 'zod';
import config from '../config.js';
import logger from '../core/logger.js';

const MAX_FILE_SIZE = 100_000; // chars — prevent loading massive files into context

// ── Read File ──────────────────────────────────────────────────
export const readFileTool = tool({
  description:
    'Read the contents of a file. Returns the file text. Use for reading source code, configs, logs, etc.',
  parameters: z.object({
    path: z.string().describe('Absolute or relative path to the file'),
    maxLines: z
      .number()
      .optional()
      .describe('Max number of lines to return (default: all)'),
  }),
  execute: async ({ path, maxLines }) => {
    try {
      const absPath = resolve(config.WORKING_DIR, path);
      logger.debug('FS', `Reading: ${absPath}`);

      const content = await readFile(absPath, 'utf-8');

      let result = content.slice(0, MAX_FILE_SIZE);
      if (maxLines) {
        result = result.split('\n').slice(0, maxLines).join('\n');
      }

      if (content.length > MAX_FILE_SIZE) {
        result += `\n\n[... truncated, file is ${content.length} chars total]`;
      }

      return { content: result, path: absPath };
    } catch (err) {
      return { error: err.message, path };
    }
  },
});

// ── Write File ─────────────────────────────────────────────────
export const writeFileTool = tool({
  description:
    'Write content to a file. Creates the file if it does not exist. Creates parent directories automatically.',
  parameters: z.object({
    path: z.string().describe('Absolute or relative path to the file'),
    content: z.string().describe('The complete file content to write'),
  }),
  execute: async ({ path, content }) => {
    try {
      const absPath = resolve(config.WORKING_DIR, path);
      logger.info('FS', `Writing: ${absPath} (${content.length} chars)`);

      // Ensure parent directory exists
      const dir = absPath.substring(0, absPath.lastIndexOf('/'));
      await mkdir(dir, { recursive: true });

      await writeFile(absPath, content, 'utf-8');
      return { success: true, path: absPath, bytesWritten: content.length };
    } catch (err) {
      return { error: err.message, path };
    }
  },
});

// ── List Directory ─────────────────────────────────────────────
export const listDirTool = tool({
  description:
    'List the contents of a directory. Returns files and subdirectories with sizes. Use to explore project structure.',
  parameters: z.object({
    path: z
      .string()
      .optional()
      .describe('Directory path (defaults to project root)'),
    recursive: z
      .boolean()
      .optional()
      .describe('If true, list recursively (default: false)'),
    maxDepth: z
      .number()
      .optional()
      .describe('Max depth for recursive listing (default: 3)'),
  }),
  execute: async ({ path, recursive = false, maxDepth = 3 }) => {
    try {
      const absPath = resolve(config.WORKING_DIR, path || '.');
      logger.debug('FS', `Listing: ${absPath}`);

      const entries = await listRecursive(absPath, recursive, maxDepth, 0);
      return { path: absPath, entries };
    } catch (err) {
      return { error: err.message, path };
    }
  },
});

async function listRecursive(dir, recursive, maxDepth, currentDepth) {
  const items = await readdir(dir, { withFileTypes: true });
  const results = [];

  for (const item of items) {
    // Skip hidden dirs and node_modules
    if (item.name.startsWith('.') || item.name === 'node_modules') continue;

    const fullPath = join(dir, item.name);
    const relPath = relative(config.WORKING_DIR, fullPath);

    if (item.isDirectory()) {
      const entry = { name: relPath, type: 'dir' };
      results.push(entry);

      if (recursive && currentDepth < maxDepth) {
        const children = await listRecursive(fullPath, true, maxDepth, currentDepth + 1);
        results.push(...children);
      }
    } else {
      try {
        const info = await stat(fullPath);
        results.push({
          name: relPath,
          type: 'file',
          size: info.size,
        });
      } catch {
        results.push({ name: relPath, type: 'file' });
      }
    }
  }

  return results;
}

// ── Send File (queue for Discord attachment) ───────────────────
// Files queued here are picked up by the Discord handler and sent as attachments.
const pendingFiles = [];

export function getPendingFiles() {
  const files = [...pendingFiles];
  pendingFiles.length = 0; // Clear after reading
  return files;
}

export const sendFileTool = tool({
  description:
    'Send a file to the user as a Discord attachment. Use this to share files, images, logs, or any file from the filesystem. The file will be attached to the bot\'s reply.',
  parameters: z.object({
    path: z.string().describe('Absolute or relative path to the file to send'),
    description: z
      .string()
      .optional()
      .describe('Optional description to include with the file'),
  }),
  execute: async ({ path: filePath, description }) => {
    try {
      const absPath = resolve(config.WORKING_DIR, filePath);
      logger.info('FS', `Queuing file for send: ${absPath}`);

      // Verify file exists and get info
      const info = await stat(absPath);
      if (!info.isFile()) {
        return { error: `${absPath} is not a file` };
      }

      // Discord file size limit: 25MB (for non-boosted servers)
      const MAX_DISCORD_FILE = 25 * 1024 * 1024;
      if (info.size > MAX_DISCORD_FILE) {
        return { error: `File too large for Discord (${(info.size / 1024 / 1024).toFixed(1)}MB, max 25MB)` };
      }

      pendingFiles.push({
        path: absPath,
        description: description || null,
        size: info.size,
      });

      return {
        success: true,
        path: absPath,
        size: info.size,
        message: `File queued for sending: ${absPath} (${(info.size / 1024).toFixed(1)} KB)`,
      };
    } catch (err) {
      return { error: err.message, path: filePath };
    }
  },
});

export default { readFileTool, writeFileTool, listDirTool, sendFileTool, getPendingFiles };

