/**
 * Desktop automation tools — native Zod wrappers around the PyAutoGUI desktop.py CLI.
 *
 * Each tool calls:
 *   python3 .bubbles/skills/desktop-use/scripts/desktop.py <action> <args>
 * and parses the JSON output.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { execSync } from 'child_process';
import { resolve } from 'path';
import logger from '../core/logger.js';

const DESKTOP_PY = resolve('.agents/skills/desktop-use/scripts/desktop.py');

/**
 * Run a desktop.py action and return parsed JSON.
 */
function runDesktop(action, args = []) {
  const cmd = ['python3', DESKTOP_PY, action, ...args].join(' ');
  logger.debug('Desktop', `Running: ${cmd}`);

  try {
    const stdout = execSync(cmd, {
      timeout: 30_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      return JSON.parse(stdout.trim());
    } catch {
      return { success: true, raw: stdout.trim() };
    }
  } catch (err) {
    const stderr = err.stderr?.toString() || err.message;
    logger.error('Desktop', `Failed: ${stderr}`);

    // Try to parse stderr as JSON (desktop.py errors are JSON)
    try {
      return JSON.parse(stderr.trim());
    } catch {
      return { success: false, error: stderr.slice(0, 500) };
    }
  }
}

// ── Screenshot ──────────────────────────────────────────────────
export const desktopScreenshotTool = tool({
  description:
    'Take a screenshot of the current screen. Returns the file path to the saved JPEG. ' +
    'Use this as the first step in any desktop automation task to see what is on screen.',
  parameters: z.object({
    output: z.string().optional().describe('Output file path (default: auto-generated in /tmp as .jpg)'),
    region: z.string().optional().describe('Capture a region: "x,y,width,height" (e.g. "0,0,800,600")'),
  }),
  execute: async ({ output, region }) => {
    const args = [];
    if (output) args.push('--output', output);
    if (region) args.push('--region', region);

    const result = runDesktop('screenshot', args);
    logger.info('Desktop', `Screenshot saved: ${result.path || 'unknown'}`);
    return result;
  },
});

// ── Click ───────────────────────────────────────────────────────
export const desktopClickTool = tool({
  description:
    'Click at a specific (x, y) coordinate on screen. Supports left/right/middle button and double-click.',
  parameters: z.object({
    x: z.number().describe('X coordinate'),
    y: z.number().describe('Y coordinate'),
    button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default: left)'),
    doubleClick: z.boolean().optional().describe('Double-click instead of single-click'),
  }),
  execute: async ({ x, y, button, doubleClick }) => {
    const action = doubleClick ? 'double_click' : 'click';
    const args = ['--x', String(x), '--y', String(y)];
    if (button) args.push('--button', button);

    return runDesktop(action, args);
  },
});

// ── Type Text ───────────────────────────────────────────────────
export const desktopTypeTool = tool({
  description:
    'Type text at the current cursor position. Use for filling forms, search bars, terminal input, etc.',
  parameters: z.object({
    text: z.string().describe('Text to type'),
    interval: z.number().optional().describe('Delay between keystrokes in seconds (default: 0.0)'),
  }),
  execute: async ({ text, interval }) => {
    const args = ['--text', JSON.stringify(text)];
    if (interval) args.push('--interval', String(interval));

    return runDesktop('type_text', args);
  },
});

// ── Key / Hotkey ────────────────────────────────────────────────
export const desktopKeyTool = tool({
  description:
    'Press a single key or a hotkey combination. ' +
    'For single keys: enter, esc, tab, space, backspace, delete, up, down, left, right, f1-f12. ' +
    'For combos: use comma-separated keys like "command,space" or "ctrl,shift,t". ' +
    'CRITICAL: On macOS, ALWAYS use "command" (not "cmd" or "win"). Valid modifiers: command, option, control, shift.',
  parameters: z.object({
    key: z.string().optional().describe('Single key to press (e.g. "enter", "esc", "tab")'),
    combo: z.string().optional().describe('Hotkey combo, comma-separated (e.g. "command,space", "command,c"). NEVER use "cmd" — use "command".'),
  }),
  execute: async ({ key, combo }) => {
    // Normalize: auto-correct cmd/win → command
    const fix = (s) => s.replace(/\bcmd\b/g, 'command').replace(/\bwin\b/g, 'command');

    // If combo was provided, use hotkey
    if (combo) {
      const fixedCombo = fix(combo);
      if (fixedCombo !== combo) logger.warn('Desktop', `Auto-corrected combo: "${combo}" → "${fixedCombo}"`);
      return runDesktop('hotkey', ['--keys', fixedCombo]);
    }

    if (key) {
      const fixedKey = fix(key);
      // Smart detection: if the "key" field contains a comma, it's actually a combo
      if (fixedKey.includes(',')) {
        logger.warn('Desktop', `Key "${key}" contains comma — auto-promoting to hotkey action`);
        return runDesktop('hotkey', ['--keys', fixedKey]);
      }
      if (fixedKey !== key) logger.warn('Desktop', `Auto-corrected key: "${key}" → "${fixedKey}"`);
      return runDesktop('press_key', ['--key', fixedKey]);
    }

    return { success: false, error: 'Provide either "key" or "combo"' };
  },
});

// ── Scroll ──────────────────────────────────────────────────────
export const desktopScrollTool = tool({
  description:
    'Scroll the mouse wheel. Positive amount = scroll up, negative = scroll down. ' +
    'Optionally specify coordinates to scroll at a specific position.',
  parameters: z.object({
    amount: z.number().describe('Scroll amount (positive=up, negative=down)'),
    x: z.number().optional().describe('X coordinate to scroll at'),
    y: z.number().optional().describe('Y coordinate to scroll at'),
  }),
  execute: async ({ amount, x, y }) => {
    const args = ['--amount', String(amount)];
    if (x !== undefined) args.push('--x', String(x));
    if (y !== undefined) args.push('--y', String(y));

    return runDesktop('scroll', args);
  },
});

// ── Screen Info ─────────────────────────────────────────────────
export const desktopGetScreenInfoTool = tool({
  description:
    'Get the screen resolution and active window info. Useful for understanding the display layout before automation.',
  parameters: z.object({}),
  execute: async () => {
    const screenSize = runDesktop('get_screen_size');
    const activeWindow = runDesktop('get_active_window');

    return {
      screen: screenSize,
      activeWindow,
    };
  },
});
