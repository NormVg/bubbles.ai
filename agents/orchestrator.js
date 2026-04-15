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
 * Format tool results into readable text for the Discord response.
 */
function formatToolResults(steps) {
  const parts = [];

  for (const step of steps) {
    if (!step.toolResults || step.toolResults.length === 0) continue;

    for (const tr of step.toolResults) {
      const toolName = tr.toolName;
      const result = tr.result;

      if (!result) continue;

      if (toolName === 'shell') {
        const output = result.stdout || result.stderr || '(no output)';
        const status = result.exitCode === 0 ? '✅' : '⚠️';
        parts.push(`${status} **shell** \`${tr.args?.command || 'command'}\`\n\`\`\`\n${output.slice(0, 1500)}\n\`\`\``);
      } else if (toolName === 'readFile') {
        if (result.error) {
          parts.push(`⚠️ **readFile** ${result.path}: ${result.error}`);
        } else {
          parts.push(`📄 **${result.path}**\n\`\`\`\n${result.content?.slice(0, 1500) || '(empty)'}\n\`\`\``);
        }
      } else if (toolName === 'writeFile') {
        if (result.error) {
          parts.push(`⚠️ **writeFile** ${result.path}: ${result.error}`);
        } else {
          parts.push(`✅ **Wrote** ${result.path} (${result.bytesWritten} bytes)`);
        }
      } else if (toolName === 'listDir') {
        if (result.error) {
          parts.push(`⚠️ **listDir** ${result.path}: ${result.error}`);
        } else {
          const listing = (result.entries || [])
            .slice(0, 30)
            .map((e) => `${e.type === 'dir' ? '📁' : '📄'} ${e.name}`)
            .join('\n');
          parts.push(`📂 **${result.path}**\n${listing || '(empty directory)'}`);
        }
      } else if (toolName === 'loadSkill') {
        if (result.error) {
          parts.push(`⚠️ **loadSkill**: ${result.error}`);
        } else {
          parts.push(`📚 **Loaded skill** from ${result.skillDirectory}`);
        }
      } else {
        parts.push(`🔧 **${toolName}**: ${JSON.stringify(result).slice(0, 500)}`);
      }
    }
  }

  return parts.join('\n\n');
}

/**
 * Generate an upfront task plan via a quick LLM call.
 * Returns an array of step description strings.
 */
