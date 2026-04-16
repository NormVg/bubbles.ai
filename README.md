# Bubbles.ai — Autonomous Discord Agent

An autonomous AI agent powered by **Ollama + AI SDK**, controlled via Discord @mention. Bubbles has full shell and filesystem access, a tool loop for multi-step task execution, and a skill system for extensible capabilities.

> Think of it like [OpenClaw](https://github.com/openclaw) but self-hosted, running on your own machine, and talking to you through Discord.

## Features

- **@Mention chat** — Talk to the agent by mentioning it in any channel
- **Tool loop** — Multi-step execution with shell, filesystem, and file send/receive tools
- **Agent Skills** — Extensible skill system with progressive disclosure (loads instructions on demand)
- **Task decomposition** — Breaks complex requests into smaller steps and executes them
- **File send/receive** — Send files to the agent as attachments, get files back as Discord attachments
- **Workspace isolation** — All agent-generated files go into `./workspace/`
- **Configurable safety** — Blocked command list, owner-only admin commands
- **Slash commands** — `/ping`, `/update`, `/restart`, `/terminal`, `/closeterminal`
- **Soul.md personality** — Customizable agent personality and rules
- **Web terminal** — On-demand secure web terminal via Cloudflare Tunnels

## Architecture

Bubbles follows an **Orchestrator-Worker** loop architecture, augmented with persistent memory and dynamic skills.

### System Flow
\`\`\`mermaid
graph TD
    User([Discord User]) -->|@Mention| Discord[index.js]

    subgraph Bubbles Architecture
        Discord -->|Message & Context| Orchestrator[Orchestrator / agents/orchestrator.js]

        Orchestrator -->|1. Generate Plan| LLM[LLM Provider]
        LLM -->|Plan Steps| Orchestrator

        Orchestrator -->|2. Build System Prompt| PromptBuilder[prompts/system.js]
        PromptBuilder -->|Read Profile/Rules| Soul[.bubbles/spec/soul.md]

        Orchestrator -->|3. Execute Step Loop| ToolLoop[Tool Execution Loop]

        ToolLoop <-->|Execute Tools| Tools[tools/index.js]

        Tools -.-> FS[FileSystem]
        Tools -.-> Web[Web & Puppeteer]
        Tools -.-> MemoryStore[Memory Engine / core/memoryStore.js]
        Tools -.-> Cmd[Shell / Terminal]
    end

    ToolLoop -->|4. Final Output| Discord

    subgraph Memory Architecture
        MemoryStore -->|Read/Write YAML+MD| EPS[episodic/]
        MemoryStore -->|Read/Write| KNL[knowledge/]
        MemoryStore -->|Read/Write| PRJ[projects/]
        MemoryStore -->|System State| SYS[system/]
    end
\`\`\`

### Directory Structure

\`\`\`
bubbles.ai/
├── index.js              # Discord bot, message handling logic
├── config.js             # Centralized configuration (ENV wrappers)
├── agents/
│   └── orchestrator.js   # Main agent loop (Ralph Loop handling, tool invocation)
├── core/
│   ├── provider.js       # Dynamic Ollama/AI SDK provider abstraction
│   ├── logger.js         # Structured JSON/console logging
│   ├── memoryStore.js    # Persistent File-based Memory System Engine
│   ├── chatHistory.js    # Short-term sliding window context manager
│   ├── interactionLog.js # System-level interaction archiver
│   └── skillLoader.js    # Dynamic skill discovery & loading
├── prompts/
│   ├── system.js         # System prompt stitcher (combines memory, templates, soul)
│   └── templates.js      # Reusable strict prompt constraint fragments
├── tools/
│   ├── index.js          # Zod Tool registry
│   ├── web.js            # Puppeteer Web Scraping & DDG Search
│   ├── memoryTools.js    # memoryRead/Write/Recall/Capture tools
│   ├── shell.js          # Guardrailed Shell Command Executor
│   ├── filesystem.js     # Read/write/list/send files
│   └── loadSkill.js      # Load skill instructions on demand
├── .bubbles/
│   ├── memory/           # Persistent LLM Storage (episodic, knowledge, projects, tasks)
│   ├── spec/
│   │   └── soul.md       # Agent personality & identity profile
│   └── skills/           # Agent skills (SKILL.md files)
├── workspace/            # Safe working directory for files/projects
│   ├── attachments/      # Downloaded Discord attachments
│   ├── .context/         # Overflow context dumps for tools (context rot prevention)
│   └── .logs/            # Searchable JSONL interaction logs
└── start.sh              # Auto-restart daemon wrapper
\`\`\`

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A Discord bot token
- An Ollama-compatible API endpoint (local or remote)
- `ttyd` + `cloudflared` (optional, for web terminal)

### Install

```bash
git clone https://github.com/NormVg/discord-deploy.git bubbles.ai
cd bubbles.ai
npm install
```

### Configure

Create a `.env` file:

```env
# Discord
DISCORD_TOKEN=your_bot_token
OWNER_ID=your_discord_user_id
DISCORD_GUILD_ID=your_server_id  # optional, for instant slash command registration

# Ollama / LLM
OLLAMA_BASE_URL=http://localhost:11434/api
OLLAMA_MODEL=llama3.2
OLLAMA_API_KEY=                  # leave empty for local Ollama

# Agent
MAX_STEPS=25
LOG_LEVEL=info                   # debug, info, warn, error

# Terminal (optional)
TERMINAL_USERNAME=admin
TERMINAL_PASSWORD=your_password
```

### Run

```bash
npm run dev           # development
npm start             # production (auto-restart via start.sh)
LOG_LEVEL=debug npm run dev  # with debug logging
```

## Usage

**Chat with the agent:**
```
@Bubbles find me the sober spend project folder
@Bubbles what are my system specs?
@Bubbles create a python script that scrapes HN front page
```

**Send files:** Attach any file to your @mention message — the agent downloads it to `workspace/attachments/` and can read/process it.

**Receive files:** The agent can send files back as Discord attachments using the `sendFile` tool.

## Agent Skills

Skills are folders in `.bubbles/skills/` containing a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: my-skill
description: When to use this skill (shown to agent at startup)
---

# Full instructions loaded on demand when the agent calls loadSkill
```

The agent discovers skills at startup (names + descriptions only) and loads full instructions on demand via the `loadSkill` tool, keeping context small.

## Slash Commands

| Command | Description | Permission |
| :--- | :--- | :--- |
| `/ping` | Replies with Pong! | Everyone |
| `/update` | Pulls latest code, installs deps, restarts | Owner Only |
| `/restart` | Restarts the bot process | Owner Only |
| `/terminal` | Spawns a secure web terminal session | Owner Only |
| `/closeterminal` | Kills the active terminal session | Owner Only |

## License

ISC
