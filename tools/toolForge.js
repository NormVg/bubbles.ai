/**
 * Tool Forge — Lets the agent create, persist, and load its own custom tools.
 *
 * Each custom tool is a script-backed command:
 *   .bubbles/custom-tools/<tool-name>/
 *     ├── tool.json    — name, description, parameters (JSON Schema subset)
 *     └── run.sh|run.py — the implementation script
 *
 * On startup, all custom tools are loaded from disk.
 * At runtime, the agent can create new tools via `forgeTool` and they
 * become immediately available in the current session.
 *
 * Tools exposed:
 *   forgeTool    — create a new custom tool (writes script + schema to disk)
 *   listForged   — list all custom tools that have been created
 *   removeForged — delete a custom tool
 */

import { tool } from 'ai';
import { z } from 'zod';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import config from '../config.js';
import logger from '../core/logger.js';

const CUSTOM_TOOLS_DIR = join(resolve(config.WORKING_DIR), '.bubbles', 'custom-tools');

// ── Registry ─────────────────────────────────────────────────────
/** @type {Map<string, import('ai').Tool>} */
const customToolRegistry = new Map();

/**
 * Load all custom tools from disk. Called once at startup.
 * Returns a plain object of { toolName: toolInstance } for merging into coreTools.
 */
export function loadCustomTools() {
  if (!existsSync(CUSTOM_TOOLS_DIR)) {
    mkdirSync(CUSTOM_TOOLS_DIR, { recursive: true });
    return {};
  }

  const entries = readdirSync(CUSTOM_TOOLS_DIR, { withFileTypes: true });
  const tools = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const toolDir = join(CUSTOM_TOOLS_DIR, entry.name);
    const schemaPath = join(toolDir, 'tool.json');

    if (!existsSync(schemaPath)) continue;

    try {
      const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
      const t = buildToolFromSchema(schema, toolDir);
      if (t) {
        tools[schema.name] = t;
        customToolRegistry.set(schema.name, t);
        logger.info('ToolForge', `Loaded custom tool: ${schema.name}`);
      }
    } catch (err) {
      logger.warn('ToolForge', `Failed to load custom tool "${entry.name}": ${err.message}`);
    }
  }

  logger.info('ToolForge', `Loaded ${Object.keys(tools).length} custom tool(s)`);
  return tools;
}

/**
 * Get all currently registered custom tools.
 */
export function getCustomTools() {
  return Object.fromEntries(customToolRegistry);
}

// ── Build a tool from disk schema ────────────────────────────────
function buildToolFromSchema(schema, toolDir) {
  // Find script: prefer .py, then .sh, then .js
  let scriptPath = null;
  let runner = null;
  for (const [ext, cmd] of [['run.py', 'python3'], ['run.sh', 'sh'], ['run.js', 'node']]) {
    const p = join(toolDir, ext);
    if (existsSync(p)) {
      scriptPath = p;
      runner = cmd;
      break;
    }
  }

  if (!scriptPath) {
    logger.warn('ToolForge', `No run script found in ${toolDir}`);
    return null;
  }

  // Build Zod params from the schema's params array
  const zodShape = {};
  for (const param of schema.parameters || []) {
    let zType;
    switch (param.type) {
      case 'number': zType = z.number(); break;
      case 'boolean': zType = z.boolean(); break;
      default: zType = z.string(); break;
    }
    if (param.description) zType = zType.describe(param.description);
    zodShape[param.name] = param.required ? zType : zType.optional();
  }

  return tool({
    description: schema.description || `Custom tool: ${schema.name}`,
    parameters: z.object(zodShape),
    execute: async (args) => {
      try {
        // Pass parameters as env vars prefixed with TOOL_
        const env = { ...process.env };
        for (const [k, v] of Object.entries(args)) {
          env[`TOOL_${k.toUpperCase()}`] = String(v);
        }

        // Also pass as JSON in TOOL_ARGS
        env.TOOL_ARGS = JSON.stringify(args);

        const output = execSync(`${runner} "${scriptPath}"`, {
          cwd: toolDir,
          env,
          timeout: 30000,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
        });

        // Try to parse as JSON, fallback to raw text
        try {
          return JSON.parse(output.trim());
        } catch {
          return { success: true, output: output.trim() };
        }
      } catch (err) {
        return { success: false, error: err.stderr || err.message };
      }
    },
  });
}

