import { exec } from 'child_process';
import { tool } from 'ai';
import { z } from 'zod';
import config from '../config.js';
import logger from '../core/logger.js';

/**
 * Shell execution tool — runs commands on the host machine.
 * Includes configurable safety guardrails.
 */

const MAX_OUTPUT = 4000; // chars — keeps token usage reasonable

function isBlocked(command) {
  if (!config.ENABLE_SAFETY_GUARDRAILS) return false;
  const lower = command.toLowerCase().trim();
  return config.BLOCKED_COMMANDS.some((blocked) => lower.includes(blocked.toLowerCase()));
}

export const shellTool = tool({
  description:
    'Execute a shell command on the host machine. Returns stdout, stderr, and exit code. Use for: running scripts, installing packages, git operations, builds, system info, etc.',
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    cwd: z
      .string()
      .optional()
      .describe('Working directory (defaults to project root)'),
    timeout: z
      .number()
      .optional()
      .describe('Timeout in milliseconds (default: 30000)'),
  }),
  execute: async ({ command, cwd, timeout = 30000 }) => {
    // Safety check
    if (isBlocked(command)) {
      logger.warn('ShellTool', `Blocked dangerous command: ${command}`);
      return {
        stdout: '',
        stderr: `BLOCKED: This command was blocked by safety guardrails. Command: "${command}"`,
        exitCode: 1,
      };
    }

    logger.info('ShellTool', `Executing: ${command}`, { cwd });

    return new Promise((resolve) => {
      exec(
        command,
        {
          cwd: cwd || config.WORKING_DIR,
          timeout,
          maxBuffer: 1024 * 1024, // 1MB
          shell: '/bin/zsh',
        },
        (error, stdout, stderr) => {
          const result = {
            stdout: (stdout || '').slice(0, MAX_OUTPUT),
            stderr: (stderr || '').slice(0, MAX_OUTPUT),
            exitCode: error ? error.code || 1 : 0,
          };

          if (error && error.killed) {
            result.stderr += `\n[Command timed out after ${timeout}ms]`;
          }

          logger.debug('ShellTool', `Exit code: ${result.exitCode}`);
          resolve(result);
        }
      );
    });
  },
});

export default shellTool;
