/**
 * Chat History — Temporary interaction log with archive mechanism.
 *
 * Stores recent user/assistant messages. When the cap is hit,
 * summarizes the conversation and archives it to long-term memory.
 * The summary bridges conversations into the memory system.
 *
 * Flow: raw messages → cap hit → LLM summarize → store in episodic/
 *       → replace history with summary → clear raw messages
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { generateText } from 'ai';
import config from '../config.js';
import logger from './logger.js';
import { getModel } from './provider.js';
import { writeMemory } from './memoryStore.js';

const MAX_HISTORY = 20;        // max message pairs before archival
const MAX_TOTAL_CHARS = 8000;  // hard limit on total chars
const HISTORY_FILE = path.join(config.WORKSPACE_DIR, '.history', 'session.json');

/** In-memory session history */
let history = [];

/** Previous conversation summary (from archival) */
let archivedSummary = '';

/**
 * Get current conversation history, prefixed with archived summary if available.
 */
export function getHistory() {
  const messages = [];

  // Inject archived summary as context bridge
  if (archivedSummary) {
    messages.push({
      role: 'user',
      content: `[Previous conversation context]\n${archivedSummary}`,
    });
    messages.push({
      role: 'assistant',
      content: 'Understood, I have context from our previous conversation.',
    });
  }

  messages.push(...history);
  return messages;
}

/**
 * Add a user message and response to session history.
 * Triggers archival if cap is reached.
 */
export async function addToHistory(userMessage, assistantResponse) {
  if (!userMessage) return;

  history.push(
    { role: 'user', content: userMessage },
    { role: 'assistant', content: assistantResponse || '(no response)' }
  );

  // Check if we need to archive (message count OR char limit)
  const charOverflow = totalChars(history) > MAX_TOTAL_CHARS;
  if (history.length >= MAX_HISTORY * 2 || charOverflow) {
    if (charOverflow) logger.warn('ChatHistory', 'Char limit hit — triggering archival instead of silent drop');
    await archiveHistory();
  }

  // Fire-and-forget persistence
  persistHistory().catch(() => { });

  logger.debug('ChatHistory', `Session: ${history.length / 2} exchanges`);
}

/**
 * Archive current history: summarize → store in memory → clear.
 */
async function archiveHistory() {
  if (history.length < 4) return; // Need at least 2 exchanges

  logger.info('ChatHistory', `Archiving ${history.length / 2} exchanges...`);

  try {
    // Build conversation text for the LLM
    const conversationText = history
      .map(m => `${m.role === 'user' ? 'User' : 'Bubbles'}: ${m.content}`)
      .join('\n\n');

    // Summarize via LLM
    const result = await generateText({
      model: getModel(),
      system: `You are a conversation summarizer. Produce a compact summary of this conversation.
Focus on:
- What the user asked for
- What was built/done
- Key decisions made
- Any user preferences or important details
- Current state of any projects

Output a concise summary in 3-8 bullet points. No fluff.`,
      prompt: conversationText.slice(0, 6000), // cap input
    });

    const summary = result.text || 'Conversation archived (summary unavailable)';

    // Store in episodic memory
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await writeMemory('episodic', `chat-archive-${timestamp}`, summary, {
      title: `Conversation Archive ${timestamp}`,
      importance: 4,
    });

    // Set the summary as context bridge
    archivedSummary = summary;

    // Clear raw history
    history = [];

    logger.info('ChatHistory', `Archived to episodic/chat-archive-${timestamp}`);
  } catch (err) {
    logger.error('ChatHistory', `Archive failed: ${err.message}`);

    // Fallback: just trim to last 6 exchanges
    history = history.slice(-12);
  }
}

/**
 * Clear session history.
 */
export function clearHistory() {
  history = [];
  archivedSummary = '';
  logger.info('ChatHistory', 'Session history cleared');
}

/**
 * Load persisted history from disk on startup.
 */
export async function loadPersistedHistory() {
  try {
    if (!existsSync(HISTORY_FILE)) return;
    const data = await readFile(HISTORY_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed.history && Array.isArray(parsed.history)) {
      history = parsed.history;
    }
    if (parsed.archivedSummary) {
      archivedSummary = parsed.archivedSummary;
    }
    logger.info('ChatHistory', `Loaded ${history.length / 2} exchanges from disk`);
  } catch (err) {
    logger.warn('ChatHistory', `Failed to load history: ${err.message}`);
  }
}

// ── Internal ──────────────────────────────────────────────────────

function totalChars(msgs) {
  return msgs.reduce((sum, m) => sum + (m.content?.length || 0), 0);
}

async function persistHistory() {
  try {
    const dir = path.dirname(HISTORY_FILE);
    await mkdir(dir, { recursive: true });
    await writeFile(HISTORY_FILE, JSON.stringify({ history, archivedSummary }, null, 2));
  } catch (err) {
    logger.debug('ChatHistory', `Persist failed: ${err.message}`);
  }
}

export default { getHistory, addToHistory, clearHistory, loadPersistedHistory };
