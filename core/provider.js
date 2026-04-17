import { createOllama } from 'ai-sdk-ollama';
import config from '../config.js';

// ── Dynamic Ollama provider ────────────────────────────────────
// Supports both local Ollama and remote/cloud endpoints with API key auth.

const ollama = createOllama({
  baseURL: config.OLLAMA_BASE_URL,
  headers: config.OLLAMA_API_KEY
    ? { Authorization: `Bearer ${config.OLLAMA_API_KEY}` }
    : undefined,
});

/**
 * Get a model instance. Falls back to the configured default model.
 * @param {string} [modelId] - Override model ID
 * @returns {import('ai').LanguageModelV1}
 */
export function getModel(modelId) {
  return ollama(modelId || config.OLLAMA_MODEL);
}

/**
 * Get a model instance specifically for vision tasks.
 * @param {string} [modelId] - Override model ID
 * @returns {import('ai').LanguageModelV1}
 */
export function getVisionModel(modelId) {
  return ollama(modelId || config.OLLAMA_VISION_MODEL);
}

export { ollama };
export default { ollama, getModel, getVisionModel };
