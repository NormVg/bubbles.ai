import { exec } from 'child_process';
import { tool } from 'ai';
import { z } from 'zod';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import config from '../config.js';
import logger from '../core/logger.js';

/**
 * Shell execution tool — runs commands on the host machine.
 * Includes safety guardrails and output offloading for context rot prevention.
 *
 * If stdout or stderr exceeds OFFLOAD_THRESHOLD, the full output is written
 * to workspace/.context/ and only head + tail are returned to the model.
 */

const MAX_OUTPUT = 4000;
const OFFLOAD_THRESHOLD = 2000; // chars — offload to file above this
const CONTEXT_DIR = path.join(config.WORKSPACE_DIR, '.context');

function isBlocked(command) {
  if (!config.ENABLE_SAFETY_GUARDRAILS) return false;
  const lower = command.toLowerCase().trim();
  return config.BLOCKED_COMMANDS.some((blocked) => lower.includes(blocked.toLowerCase()));
}

/**
 * Truncate large output: keep head + tail, write full to file.
 * Returns { display, offloadPath }
 */
async function offloadIfNeeded(output, label) {
  if (!output || output.length <= OFFLOAD_THRESHOLD) {
    return { display: output, offloadPath: null };
  }

  try {
    await mkdir(CONTEXT_DIR, { recursive: true });
    const timestamp = Date.now();
    const filename = `${label}-${timestamp}.txt`;
    const filePath = path.join(CONTEXT_DIR, filename);
    await writeFile(filePath, output);

    // Keep first 800 and last 800 chars
    const head = output.slice(0, 800);
    const tail = output.slice(-800);
    const display = `${head}\n\n... [${output.length} chars total — full output saved to ${filePath}] ...\n\n${tail}`;

    logger.debug('ShellTool', `Offloaded ${output.length} chars to ${filePath}`);
    return { display, offloadPath: filePath };
  } catch {
    // Fallback: just truncate
    return { display: output.slice(0, MAX_OUTPUT), offloadPath: null };
  }
}

export const shellTool = tool({
  description:
    'Execute a shell command on the host machine. Returns stdout, stderr, and exit code. ' +
    'Large outputs are automatically saved to a file — use readFile to access the full output if needed.',
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
          maxBuffer: 1024 * 1024,
          shell: '/bin/zsh',
        },
        async (error, stdout, stderr) => {
          const rawStdout = (stdout || '').slice(0, MAX_OUTPUT);
          const rawStderr = (stderr || '').slice(0, MAX_OUTPUT);

          // Offload large outputs to file
          const { display: displayStdout, offloadPath: stdoutPath } = await offloadIfNeeded(rawStdout, 'stdout');
          const { display: displayStderr } = await offloadIfNeeded(rawStderr, 'stderr');

          const result = {
            stdout: displayStdout,
            stderr: displayStderr,
            exitCode: error ? error.code || 1 : 0,
          };

          if (stdoutPath) {
            result.fullOutputPath = stdoutPath;
          }

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
