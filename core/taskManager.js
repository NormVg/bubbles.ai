import { randomUUID } from 'crypto';
import logger from './logger.js';

/**
 * Lightweight in-memory task manager with live update callbacks.
 * The agent creates a plan, marks steps as it works, and a handler
 * pushes live updates to Discord.
 */

const STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

const STATUS_ICONS = {
  [STATUS.PENDING]: '[ ]',
  [STATUS.IN_PROGRESS]: '[~]',
  [STATUS.DONE]: '[x]',
  [STATUS.FAILED]: '[!]',
  [STATUS.SKIPPED]: '[-]',
};

class TaskManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.tasks = new Map();
    this.activePlanId = null;
    this._currentQuery = null;
    this._onUpdate = null;
  }

  /**
   * Set the current query context (called by orchestrator before each run).
   */
  setContext(query) {
    this._currentQuery = query;
    this.activePlanId = null;
  }

  /**
   * Set the update handler (called by Discord handler to receive live updates).
   * @param {((plan: object) => Promise<void>) | null} handler
   */
  setUpdateHandler(handler) {
    // Clear any pending debounced notification before changing handler
    if (this._updateTimer) {
      clearTimeout(this._updateTimer);
      this._updateTimer = null;
    }
    this._onUpdate = handler;
  }

  /**
   * Create a new task plan. Called by the agent's createPlan tool.
   * @param {string[]} steps - List of step descriptions
   * @returns {object} The created plan
   */
  createPlan(steps = []) {
    const id = randomUUID().slice(0, 8);
    const plan = {
      id,
      query: this._currentQuery || 'Working...',
      steps: steps.map((desc, i) => ({
        index: i,
        description: desc,
        status: STATUS.PENDING,
        result: null,
      })),
      createdAt: new Date(),
    };

    this.tasks.set(id, plan);
    this.activePlanId = id;
    logger.info('TaskManager', `Created plan [${id}] with ${steps.length} steps`);
    this._notifyUpdate(plan);
    return plan;
  }

  /**
   * Update a step's status. Called by the agent's markStep tool.
   * @param {number} stepIndex
   * @param {string} status - One of: done, failed, skipped, in_progress
   * @param {string} [result] - Optional result text
   */
  markStep(stepIndex, status, result = null) {
    const plan = this.tasks.get(this.activePlanId);
    if (!plan) return null;

    const step = plan.steps[stepIndex];
    if (!step) return null;

    step.status = status;
    if (result) step.result = result;
    logger.debug('TaskManager', `[${this.activePlanId}] Step ${stepIndex}: ${status}`);
    this._notifyUpdate(plan);
    return step;
  }

  /**
   * Get the active plan.
   */
  getActivePlan() {
    if (!this.activePlanId) return null;
    return this.tasks.get(this.activePlanId) || null;
  }

  /**
   * Check if all steps in the active plan are completed (done/failed/skipped).
   */
  isComplete() {
    const plan = this.getActivePlan();
    if (!plan) return false;
    return plan.steps.every(
      (s) => s.status === STATUS.DONE || s.status === STATUS.FAILED || s.status === STATUS.SKIPPED
    );
  }

  /**
   * Get a formatted Discord-friendly summary of the plan.
   */
  getFormattedSummary(planId) {
    const plan = this.tasks.get(planId || this.activePlanId);
    if (!plan) return null;

    const doneCount = plan.steps.filter((s) => s.status === STATUS.DONE).length;
    const failedCount = plan.steps.filter((s) => s.status === STATUS.FAILED).length;
    const total = plan.steps.length;
    const progress = total > 0 ? Math.round((doneCount / total) * 100) : 0;

    // Visual progress bar
    const barLen = 10;
    const filled = Math.round((doneCount / total) * barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

    // Step list
    const lines = plan.steps.map(
      (s) => `${STATUS_ICONS[s.status]} ${s.description}`
    );

    // Status label
    let statusLabel = '`STATUS: WORKING`';
    if (doneCount === total) statusLabel = '`STATUS: COMPLETE`';
    else if (failedCount > 0) statusLabel = '`STATUS: IN PROGRESS (errors)`';

    return [
      `**\`TASK PROGRESS\`**`,
      ``,
      lines.join('\n'),
      ``,
      `\`${bar}\`  ${doneCount}/${total} (${progress}%)`,
      statusLabel,
    ].join('\n');
  }

  /**
   * Notify the update handler (debounced to prevent race conditions).
   */
  _notifyUpdate(plan) {
    if (!this._onUpdate) return;

    // Debounce: collapse rapid-fire notifications into one
    if (this._updateTimer) clearTimeout(this._updateTimer);
    this._updateTimer = setTimeout(() => {
      // Guard: handler may have been cleared during the debounce wait
      if (this._onUpdate) {
        Promise.resolve(this._onUpdate(plan)).catch((err) => {
          logger.warn('TaskManager', `Update handler error: ${err.message}`);
        });
      }
    }, 300);
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