// ── forgeTool ────────────────────────────────────────────────────
export const forgeToolTool = tool({
  description:
    'Create a brand new custom tool that persists to disk and becomes immediately available. ' +
    'You write the tool\'s script (Python/Bash/Node) and define its parameters. ' +
    'The tool is saved to .bubbles/custom-tools/<name>/ and loaded into the active session. ' +
    'Use this when you need a reusable capability that doesn\'t exist yet.',
  parameters: z.object({
    name: z.string().describe('Tool name in camelCase (e.g. "convertPdf", "checkWeather"). Must be unique.'),
    description: z.string().describe('What this tool does — shown to the agent in future sessions.'),
    language: z.enum(['python', 'bash', 'node']).describe('Script language for the implementation.'),
    script: z.string().describe('The full script source code. Receives params as env vars: TOOL_<PARAM_NAME> and TOOL_ARGS (full JSON). Print output to stdout.'),
    parameters: z.array(z.object({
      name: z.string().describe('Parameter name'),
      type: z.enum(['string', 'number', 'boolean']).describe('Parameter type'),
      description: z.string().describe('What this parameter is for'),
      required: z.boolean().describe('Whether this parameter is required'),
    })).describe('List of parameters the tool accepts'),
  }),
  execute: async ({ name, description, language, script, parameters: params }) => {
    const toolDir = join(CUSTOM_TOOLS_DIR, name);

    // Check for name collision
    if (customToolRegistry.has(name)) {
      return { success: false, error: `A custom tool named "${name}" already exists. Use removeForged to delete it first.` };
    }

    try {
      await mkdir(toolDir, { recursive: true });

      // Write schema
      const schema = { name, description, parameters: params };
      await writeFile(join(toolDir, 'tool.json'), JSON.stringify(schema, null, 2));

      // Write script
      const ext = { python: 'run.py', bash: 'run.sh', node: 'run.js' }[language];
      await writeFile(join(toolDir, ext), script);

      // Make bash scripts executable
      if (language === 'bash') {
        execSync(`chmod +x "${join(toolDir, ext)}"`);
      }

      // Register immediately
      const t = buildToolFromSchema(schema, toolDir);
      if (t) {
        customToolRegistry.set(name, t);
        logger.info('ToolForge', `Forged new tool: ${name}`);
      }

      return {
        success: true,
        toolName: name,
        path: toolDir,
        message: `Tool "${name}" created and ready to use! It will persist across restarts.`,
      };
    } catch (err) {
      return { success: false, error: `Failed to create tool: ${err.message}` };
    }
  },
});

// ── listForged ───────────────────────────────────────────────────
export const listForgedTool = tool({
  description: 'List all custom tools that have been created with forgeTool.',
  parameters: z.object({}),
  execute: async () => {
    if (!existsSync(CUSTOM_TOOLS_DIR)) {
      return { tools: [], message: 'No custom tools created yet.' };
    }

    const entries = readdirSync(CUSTOM_TOOLS_DIR, { withFileTypes: true });
    const tools = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const schemaPath = join(CUSTOM_TOOLS_DIR, entry.name, 'tool.json');
      if (!existsSync(schemaPath)) continue;

      try {
        const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
        tools.push({
          name: schema.name,
          description: schema.description,
          parameters: schema.parameters?.map(p => `${p.name} (${p.type}${p.required ? ', required' : ''})`),
        });
      } catch {
        tools.push({ name: entry.name, description: '(failed to read schema)' });
      }
    }

    return { tools, count: tools.length };
  },
});

// ── removeForged ─────────────────────────────────────────────────
export const removeForgedTool = tool({
  description: 'Delete a custom tool by name. Removes it from disk and unregisters it from the current session.',
  parameters: z.object({
    name: z.string().describe('Name of the custom tool to delete'),
  }),
  execute: async ({ name }) => {
    const toolDir = join(CUSTOM_TOOLS_DIR, name);

    if (!existsSync(toolDir)) {
      return { success: false, error: `No custom tool named "${name}" found.` };
    }

    try {
      rmSync(toolDir, { recursive: true, force: true });
      customToolRegistry.delete(name);
      logger.info('ToolForge', `Removed custom tool: ${name}`);
      return { success: true, message: `Tool "${name}" deleted.` };
    } catch (err) {
      return { success: false, error: `Failed to delete: ${err.message}` };
    }
  },
});
