/**
 * Memory Store — Filesystem-based long-term memory for Bubbles.
 *
 * All memories are markdown files with YAML frontmatter.
 * Timeline-based: new entries are appended, never overwritten.
 *
 * Directory: .bubbles/memory/{episodic,projects,knowledge,tasks}/
 *
 * Memory file format:
 * ---
 * title: Project Name
 * type: project
 * created: 2026-04-16T22:00:00Z
 * last_used: 2026-04-16T22:00:00Z
 * importance: 7
 * relations: [other-memory-name]
 * ---
 *
 * @2026-04-16
 * Latest entry appended here.
 *
 * @2026-04-15
 * Older entry preserved.
 */

import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import logger from './logger.js';

const MEMORY_ROOT = '.bubbles/memory';
const MEMORY_TYPES = ['episodic', 'projects', 'knowledge', 'tasks', 'system'];

// ── Initialization ────────────────────────────────────────────────

/**
 * Ensure memory directory structure exists.
 */
export async function initMemory() {
  for (const type of MEMORY_TYPES) {
    const dir = path.join(MEMORY_ROOT, type);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
  logger.info('MemoryStore', `Initialized at ${MEMORY_ROOT}/`);
}

// ── Read ──────────────────────────────────────────────────────────

/**
 * Read a memory file. Returns metadata + latest entry by default.
 *
 * @param {string} type - Memory category (episodic, projects, knowledge, tasks)
 * @param {string} name - Memory name (without .md)
 * @param {object} [opts]
 * @param {boolean} [opts.full] - Return full history, not just latest
 * @returns {{ metadata: object, latest: string, entries: string[], raw: string } | null}
 */
export async function readMemory(type, name, opts = {}) {
  const filePath = resolveMemoryPath(type, name);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = await readFile(filePath, 'utf-8');
    const { metadata, entries } = parseMemoryFile(raw);

    // Update last_used
    const updated = updateMetadata(raw, { last_used: new Date().toISOString() });
    await writeFile(filePath, updated);

    return {
      metadata,
      latest: entries[0] || '',
      entries: opts.full ? entries : [entries[0] || ''],
      raw: opts.full ? raw : undefined,
    };
  } catch (err) {
    logger.error('MemoryStore', `Read failed: ${filePath}: ${err.message}`);
    return null;
  }
}

// ── Write ─────────────────────────────────────────────────────────

/**
 * Write to a memory file. Appends a new timestamped entry.
 * Creates the file if it doesn't exist.
 *
 * @param {string} type - Memory category
 * @param {string} name - Memory name (without .md, kebab-case)
 * @param {string} content - The content to store
 * @param {object} [meta] - Optional metadata overrides
 * @param {string} [meta.title] - Human-readable title
 * @param {number} [meta.importance] - 1-10
 * @param {string[]} [meta.relations] - Related memory names
 */
export async function writeMemory(type, name, content, meta = {}) {
  const safeType = MEMORY_TYPES.includes(type) ? type : 'knowledge';
  await initTypeDir(safeType);
  const filePath = resolveMemoryPath(safeType, name);
  const now = new Date().toISOString();
  const dateTag = now.split('T')[0]; // YYYY-MM-DD

  if (existsSync(filePath)) {
    // Append new entry to existing file
    const existing = await readFile(filePath, 'utf-8');
    const updated = updateMetadata(existing, {
      last_used: now,
      ...(meta.importance ? { importance: meta.importance } : {}),
      ...(meta.relations ? { relations: meta.relations } : {}),
    });

    // Insert new entry after the frontmatter
    const parts = updated.split('\n---\n');
    const frontmatter = parts[0] + '\n---\n';
    const body = parts.slice(1).join('\n---\n');

    const newEntry = `\n@${dateTag}\n${content.trim()}\n`;
    const result = frontmatter + newEntry + '\n' + body;

    await writeFile(filePath, result);
    logger.info('MemoryStore', `Appended to ${type}/${name}`);
  } else {
    // Create new memory file
    const title = meta.title || name.replace(/-/g, ' ');
    const importance = meta.importance || 5;
    const relations = meta.relations || [];

    const file = `---
title: ${title}
type: ${type}
created: ${now}
last_used: ${now}
importance: ${importance}
relations: [${relations.join(', ')}]
---

@${dateTag}
${content.trim()}
`;

    await writeFile(filePath, file);
    logger.info('MemoryStore', `Created ${type}/${name}.md`);
  }
}

