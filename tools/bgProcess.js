/**
 * Background Process Manager — spawn long-running shell commands that
 * don't block the main agent conversation loop.
 *
 * Under the hood: Node.js child_process.spawn() (non-blocking).
 * Process registry is in-memory (lives as long as the bot process does).
 *
 * Tools exposed:
 *   bgRun   — start a background command, returns a job ID
 *   bgList  — list all background jobs and their status
 *   bgRead  — tail recent stdout/stderr from a job
 *   bgKill  — terminate a running job
 */

import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'child_process';
import logger from '../core/logger.js';

// ── Job Registry ────────────────────────────────────────────────
/** @type {Map<string, Job>} */
const jobs = new Map();
let jobCounter = 0;

/** @typedef {{ id: string, cmd: string, process: import('child_process').ChildProcess, status: 'running'|'exited'|'killed', exitCode: number|null, lines: string[], startedAt: Date }} Job */

function newJobId() {
  return `bg-${++jobCounter}`;
}

/** Keep last N lines per job */
const MAX_LINES = 100;

function appendLine(job, source, data) {
  const text = data.toString().trimEnd();
  const lines = text.split('\n').map(l => `[${source}] ${l}`);
  job.lines.push(...lines);
  if (job.lines.length > MAX_LINES) {
    job.lines = job.lines.slice(-MAX_LINES);
  }
}

// ── bgRun ────────────────────────────────────────────────────────
export const bgRunTool = tool({
  description:
    'Spawn a shell command as a non-blocking background job. ' +
    'Perfect for long-running tasks: web servers, file watchers, build processes, Python scripts, etc. ' +
    'Returns a job ID immediately without waiting for the process to finish. ' +
    'Use bgRead to check its output and bgKill to stop it.',
  parameters: z.object({
    command: z.string().describe('The full shell command to run (e.g. "npm run dev", "python3 server.py", "node index.js")'),
    cwd: z.string().optional().describe('Working directory for the command (default: ./workspace)'),
    label: z.string().optional().describe('Human-readable label for this job (e.g. "Dev server", "Price watcher")'),
  }),
  execute: async ({ command, cwd, label }) => {
    const id = newJobId();
    const workdir = cwd || './workspace';
    const displayLabel = label || command.slice(0, 40);

    /** @type {Job} */
    const job = {
      id,
      cmd: command,
      label: displayLabel,
      status: 'running',
      exitCode: null,
      lines: [],
      startedAt: new Date(),
    };

    const child = spawn('sh', ['-c', command], {
      cwd: workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    job.process = child;

    child.stdout.on('data', (data) => appendLine(job, 'stdout', data));
    child.stderr.on('data', (data) => appendLine(job, 'stderr', data));

    child.on('exit', (code, signal) => {
      job.status = signal === 'SIGTERM' || signal === 'SIGKILL' ? 'killed' : 'exited';
      job.exitCode = code;
      logger.info('BgProcess', `[${id}] "${displayLabel}" exited — code: ${code}, signal: ${signal}`);
    });

    child.on('error', (err) => {
      job.status = 'exited';
      job.exitCode = 1;
      appendLine(job, 'error', err.message);
      logger.error('BgProcess', `[${id}] spawn error: ${err.message}`);
    });

    jobs.set(id, job);
    logger.info('BgProcess', `[${id}] Started: "${displayLabel}" (pid: ${child.pid})`);

    return {
      success: true,
      jobId: id,
      pid: child.pid,
      label: displayLabel,
      cwd: workdir,
      message: `Job ${id} started. Use bgRead("${id}") to see output or bgKill("${id}") to stop it.`,
    };
  },
});

// ── bgList ───────────────────────────────────────────────────────
export const bgListTool = tool({
  description: 'List all background jobs — running, exited, and killed. Shows job ID, label, status, and runtime.',
  parameters: z.object({}),
  execute: async () => {
    if (jobs.size === 0) {
      return { jobs: [], message: 'No background jobs.' };
    }

    const list = [...jobs.values()].map(j => {
      const runtime = Math.round((Date.now() - j.startedAt) / 1000);
      return {
        id: j.id,
        label: j.label,
        status: j.status,
        exitCode: j.exitCode,
        pid: j.process?.pid,
        runtimeSeconds: runtime,
        lastLine: j.lines.at(-1) || '(no output yet)',
      };
    });

    return { jobs: list };
  },
});

// ── bgRead ───────────────────────────────────────────────────────
export const bgReadTool = tool({
  description: 'Read the recent stdout/stderr output of a background job. Returns the last N lines.',
  parameters: z.object({
    jobId: z.string().describe('Job ID returned by bgRun (e.g. "bg-1")'),
    lines: z.number().optional().describe('Number of recent lines to return (default: 30)'),
  }),
  execute: async ({ jobId, lines = 30 }) => {
    const job = jobs.get(jobId);
    if (!job) {
      return { success: false, error: `No job found with ID "${jobId}". Use bgList to see all jobs.` };
    }

    const recent = job.lines.slice(-lines);
    return {
      jobId,
      label: job.label,
      status: job.status,
      exitCode: job.exitCode,
      output: recent.join('\n') || '(no output yet)',
      totalLines: job.lines.length,
    };
  },
});

// ── bgKill ───────────────────────────────────────────────────────
export const bgKillTool = tool({
  description: 'Terminate a running background job by its job ID.',
  parameters: z.object({
    jobId: z.string().describe('Job ID to kill (e.g. "bg-1")'),
  }),
  execute: async ({ jobId }) => {
    const job = jobs.get(jobId);
    if (!job) {
      return { success: false, error: `No job found with ID "${jobId}".` };
    }
    if (job.status !== 'running') {
      return { success: false, error: `Job ${jobId} is already ${job.status}.` };
    }

    job.process.kill('SIGTERM');
    logger.info('BgProcess', `[${jobId}] Killed: "${job.label}"`);

    return {
      success: true,
      jobId,
      label: job.label,
      message: `Job ${jobId} ("${job.label}") has been terminated.`,
    };
  },
});
