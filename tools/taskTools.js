import { tool } from 'ai';
import { z } from 'zod';
import taskManager from '../core/taskManager.js';

/**
 * Tool: createPlan
 * The agent calls this at the start of a multi-step task to show
 * the user a live progress checklist in Discord.
 */
export const createPlanTool = tool({
  description:
    'Create a task plan with numbered steps. Use this at the start of any multi-step task (3+ steps) to show the user a live progress checklist. Keep steps concise (under 50 chars each). Do NOT use this for simple 1-2 step tasks.',
  parameters: z.object({
    steps: z
      .array(z.string())
      .min(2)
      .max(10)
      .describe('List of step descriptions, e.g. ["Navigate to URL", "Extract page content", "Compile results"]'),
  }),
  execute: async ({ steps }) => {
    const plan = taskManager.createPlan(steps);
    return {
      planId: plan.id,
      totalSteps: plan.steps.length,
      message: `Plan created with ${plan.steps.length} steps. Use markStep to update progress as you complete each step.`,
    };
  },
});

/**
 * Tool: markStep
 * The agent calls this to mark a step as done/failed/skipped,
 * which triggers a live edit of the Discord progress message.
 */
export const markStepTool = tool({
  description:
    'Mark a step in the current task plan as done, failed, or skipped. Call this after completing each step to update the live progress display for the user.',
  parameters: z.object({
    stepIndex: z
      .number()
      .describe('Zero-based index of the step to update (0 = first step)'),
    status: z
      .enum(['done', 'failed', 'skipped'])
      .describe('New status for the step'),
    result: z
      .string()
      .optional()
      .describe('Optional brief result or note about this step'),
  }),
  execute: async ({ stepIndex, status, result }) => {
    const step = taskManager.markStep(stepIndex, status, result);
    if (!step) {
      return { error: 'No active plan or invalid step index' };
    }

    const plan = taskManager.getActivePlan();
    const doneCount = plan.steps.filter((s) => s.status === 'done').length;

    return {
      success: true,
      step: step.description,
      status,
      progress: `${doneCount}/${plan.steps.length}`,
      allDone: taskManager.isComplete(),
    };
  },
});

export default { createPlanTool, markStepTool };