// ── List ──────────────────────────────────────────────────────────

/**
 * List all memories, optionally filtered by type.
 *
 * @param {string} [type] - Filter by category. If omitted, lists all.
 * @returns {{ type: string, name: string, title: string, importance: number, last_used: string }[]}
 */
export async function listMemories(type) {
  const types = type ? [type] : MEMORY_TYPES;
  const results = [];

  for (const t of types) {
    const dir = path.join(MEMORY_ROOT, t);
    if (!existsSync(dir)) continue;

    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        try {
          const raw = await readFile(path.join(dir, file), 'utf-8');
          const { metadata } = parseMemoryFile(raw);
          results.push({
            type: t,
            name: file.replace('.md', ''),
            title: metadata.title || file.replace('.md', ''),
            importance: metadata.importance || 5,
            last_used: metadata.last_used || '',
          });
        } catch {
          // Skip corrupt files
        }
      }
    } catch {
      // Skip missing dirs
    }
  }

  // Sort by importance (descending), then last_used (most recent first)
  results.sort((a, b) => (b.importance - a.importance) || (b.last_used.localeCompare(a.last_used)));
  return results;
}

// ── Search ────────────────────────────────────────────────────────

/**
 * Search all memories by keyword (case-insensitive).
 * Returns matching memories with a snippet.
 *
 * @param {string} query - Search query
 * @param {number} [maxResults=5] - Max results
 * @returns {{ type: string, name: string, title: string, snippet: string }[]}
 */
export async function searchMemories(query, maxResults = 5) {
  const results = [];
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(Boolean);

  for (const type of MEMORY_TYPES) {
    const dir = path.join(MEMORY_ROOT, type);
    if (!existsSync(dir)) continue;

    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        try {
          const raw = await readFile(path.join(dir, file), 'utf-8');
          const lower = raw.toLowerCase();

          // Check if any query term matches
          const matches = queryTerms.filter(term => lower.includes(term));
          if (matches.length === 0) continue;

          const { metadata, entries } = parseMemoryFile(raw);

          // Find the best snippet (first entry containing a match)
          let snippet = entries[0] || '';
          for (const entry of entries) {
            if (queryTerms.some(term => entry.toLowerCase().includes(term))) {
              snippet = entry;
              break;
            }
          }

          // Truncate snippet
          if (snippet.length > 200) {
            snippet = snippet.slice(0, 200) + '...';
          }

          results.push({
            type,
            name: file.replace('.md', ''),
            title: metadata.title || file.replace('.md', ''),
            snippet,
            score: matches.length / queryTerms.length, // relevance score
          });
        } catch {
          // Skip corrupt files
        }
      }
    } catch {
      // Skip missing dirs
    }
  }

  // Sort by relevance score, then importance
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// ── Relations ─────────────────────────────────────────────────────

/**
 * Get memories related to a given memory.
 *
 * @param {string} type
 * @param {string} name
 * @returns {{ type: string, name: string, title: string }[]}
 */
export async function getRelated(type, name) {
  const memory = await readMemory(type, name);
  if (!memory?.metadata?.relations) return [];

  const relations = memory.metadata.relations;
  const results = [];

  for (const relName of relations) {
    // Search across all types for the related memory
    for (const t of MEMORY_TYPES) {
      const filePath = resolveMemoryPath(t, relName);
      if (existsSync(filePath)) {
        const raw = await readFile(filePath, 'utf-8');
        const { metadata } = parseMemoryFile(raw);
        results.push({
          type: t,
          name: relName,
          title: metadata.title || relName,
        });
        break;
      }
    }
  }

  return results;
}