async function generatePlanSteps(query) {
  try {
    logger.info('Orchestrator', 'Generating upfront plan...');

    const planResult = await generateText({
      model: getModel(),
      system: `You are a task planner. Given a user request, output a JSON array of 2-6 short task step descriptions (max 50 chars each). Output ONLY the raw JSON array, no markdown, no code fences, no explanation.

Example input: "get system info, save to file, send it"
Example output: ["Gather system information","Save report to file","Send file to user"]

Example input: "what time is it"
Example output: ["Check current time"]`,
      prompt: query,
    });

    const raw = planResult.text.trim();
    logger.debug('Orchestrator', `Plan LLM response: ${raw}`);

    // Extract JSON array from response
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      const steps = JSON.parse(match[0]);
      if (Array.isArray(steps) && steps.length > 0 && steps.length <= 10) {
        const cleaned = steps.map((s) => String(s).slice(0, 60)).filter(Boolean);
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

  // Fallback
  return ['Processing your request'];
}

/**
 * Run the orchestration agent for a user query.
 *
 * @param {string} userMessage - The user's message
 * @param {object} [context]
 * @param {Array}  [context.history]       - Previous conversation messages
 * @param {string} [context.extraContext]  - Additional context (attachments, etc.)
 * @param {Function} [context.onStep]      - Callback for each step (for live updates)
 * @returns {Promise<{ text: string, steps: number, toolCalls: Array }>}
 */
export async function runAgent(userMessage, context = {}) {
  const skills = await ensureSkillsDiscovered();

  const systemPrompt = await buildSystemPrompt({
    taskPlan: context.taskPlan || null,
    extraContext: context.extraContext || null,
    skills,
  });

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

  // ── Pass 2: Execute with auto-progress marking ─────────────────
  let stepCount = 0;
  const allToolCalls = [];
  const allSteps = [];
  let lastMarkedStep = -1;
  const totalPlanSteps = planSteps.length;

  try {
    const messages = [
      ...(context.history || []),
      { role: 'user', content: userMessage },
    ];

    const result = await generateText({
      model: getModel(),
      system: systemPrompt,
      messages,
      tools,
      stopWhen: stepCountIs(config.MAX_STEPS),
      onStepFinish: (stepData) => {
        stepCount++;
        const { text, toolCalls, toolResults } = stepData;

        logger.debug('Orchestrator', `Step ${stepCount}`, {
          hasText: !!text,
          toolCallCount: toolCalls?.length || 0,
          toolResultCount: toolResults?.length || 0,
        });

        allSteps.push({ text, toolCalls, toolResults });

        if (toolCalls?.length) {
          allToolCalls.push(
            ...toolCalls.map((tc) => ({
              tool: tc.toolName,
              args: tc.args,
            }))
          );
        }

        // ── Auto-mark plan steps based on execution progress ──
        // Skip steps that are just createPlan/markStep calls
        const hasActionTools = toolCalls?.some(
          (tc) => tc.toolName !== 'createPlan' && tc.toolName !== 'markStep'
        );

        if (hasActionTools && totalPlanSteps > 0) {
          // Mark the next incomplete step as done
          const nextStep = lastMarkedStep + 1;
          if (nextStep < totalPlanSteps) {
            taskManager.markStep(nextStep, 'done');
            const plan = taskManager.getActivePlan();
            const desc = plan?.steps[nextStep]?.description || '?';
            logger.info('Orchestrator', `✅ Step ${nextStep + 1}/${totalPlanSteps}: ${desc}`);
            lastMarkedStep = nextStep;
          }
        }

        // Fire onStep callback
        if (context.onStep) {
          context.onStep({ step: stepCount, text, toolCalls, toolResults });
        }
      },
    });

    logger.info('Orchestrator', `Completed in ${stepCount} steps, ${allToolCalls.length} tool calls`);

    // ── Mark ALL remaining plan steps as done ──
    const activePlan = taskManager.getActivePlan();
    if (activePlan) {
      for (let i = lastMarkedStep + 1; i < activePlan.steps.length; i++) {
        taskManager.markStep(i, 'done');
        logger.info('Orchestrator', `✅ Step ${i + 1}/${totalPlanSteps}: ${activePlan.steps[i]?.description}`);
      }
    }

    // ── Build final response ──
    let finalText = result.text || '';

    if (allToolCalls.length > 0) {
      const toolResultsSummary = formatToolResults(allSteps);

      if (toolResultsSummary) {
        const hitStepLimit = stepCount >= config.MAX_STEPS;
        const modelJustNarrated = finalText.length < 200 && stepCount <= 2;
        const noResponse = !finalText || finalText === 'Done — no output to show.';

        if (noResponse || modelJustNarrated || hitStepLimit) {
          const maxResultLen = 1600 - finalText.length;
          const truncatedResults = toolResultsSummary.length > maxResultLen
            ? toolResultsSummary.slice(0, maxResultLen) + '\n\n*...output truncated*'
            : toolResultsSummary;

          finalText = finalText && finalText !== 'Done — no output to show.'
            ? `${finalText}\n\n${truncatedResults}`
            : truncatedResults;
        }
      }
    }

    if (!finalText) {
      finalText = 'Done — no output to show.';
    }

    logger.debug('Orchestrator', `Final response length: ${finalText.length}`);

    return {
      text: finalText,
      steps: stepCount,
      toolCalls: allToolCalls,
    };
  } catch (err) {
    logger.error('Orchestrator', `Agent error: ${err.message}`);

    return {
      text: `⚠️ Agent encountered an error:\n\`\`\`\n${err.message}\n\`\`\`\nPlease try again or rephrase your request.`,
      steps: stepCount,
      toolCalls: allToolCalls,
      error: err.message,
    };
  }
}

export default { runAgent };
