---
name: computer-use-agents
description: Build AI agents that interact with computers like humans do - viewing screens, moving cursors, clicking buttons, and typing text. Use this skill whenever the user asks to build, modify, or debug vision-based agents, GUI automation, RPA, or Anthropic Computer Use / OpenAI Operator clones.
risk: unknown
source: vibeship-spawner-skills (Apache 2.0)
date_added: 2026-02-27
---

# Computer Use Agents

Build AI agents that interact with computers like humans do - viewing screens, moving cursors, clicking buttons, and typing text. Covers Anthropic's Computer Use, OpenAI's Operator/CUA, and open-source alternatives. Critical focus on sandboxing, security, and handling the unique challenges of vision-based control.

## Progressive Disclosure Architecture

This module has been structurally optimized using progressive disclosure. The codebase is broken into specialized scripts and documentation.

### Scripts (Implementations)
When instructed to build an agent, choose the appropriate implementation snippet:
- `scripts/perception_loop.py`: The fundamental perception-reasoning-action loop using screenshots.
- `scripts/anthropic_computer_use.py`: Official implementation pattern using Anthropic's `computer` tool native capabilities.
- `scripts/browser_use_playwright.py`: For browser-only tasks, uses Playwright structured DOM elements instead of pixel clicks (cheaper, faster, more reliable).
- `scripts/sandbox_wrapper.py`: Docker container orchestrator ensuring agent blast-radius is minimized.
- `scripts/confirmation_gate.py`: Prevents destructive GUI actions by requesting human confirmation.
- `scripts/action_logger.py`: Tracks states securely for deterministic recording of computer-use flows.

### References (Guides & Gotchas)
Before writing code, YOU MUST consult the Sharp Edges guide if dealing with these topics:
- `references/sharp_edges.md`: Contains highly critical anti-patterns including web-injection hijacking, vision-clicks exposing coordinate grids (bot flagging), drag-and-drop failures, context-window memory wipes from image stacking, and cost-explosion mathematics.
- `references/docker_sandboxing.md`: Details how to construct safe, non-root Ubuntu VNC headless environments so agents cannot destroy the host machine.

## Collaboration Triggers
- user needs web-only automation -> `browser-automation` (Playwright/Selenium is more efficient for web)
- user needs security review -> `security-specialist` (Review sandboxing, prompt injection defenses)
- user needs container orchestration -> `devops` (Kubernetes, Docker Swarm for scaling)

## When to Use
Make sure to use this skill whenever the user mentions:
- computer use, desktop automation agent, screen control AI, vision-based agent, GUI automation, Claude computer, browser agent, visual agent, RPA with AI.
