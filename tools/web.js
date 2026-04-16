/**
 * Web tools — search and scrape using agent-browser CLI.
 *
 * agent-browser is a Rust-based browser automation CLI that uses Chrome via CDP.
 * It's already installed globally: `agent-browser --version`
 *
 * These tools wrap common patterns:
 * - webSearch: Google search + extract results
 * - webScrape: Navigate to URL + extract readable text
 */

import { exec } from 'child_process';
import { tool } from 'ai';
import { z } from 'zod';
import logger from '../core/logger.js';

const TIMEOUT = 30000;
const MAX_OUTPUT = 6000;

/**
 * Run an agent-browser command and return stdout.
 */
function runBrowser(command, timeout = TIMEOUT) {
  return new Promise((resolve) => {
    exec(command, { timeout, maxBuffer: 1024 * 1024, shell: '/bin/zsh' }, (error, stdout, stderr) => {
      if (error && error.killed) {
        resolve({ output: '', error: `Command timed out after ${timeout}ms` });
      } else if (error) {
        resolve({ output: stdout || '', error: stderr || error.message });
      } else {
        resolve({ output: stdout || '', error: null });
      }
    });
  });
}

/**
 * webSearch — Search Google using agent-browser and extract results.
 */
export const webSearchTool = tool({
  description:
    'Search Google for information using a real browser. Returns top result titles, URLs, and snippets. ' +
    'Use when you need current information, documentation, tutorials, or to research any topic.',
  parameters: z.object({
    query: z.string().describe('The search query'),
    maxResults: z.number().optional().describe('Max results to return (default: 5)'),
  }),
  execute: async ({ query, maxResults = 5 }) => {
    logger.info('WebSearch', `Searching: "${query}"`);

    try {
      const encoded = encodeURIComponent(query);
      const searchUrl = `https://www.google.com/search?q=${encoded}&num=${maxResults + 3}`;

      // Navigate to Google search
      await runBrowser(`agent-browser open "${searchUrl}"`);

      // Wait for results to load
      await runBrowser(`agent-browser wait --load networkidle`);

      // Extract search results using snapshot (interactive elements)
      const { output: snapshot, error } = await runBrowser(`agent-browser snapshot -c`);

      if (error && !snapshot) {
        logger.error('WebSearch', `Browser error: ${error}`);
        return { error, results: [] };
      }

      // Parse results from the snapshot text
      const results = [];
      const lines = snapshot.split('\n');
      let currentTitle = '';
      let currentUrl = '';

      for (const line of lines) {
        const trimmed = line.trim();

        // Look for links that are search results (contain http and have text)
        const urlMatch = trimmed.match(/\[link\].*?"(https?:\/\/[^"]+)"/i) ||
          trimmed.match(/(https?:\/\/(?!www\.google\.|google\.)[^\s"]+)/);
        if (urlMatch) {
          currentUrl = urlMatch[1];
        }

        // Capture text content near links as titles
        if (currentUrl && trimmed.length > 10 && !trimmed.includes('google.com')) {
          const titleText = trimmed.replace(/\[.*?\]/g, '').replace(/[@\d]+/g, '').trim();
          if (titleText.length > 5 && !currentTitle) {
            currentTitle = titleText.slice(0, 100);
          }
        }

        // When we have both, save the result
        if (currentUrl && currentTitle) {
          results.push({
            title: currentTitle,
            url: currentUrl,
          });
          currentTitle = '';
          currentUrl = '';
          if (results.length >= maxResults) break;
        }
      }

      // Close the browser
      await runBrowser(`agent-browser close`);

      logger.info('WebSearch', `Found ${results.length} results`);
      return { query, results, count: results.length };
    } catch (err) {
      logger.error('WebSearch', `Search failed: ${err.message}`);
      return { error: err.message, results: [] };
    }
  },
});

/**
 * webScrape — Navigate to a URL and extract readable text content.
 */
export const webScrapeTool = tool({
  description:
    'Fetch a web page using a real browser and extract its text content. ' +
    'Handles JavaScript-rendered pages, SPAs, and dynamic content. ' +
    'Use to read documentation, articles, guides, API docs, or any web page.',
  parameters: z.object({
    url: z.string().describe('The URL to scrape'),
  }),
  execute: async ({ url }) => {
    logger.info('WebScrape', `Scraping: ${url}`);

    try {
      // Navigate to the page
      await runBrowser(`agent-browser open "${url}"`);

      // Wait for page to fully load
      await runBrowser(`agent-browser wait --load networkidle`);

      // Get the page title
      const { output: title } = await runBrowser(`agent-browser get title`);

      // Get full page text via snapshot (compact mode for readability)
      const { output: snapshot, error } = await runBrowser(`agent-browser snapshot -c`);

      if (error && !snapshot) {
        logger.error('WebScrape', `Browser error: ${error}`);
        return { error, url };
      }

      // Clean up the snapshot output to extract readable text
      let content = snapshot
        .replace(/^\s*@\w+\s*/gm, '')       // Remove element refs
        .replace(/\[(?:img|image)\]/gi, '')  // Remove image markers
        .replace(/\n{3,}/g, '\n\n')          // Collapse blank lines
        .trim();

      // Truncate
      if (content.length > MAX_OUTPUT) {
        content = content.slice(0, MAX_OUTPUT) + '\n\n[...content truncated]';
      }

      // Close browser
      await runBrowser(`agent-browser close`);

      logger.info('WebScrape', `Scraped ${url}: ${content.length} chars`);
      return {
        title: title.trim(),
        url,
        content,
        length: content.length,
      };
    } catch (err) {
      logger.error('WebScrape', `Scrape failed: ${err.message}`);
      return { error: err.message, url };
    }
  },
});

export default { webSearchTool, webScrapeTool };
