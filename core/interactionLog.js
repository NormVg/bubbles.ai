/**
 * Interaction Logger — Structured JSON log of every Discord interaction.
 *
 * Stores each user message + agent response as a queryable JSON entry.
 * Logs live in workspace/.logs/ with one file per day.
 *
 * The memory system can search these logs via memoryRecall since
 * important interactions get archived to episodic/ memory.
 * These raw logs provide full fidelity for debugging and analysis.
 */

import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import config from '../config.js';
import logger from './logger.js';

const LOGS_DIR = path.join(config.WORKSPACE_DIR, '.logs');

/**
 * Log a Discord interaction.
 *
 * @param {object} entry
 * @param {string} entry.userId
 * @param {string} entry.userName
 * @param {string} entry.channelId
 * @param {string} entry.userMessage
 * @param {string} entry.agentResponse
 * @param {number} entry.steps - tool call steps used
 * @param {string[]} entry.toolsUsed - tools invoked
 * @param {number} entry.durationMs - total processing time
 */
export async function logInteraction(entry) {
  try {
    await mkdir(LOGS_DIR, { recursive: true });

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(LOGS_DIR, `${dateStr}.jsonl`);

    const record = {
      timestamp: now.toISOString(),
      userId: entry.userId || 'unknown',
      userName: entry.userName || 'unknown',
      channelId: entry.channelId || 'unknown',
      query: (entry.userMessage || '').slice(0, 500),
      response: (entry.agentResponse || '').slice(0, 500),
      steps: entry.steps || 0,
      toolsUsed: entry.toolsUsed || [],
      durationMs: entry.durationMs || 0,
    };

    // Append as JSON line
    const line = JSON.stringify(record) + '\n';
    const existing = existsSync(logFile) ? await readFile(logFile, 'utf-8') : '';
    await writeFile(logFile, existing + line);

    logger.debug('InteractionLog', `Logged to ${dateStr}.jsonl`);
  } catch (err) {
    logger.debug('InteractionLog', `Log failed: ${err.message}`);
  }
}

/**
 * Search interaction logs by keyword.
 *
 * @param {string} query - Search term
 * @param {number} [maxResults=10]
 * @returns {{ timestamp, query, response, toolsUsed }[]}
 */
export async function searchLogs(query, maxResults = 10) {
  const results = [];
  const queryLower = query.toLowerCase();

  try {
    if (!existsSync(LOGS_DIR)) return results;

    const files = (await readdir(LOGS_DIR))
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse(); // most recent first

    for (const file of files) {
      if (results.length >= maxResults) break;

      const content = await readFile(path.join(LOGS_DIR, file), 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      for (const line of lines.reverse()) { // newest first within file
        if (results.length >= maxResults) break;

        try {
          const record = JSON.parse(line);
          const text = `${record.query} ${record.response}`.toLowerCase();

          if (text.includes(queryLower)) {
            results.push({
              timestamp: record.timestamp,
              query: record.query,
              response: record.response,
              toolsUsed: record.toolsUsed,
            });
          }
        } catch {
          // skip malformed lines
        }
      }
    }
  } catch (err) {
    logger.debug('InteractionLog', `Search failed: ${err.message}`);
  }

  return results;
}

export default { logInteraction, searchLogs };
