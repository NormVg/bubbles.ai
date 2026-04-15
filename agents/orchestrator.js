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
 * Called when the model called tools but didn't summarize results.
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
        // Generic fallback
        parts.push(`🔧 **${toolName}**: ${JSON.stringify(result).slice(0, 500)}`);
      }
    }
  }

  return parts.join('\n\n');
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
  // Ensure skills are discovered
  const skills = await ensureSkillsDiscovered();

  const systemPrompt = await buildSystemPrompt({
    taskPlan: context.taskPlan || null,
    extraContext: context.extraContext || null,
    skills,
  });

  // Build tools with skill support
  const tools = buildTools({ skills });

  logger.info('Orchestrator', `Processing query: "${userMessage.slice(0, 100)}..."`);
  logger.debug('Orchestrator', `Skills available: ${skills.length}, Tools: ${Object.keys(tools).join(', ')}`);

  let stepCount = 0;
  const allToolCalls = [];
  const allSteps = [];

  try {
    // Build messages array — AI SDK doesn't allow both `prompt` and `messages`
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

        // Store full step data for result building
        allSteps.push({ text, toolCalls, toolResults });

        // Track tool calls for metadata
        if (toolCalls?.length) {
          allToolCalls.push(
            ...toolCalls.map((tc) => ({
              tool: tc.toolName,
              args: tc.args,
            }))
          );
        }

        // Fire onStep callback if provided (for Discord typing updates etc.)
        if (context.onStep) {
          context.onStep({ step: stepCount, text, toolCalls, toolResults });
        }
      },
    });

    logger.info('Orchestrator', `Completed in ${stepCount} steps, ${allToolCalls.length} tool calls`);

    // Build the final response
    let finalText = result.text || '';

    // If tools were called but the model's text doesn't include results,
    // append formatted tool results.
    if (allToolCalls.length > 0) {
      const toolResultsSummary = formatToolResults(allSteps);

      if (toolResultsSummary) {
        const modelJustNarrated = finalText.length < 200 && stepCount <= 2;

        if (modelJustNarrated || !finalText) {
          finalText = finalText
            ? `${finalText}\n\n${toolResultsSummary}`
            : toolResultsSummary;
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
