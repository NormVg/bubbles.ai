/**
 * Chat History — Per-channel conversation memory.
 *
 * Stores recent user/assistant messages per Discord channel so the agent
 * has context from previous interactions. Uses in-memory storage with
 * optional filesystem persistence.
 *
 * Messages are stored in AI SDK format: { role, content }
 * History is capped to prevent context window overflow.
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import config from '../config.js';
import logger from './logger.js';

const MAX_HISTORY_PER_CHANNEL = 20; // max message pairs (user + assistant = 2 entries)
const MAX_TOTAL_CHARS = 8000;       // total chars across all history messages
const HISTORY_DIR = path.join(config.WORKSPACE_DIR, '.history');

/** In-memory store: channelId → messages[] */
const channelHistory = new Map();

/**
 * Get conversation history for a channel.
 * Returns messages in AI SDK format: [{ role: 'user', content: '...' }, ...]
 */
export function getHistory(channelId) {
  return channelHistory.get(channelId) || [];
}

/**
 * Add a user message and the agent's response to channel history.
 * Automatically trims to stay within limits.
 */
export function addToHistory(channelId, userMessage, assistantResponse) {
  if (!channelId || !userMessage) return;

  let history = channelHistory.get(channelId) || [];

  // Add the exchange
  history.push(
    { role: 'user', content: userMessage },
    { role: 'assistant', content: assistantResponse || '(no response)' }
  );

  // Trim to max pairs (keep most recent)
  if (history.length > MAX_HISTORY_PER_CHANNEL * 2) {
    history = history.slice(-(MAX_HISTORY_PER_CHANNEL * 2));
  }

  // Trim by total character count (drop oldest pairs until under limit)
  while (totalChars(history) > MAX_TOTAL_CHARS && history.length > 2) {
    history = history.slice(2); // drop oldest pair
  }

  channelHistory.set(channelId, history);

  // Fire-and-forget persistence
  persistHistory(channelId, history).catch(() => { });

  logger.debug('ChatHistory', `Channel ${channelId}: ${history.length} messages stored`);
}

/**
 * Clear history for a channel.
 */
export function clearHistory(channelId) {
  channelHistory.delete(channelId);
  logger.info('ChatHistory', `Cleared history for channel ${channelId}`);
}

/**
 * Load persisted history from disk on startup.
 */
export async function loadPersistedHistory() {
  try {
    if (!existsSync(HISTORY_DIR)) return;

    const { readdir } = await import('fs/promises');
    const files = await readdir(HISTORY_DIR);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const channelId = file.replace('.json', '');
        const data = await readFile(path.join(HISTORY_DIR, file), 'utf-8');
        const messages = JSON.parse(data);
        if (Array.isArray(messages) && messages.length > 0) {
          channelHistory.set(channelId, messages);
        }
      } catch {
        // Skip corrupt files
      }
    }

    logger.info('ChatHistory', `Loaded history for ${channelHistory.size} channels`);
  } catch (err) {
    logger.warn('ChatHistory', `Failed to load persisted history: ${err.message}`);
  }
}

// ── Internal helpers ──────────────────────────────────────────────

function totalChars(messages) {
  return messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
}

async function persistHistory(channelId, messages) {
  try {
    await mkdir(HISTORY_DIR, { recursive: true });
    const filePath = path.join(HISTORY_DIR, `${channelId}.json`);
    await writeFile(filePath, JSON.stringify(messages, null, 2));
  } catch (err) {
    logger.debug('ChatHistory', `Persist failed for ${channelId}: ${err.message}`);
  }
}

export default { getHistory, addToHistory, clearHistory, loadPersistedHistory };
