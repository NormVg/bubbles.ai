import { randomUUID } from 'crypto';
import logger from './logger.js';

/**
 * Lightweight in-memory task manager.
 * The orchestrator creates a plan at the start of each query,
 * then marks steps as it works through them.
 */

const STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

class TaskManager {
  constructor() {
    /** @type {Map<string, { id: string, query: string, steps: Array, createdAt: Date }>} */
    this.tasks = new Map();
  }

  /**
   * Create a new task plan.
   * @param {string} query - Original user query
   * @param {string[]} steps - List of step descriptions
   * @returns {{ id: string, plan: object }}
   */
  createPlan(query, steps = []) {
    const id = randomUUID().slice(0, 8);
    const plan = {
      id,
      query,
      steps: steps.map((desc, i) => ({
        index: i,
        description: desc,
        status: STATUS.PENDING,
        result: null,
      })),
      createdAt: new Date(),
    };

    this.tasks.set(id, plan);
    logger.info('TaskManager', `Created plan [${id}] with ${steps.length} steps`);
    return { id, plan };
  }

  /**
   * Update a step's status and optional result.
   */
  markStep(taskId, stepIndex, status, result = null) {
    const plan = this.tasks.get(taskId);
    if (!plan) return null;

    const step = plan.steps[stepIndex];
    if (!step) return null;

    step.status = status;
    step.result = result;
    logger.debug('TaskManager', `[${taskId}] Step ${stepIndex}: ${status}`);
    return step;
  }

  /**
   * Get plan by ID.
   */
  getPlan(taskId) {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Get a markdown checklist of the current plan state.
   */
  getSummary(taskId) {
    const plan = this.tasks.get(taskId);
    if (!plan) return 'No active task plan.';

    const statusIcons = {
      [STATUS.PENDING]: '[ ]',
      [STATUS.IN_PROGRESS]: '[/]',
      [STATUS.DONE]: '[x]',
      [STATUS.FAILED]: '[!]',
      [STATUS.SKIPPED]: '[-]',
    };

    const lines = plan.steps.map(
      (s) => `- ${statusIcons[s.status]} ${s.description}`
    );

    return `**Task:** ${plan.query}\n${lines.join('\n')}`;
  }

  /**
   * Clean up completed tasks (keep last N).
   */
  cleanup(keepLast = 10) {
    const entries = [...this.tasks.entries()];
    if (entries.length <= keepLast) return;

    const toRemove = entries.slice(0, entries.length - keepLast);
    for (const [id] of toRemove) {
      this.tasks.delete(id);
    }
  }
}

// Singleton instance
const taskManager = new TaskManager();

export { TaskManager, STATUS };
export default taskManager;
