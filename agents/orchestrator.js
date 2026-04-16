import { generateText, stepCountIs } from 'ai';
import { getModel } from '../core/provider.js';
import { buildTools } from '../tools/index.js';
import { buildSystemPrompt } from '../prompts/system.js';
import { discoverSkills } from '../core/skillLoader.js';
import taskManager from '../core/taskManager.js';
import config from '../config.js';
import logger from '../core/logger.js';

// ── Skill discovery (run once at module load) ──────────────────
let discoveredSkills = [];
let skillsReady = false;

async function ensureSkillsDiscovered() {
  if (!skillsReady) {
    discoveredSkills = await discoverSkills();
    skillsReady = true;
  }
  return discoveredSkills;
}

// Kick off discovery immediately (non-blocking)
ensureSkillsDiscovered().catch((err) => {
  logger.error('Orchestrator', `Skill discovery failed: ${err.message}`);
});

/**
 * Generate an upfront task plan via a quick LLM call.
 */
async function generatePlanSteps(query) {
  try {
    logger.info('Orchestrator', 'Generating task plan...');

    const planResult = await generateText({
      model: getModel(),
      system: `You are a task decomposition engine for an autonomous agent. Your job is to break a user request into concrete, executable steps.

Rules:
- Output ONLY a raw JSON array of strings. No markdown, no explanation, no code fences.
- Each step must be a concrete action the agent can execute (not vague like "plan the project")
- Steps should be ordered logically (dependencies first)
- Use 1-15 steps depending on complexity
- Max 60 characters per step
- Include setup steps (scaffold, install) and delivery steps (test, send) when appropriate
- The agent has these tools: shell, readFile, writeFile, listDir, sendFile, loadSkill

Simple request (1-3 steps):
"what time is it" → ["Check current time"]
"read my package.json" → ["Read package.json","Respond with contents"]

Medium request (3-6 steps):
"get system info, save and send it" → ["Load system-info skill","Run system info commands","Save report to file","Send report to user"]

Complex request (6-15 steps):
"build a music player website with Vue3" → ["Scaffold Vue 3 project with Vite","Install dependencies","Create App layout with header and player area","Build file upload component","Implement audio player with controls","Add playlist/track list display","Add volume and progress controls","Style with dark minimal aesthetic","Test the application","Send project files to user"]`,
      prompt: query,
    });

    const raw = planResult.text.trim();
    logger.debug('Orchestrator', `Plan LLM response: ${raw}`);

    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      const steps = JSON.parse(match[0]);
      if (Array.isArray(steps) && steps.length > 0 && steps.length <= 20) {
        const cleaned = steps.map((s) => String(s).slice(0, 80)).filter(Boolean);
        if (cleaned.length > 0) {
          logger.info('Orchestrator', `Plan generated: ${cleaned.length} steps`);
          return cleaned;
        }
      }
    }

    logger.warn('Orchestrator', `Could not parse plan from: ${raw.slice(0, 100)}`);
  } catch (err) {
    logger.warn('Orchestrator', `Plan generation failed: ${err.message}`);
  }

  return ['Processing your request'];
}

/**
 * Run the orchestration agent for a user query.
 *
 * Uses a step-by-step execution model:
 *   1. Generate a plan upfront (quick LLM call)
 *   2. Show plan in Discord immediately
 *   3. Execute each plan step one at a time
 *   4. Mark each step done only when actually completed
 *
 * @param {string} userMessage - The user's message
 * @param {object} [context]
 * @returns {Promise<{ text: string, steps: number, toolCalls: Array }>}
 */
export async function runAgent(userMessage, context = {}) {
  const skills = await ensureSkillsDiscovered();
  const tools = buildTools({ skills });

  logger.info('Orchestrator', `Processing query: "${userMessage.slice(0, 100)}..."`);
  logger.debug('Orchestrator', `Skills available: ${skills.length}, Tools: ${Object.keys(tools).join(', ')}`);

  taskManager.setContext(userMessage);

  // ── Pass 1: Generate upfront plan & show in Discord ────────────
  const planSteps = await generatePlanSteps(userMessage);
  taskManager.createPlan(planSteps);

  // Log the full plan to terminal
  logger.info('Orchestrator', '┌── Task Plan ──────────────────────');
  planSteps.forEach((step, i) => {
    logger.info('Orchestrator', `│ ${i + 1}. ${step}`);
  });
  logger.info('Orchestrator', '└───────────────────────────────────');

  // ── Pass 2: Execute each step one at a time ────────────────────
  let totalStepCount = 0;
  const allToolCalls = [];
  // Conversation history carries context between steps
  let conversationMessages = [
    ...(context.history || []),
    { role: 'user', content: userMessage },
  ];

  const systemPrompt = await buildSystemPrompt({
    taskPlan: planSteps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    extraContext: context.extraContext || null,
    skills,
  });

  // Max tool-call steps PER plan step (prevent infinite loops)
  const maxStepsPerPlanStep = Math.max(3, Math.floor(config.MAX_STEPS / planSteps.length));

  try {
    let lastStepText = '';

    for (let planIdx = 0; planIdx < planSteps.length; planIdx++) {
      const stepDesc = planSteps[planIdx];
      logger.info('Orchestrator', `── Executing step ${planIdx + 1}/${planSteps.length}: ${stepDesc} ──`);

      // Inject a user message telling the agent which step to execute
      const stepInstruction = planIdx === 0
        ? userMessage // First step uses the original query
        : `Continue with step ${planIdx + 1}: "${stepDesc}"`;

      const messages = planIdx === 0
        ? conversationMessages
        : [...conversationMessages, { role: 'user', content: stepInstruction }];

      const result = await generateText({
        model: getModel(),
        system: systemPrompt,
        messages,
        tools,
        stopWhen: stepCountIs(maxStepsPerPlanStep),
        onStepFinish: (stepData) => {
          totalStepCount++;
          const { toolCalls } = stepData;

          if (toolCalls?.length) {
            allToolCalls.push(
              ...toolCalls.map((tc) => ({
                tool: tc.toolName,
                args: tc.args,
              }))
            );
          }

          // Fire onStep callback for typing indicator etc.
          if (context.onStep) {
            context.onStep({ step: totalStepCount, ...stepData });
          }
        },
      });

      // Carry conversation forward so next step has context
      if (result.response?.messages) {
        conversationMessages = [...conversationMessages, ...result.response.messages];
      }

      // Capture the text from the last step that produced text
      if (result.text) {
        lastStepText = result.text;
      }

      // ── Mark this plan step as DONE ──
      taskManager.markStep(planIdx, 'done');
      logger.info('Orchestrator', `[x] Step ${planIdx + 1}/${planSteps.length}: ${stepDesc}`);
    }

    logger.info('Orchestrator', `Completed in ${totalStepCount} steps, ${allToolCalls.length} tool calls`);

    let finalText = lastStepText || 'Done — no output to show.';

    // Truncate to Discord limit
    if (finalText.length > 1900) {
      finalText = finalText.slice(0, 1900) + '\n\n*...truncated*';
    }

    logger.debug('Orchestrator', `Final response length: ${finalText.length}`);

    return {
      text: finalText,
      steps: totalStepCount,
      toolCalls: allToolCalls,
    };
  } catch (err) {
    logger.error('Orchestrator', `Agent error: ${err.message}`);

    return {
      text: `Agent encountered an error:\n\`\`\`\n${err.message}\n\`\`\`\nPlease try again or rephrase your request.`,
      steps: totalStepCount,
      toolCalls: allToolCalls,
      error: err.message,
    };
  }
}

export default { runAgent };
