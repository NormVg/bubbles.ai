
# Guide: Prompt Design & Context Engineering for AI Agent Harnesses

## Overview

Building reliable autonomous AI agents requires more than just a good model. The real performance improvements come from **prompt engineering, context management, and harness design**.

Effective harnesses typically use:

* **Structured system prompts**
* **Specialized agents (Planner / Generator / Evaluator)**
* **Context engineering techniques**
* **Clear task decomposition**

Research shows that **multi-agent systems outperform single-agent setups for complex tasks like building software applications**.

---

# 1. Types of Prompts in an Agent System

A good harness typically uses **three types of prompts**.

| Prompt Type   | Purpose                                       |
| ------------- | --------------------------------------------- |
| System Prompt | Defines the agent’s role, behavior, and rules |
| Task Prompt   | The actual user request                       |
| Tool Prompt   | Instructions for tool usage                   |

---

# 2. System Prompt Design

The **system prompt is the most important component**.
It defines the **agent’s identity, reasoning style, and constraints**.

## Structure of a Strong System Prompt

A well-structured system prompt usually contains:

1. **Agent role**
2. **Capabilities**
3. **Constraints**
4. **Execution strategy**
5. **Output format**

Example structure:

```
You are an autonomous software engineering agent.

Your responsibilities:
- Break down complex tasks
- Execute tasks using available tools
- Verify outcomes before moving forward

Rules:
- Never assume success without verification
- Always use tools when possible
- Work step-by-step

Execution loop:
1. Analyze task
2. Break into sub-tasks
3. Execute using tools
4. Verify result
5. Continue until complete
```

---

# 3. Prompt Principles for Reliable Agents

## 1. Role Clarity

Define **exact responsibilities**.

Bad:

```
You are a helpful AI assistant.
```

Good:

```
You are a planner agent responsible for converting user ideas into product specifications.
```

---

## 2. Explicit Reasoning

Force the agent to **think in structured steps**.

Example:

```
Before executing a task:
1. Understand the objective
2. Identify required tools
3. Plan execution
4. Execute
5. Verify success
```

---

## 3. Execution Rules

Autonomous agents should follow strict rules:

Example:

```
Rules:
- Never describe actions without executing them
- Always verify outputs
- If a step fails, debug before proceeding
```

---

## 4. Tool Usage Instructions

Agents need **clear tool usage guidance**.

Example:

```
Available tools:
- file_read
- file_write
- terminal_execute

Always prefer tools over reasoning when performing actions.
```

---

# 4. Multi-Agent Prompt Architecture

A strong harness separates agents by responsibility.

Typical structure:

```
User
 ↓
Planner Agent
 ↓
Generator Agent
 ↓
Evaluator Agent
```

This architecture improves reliability because **agents evaluating work should be separate from the ones generating it**.

---

# 5. Planner Agent Prompt

The planner converts vague requests into **structured product specifications**.

Example prompt:

```
You are a software architect.

Your task:
Convert user requests into detailed product specifications.

Include:
- Product overview
- Core features
- Technical architecture
- Data models
- APIs
- UI structure

Avoid implementation details.
Focus on product design and system structure.
```

Planner outputs become **context artifacts** for other agents.

---

# 6. Generator Agent Prompt

The generator builds the system.

Example prompt:

```
You are a software engineering agent responsible for implementing product features.

Process:
1. Select the next feature from the specification
2. Plan implementation
3. Write code
4. Run tests
5. Verify behavior

Rules:
- Work one feature at a time
- Maintain project structure
- Use version control if available
```

---

# 7. Evaluator Agent Prompt

This agent acts as **QA + code reviewer**.

Without a separate evaluator, models often **overrate their own work**.

Example prompt:

```
You are a critical QA engineer.

Your job is to test the application and find problems.

Evaluate:
- functionality
- usability
- bugs
- missing features

Rules:
- Be skeptical
- Do not approve incomplete features
- Provide detailed feedback
```

---

# 8. Context Engineering

Context engineering is the process of **controlling what information the model sees and when**.

This is critical for **long-running agents**.

---

## Problem: Context Overflow

Large tasks fill the context window.

When this happens:

* models forget earlier steps
* tasks become inconsistent

---

## Solution 1: Context Artifacts

Instead of relying on chat history, use **files or structured outputs**.

Examples:

```
/project-spec.md
/task-list.md
/sprint-contract.md
/qa-report.md
```

Agents read and write these artifacts.

---

## Solution 2: Context Reset

Long runs should periodically **restart agents with summarized state**.

This prevents:

* context overload
* "context anxiety"
* degraded reasoning

Context resets involve:

1. summarizing current state
2. starting a fresh agent
3. providing artifact context

This technique improves long-running agent stability.

---

# 9. Sprint Contracts (Advanced Technique)

Before implementing features, agents should agree on **what success means**.

Example:

```
Feature: Sprite Editor

Completion Criteria:
- User can draw pixels
- Color picker works
- Canvas supports zoom
- Export sprite works
```

The evaluator later checks these conditions.

---

# 10. Evaluation Criteria Design

For subjective tasks (UI design etc.), create **grading frameworks**.

Example criteria:

| Criterion      | Purpose             |
| -------------- | ------------------- |
| Design quality | cohesion of layout  |
| Originality    | creative decisions  |
| Craft          | spacing, typography |
| Functionality  | usability           |

This allows agents to **score outputs objectively**.

---

# 11. Iteration Loops

Strong harnesses use **continuous improvement loops**.

Example:

```
Build
 ↓
Evaluate
 ↓
Feedback
 ↓
Improve
 ↓
Repeat
```

Typical runs involve **5–15 iterations**.

---

# 12. Communication Between Agents

Agents should communicate through **structured files**, not raw chat.

Example workflow:

```
planner → product_spec.md
generator → feature_1_code
evaluator → qa_report.md
generator → fixes
```

This ensures **consistent shared context**.

---

# 13. Best Practices

### 1. Use explicit instructions

Never rely on implicit behavior.

### 2. Separate responsibilities

Planner ≠ Builder ≠ Reviewer.

### 3. Use structured outputs

Avoid messy conversational state.

### 4. Design evaluation criteria

Agents need measurable success conditions.

### 5. Reset context periodically

Prevents degraded reasoning.

---

# 14. Example Harness Architecture

A practical agent system might look like:

```
Discord Command
        ↓
Planner Agent
        ↓
Task Queue
        ↓
Execution Agent
        ↓
Observer Agent
        ↓
Evaluation Agent
        ↓
Iteration Loop
```

---

# 15. Key Insight

The most important idea:

> **AI agents become significantly more capable when structured with clear roles, explicit prompts, and engineered context flows.**

The model itself matters less than **how you orchestrate it**.

