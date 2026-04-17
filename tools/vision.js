import { readFile, stat } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { tool } from 'ai';
import { z } from 'zod';
import { generateText } from 'ai';
import { getVisionModel } from '../core/provider.js';
import config from '../config.js';
import logger from '../core/logger.js';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

// ── Vision Analyze ──────────────────────────────────────────────
export const visionAnalyzeTool = tool({
  description:
    'Analyze an image file from the filesystem using the vision model. ' +
    'Use this to describe, interpret, inspect screenshots, diagrams, UI mockups, or any image on disk. ' +
    'Provide an absolute or workspace-relative path to the image file.',
  parameters: z.object({
    path: z.string().describe('Absolute or workspace-relative path to the image file (e.g. workspace/screenshot.png)'),
    question: z.string().optional().describe('A HIGHLY SPECIFIC request for what you need to extract (e.g., "Find the exact (X, Y) coordinates of the Twitter Post button"). DO NOT leave this blank; blind generic analysis is slow and useless.'),
  }),
  execute: async ({ path: imagePath, question }) => {
    try {
      // Guard against undefined path
      if (!imagePath) {
        return { error: 'Missing required "path" parameter. Provide the absolute or workspace-relative path to an image file.' };
      }

      // Resolve path: try absolute first, then workspace-relative
      let absPath = resolve(imagePath);
      if (!existsSync(absPath)) {
        absPath = resolve(config.WORKING_DIR, imagePath);
      }
      if (!existsSync(absPath)) {
        return { error: `Image file not found: ${imagePath}` };
      }

      // Guard: must be an image type
      const lowerPath = absPath.toLowerCase();
      const isImage = IMAGE_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
      if (!isImage) {
        return { error: `File does not appear to be an image: ${imagePath}. Supported: ${IMAGE_EXTENSIONS.join(', ')}` };
      }

      const fileInfo = await stat(absPath);
      if (fileInfo.size > 20 * 1024 * 1024) {
        return { error: 'Image file is too large (> 20MB). Reduce size before analyzing.' };
      }

      logger.info('VisionTool', `Analyzing image: ${absPath}`);
      const buffer = await readFile(absPath);

      const rawPrompt = question || 'Identify the core actionable elements in this image.';
      const prompt = `${rawPrompt}\n\nCRITICAL CONSTRAINTS:\n- Be extremely concise.\n- Return ONLY the exact answer/information requested.\n- Do NOT output conversational filler, thoughts, or formatting.\n- Use the absolute minimum number of words possible.`;

      const result = await generateText({
        model: getVisionModel(),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', image: buffer },
            ],
          },
        ],
      });

      logger.info('VisionTool', `Vision analysis complete (${result.text.length} chars)`);
      return { description: result.text, imagePath: absPath };
    } catch (err) {
      logger.error('VisionTool', `Vision analysis failed: ${err.message}`);
      return { error: err.message };
    }
  },
});
