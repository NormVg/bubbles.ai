import 'dotenv/config';

const config = {
  // ── Ollama / LLM ──────────────────────────────────────────────
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/api',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'llama3.2',
  OLLAMA_API_KEY: process.env.OLLAMA_API_KEY || '',

  // ── Discord ───────────────────────────────────────────────────
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID || '',
  OWNER_ID: process.env.OWNER_ID || '',

  // ── Agent ─────────────────────────────────────────────────────
  MAX_STEPS: parseInt(process.env.MAX_STEPS || '25', 10),
  MAX_TOOL_ROUNDTRIPS: parseInt(process.env.MAX_TOOL_ROUNDTRIPS || '10', 10),
  RESPONSE_MAX_LENGTH: parseInt(process.env.RESPONSE_MAX_LENGTH || '1900', 10),

  // ── Safety ────────────────────────────────────────────────────
  ENABLE_SAFETY_GUARDRAILS: process.env.ENABLE_SAFETY_GUARDRAILS !== 'false',
  BLOCKED_COMMANDS: [
    'rm -rf /',
    'mkfs',
    'dd if=',
    'shutdown',
    'reboot',
    ':(){:|:&};:',
    'chmod -R 777 /',
  ],

  // ── Terminal ──────────────────────────────────────────────────
  TERMINAL_USERNAME: process.env.TERMINAL_USERNAME,
  TERMINAL_PASSWORD: process.env.TERMINAL_PASSWORD,

  // ── Paths ─────────────────────────────────────────────────────
  SOUL_FILE: './soul.md',
  SKILLS_DIRS: ['.agents/skills'],
  WORKING_DIR: process.cwd(),
  WORKSPACE_DIR: process.env.WORKSPACE_DIR || './workspace',
  ATTACHMENTS_DIR: process.env.ATTACHMENTS_DIR || './workspace/attachments',
};

export default config;