// ── Capture (ASCII Tree) ──────────────────────────────────────────

/**
 * Generate an ASCII tree representation of the memory directory.
 * Includes file counts per category and optional metadata per file.
 *
 * @param {boolean} [withMetadata=false] - Include importance and relations
 * @returns {string} ASCII tree string
 */
export async function captureMemoryTree(withMetadata = false) {
  await initMemory();
  const lines = ['memory/'];

  for (let i = 0; i < MEMORY_TYPES.length; i++) {
    const type = MEMORY_TYPES[i];
    const dir = path.join(MEMORY_ROOT, type);
    const isLast = i === MEMORY_TYPES.length - 1;
    const prefix = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? '    ' : '│   ';

    let files = [];
    try {
      files = (await readdir(dir)).filter(f => f.endsWith('.md'));
    } catch {
      // dir doesn't exist
    }

    lines.push(`${prefix}${type}/ (${files.length})`);

    for (let j = 0; j < files.length; j++) {
      const file = files[j];
      const isLastFile = j === files.length - 1;
      const filePrefix = isLastFile ? '└── ' : '├── ';

      lines.push(`${childPrefix}${filePrefix}${file}`);

      if (withMetadata) {
        try {
          const raw = await readFile(path.join(dir, file), 'utf-8');
          const { metadata } = parseMemoryFile(raw);
          const metaPrefix = childPrefix + (isLastFile ? '    ' : '│   ');

          if (metadata.importance) {
            lines.push(`${metaPrefix}├─ importance: ${metadata.importance}`);
          }
          if (metadata.relations && metadata.relations.length > 0) {
            const rels = Array.isArray(metadata.relations) ? metadata.relations.join(', ') : metadata.relations;
            lines.push(`${metaPrefix}└─ relations: ${rels}`);
          }
        } catch {
          // skip
        }
      }
    }
  }

  return lines.join('\n');
}

export default {
  initMemory,
  readMemory,
  writeMemory,
  listMemories,
  searchMemories,
  getRelated,
  captureMemoryTree,
};


function resolveMemoryPath(type, name) {
  const safeName = name.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
  return path.join(MEMORY_ROOT, type, `${safeName}.md`);
}

async function initTypeDir(type) {
  const dir = path.join(MEMORY_ROOT, type);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Parse a memory file into metadata and timeline entries.
 */
function parseMemoryFile(raw) {
  const metadata = {};
  let body = raw;

  // Extract YAML frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) {
    body = raw.slice(fmMatch[0].length);

    // Simple YAML parser (no dependency needed)
    const lines = fmMatch[1].split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        let value = match[2].trim();
        // Parse arrays: [a, b, c]
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
        }
        // Parse numbers
        else if (/^\d+$/.test(value)) {
          value = parseInt(value);
        }
        metadata[match[1]] = value;
      }
    }
  }

  // Split body into timeline entries (delimited by @YYYY-MM-DD or @latest)
  const entries = [];
  const entryBlocks = body.split(/\n(?=@\d{4}-\d{2}-\d{2}|@latest)/);

  for (const block of entryBlocks) {
    const trimmed = block.trim();
    if (trimmed) {
      entries.push(trimmed);
    }
  }

  return { metadata, entries };
}

/**
 * Update metadata fields in a memory file's frontmatter.
 */
function updateMetadata(raw, updates) {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) return raw;

  let frontmatter = fmMatch[1];

  for (const [key, value] of Object.entries(updates)) {
    const displayValue = Array.isArray(value) ? `[${value.join(', ')}]` : value;
    const regex = new RegExp(`^${key}:.*$`, 'm');

    if (regex.test(frontmatter)) {
      frontmatter = frontmatter.replace(regex, `${key}: ${displayValue}`);
    } else {
      frontmatter += `\n${key}: ${displayValue}`;
    }
  }

  return `---\n${frontmatter}\n---\n` + raw.slice(fmMatch[0].length);
}


