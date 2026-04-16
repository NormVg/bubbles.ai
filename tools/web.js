/**
 * Web tools — Google search and page scraping via Puppeteer.
 *
 * Uses puppeteer-extra with stealth plugin to bypass bot detection.
 * Headless Chrome — works for Google, JS-rendered SPAs, everything.
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { tool } from 'ai';
import { z } from 'zod';
import logger from '../core/logger.js';

// Apply stealth plugin (hides headless fingerprints)
puppeteer.use(StealthPlugin());

const MAX_CONTENT = 6000;

/** Shared browser instance — launches once, reuses across calls. */
let _browser = null;

async function getBrowser() {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    logger.info('Puppeteer', 'Browser launched');
  }
  return _browser;
}

/**
 * webSearch — DuckDuckGo search via headless Chrome.
 * (Google blocks headless browsers with CAPTCHA even with stealth.)
 */
export const webSearchTool = tool({
  description:
    'Search the web for information. Returns titles, URLs, and snippets. ' +
    'Use when you need current info, docs, tutorials, or to research any topic.',
  parameters: z.object({
    query: z.string().describe('The search query'),
    maxResults: z.number().optional().describe('Max results (default: 5)'),
  }),
  execute: async ({ query, maxResults = 5 }) => {
    logger.info('WebSearch', `Searching: "${query}"`);
    let page;

    try {
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      const encoded = encodeURIComponent(query);
      await page.goto(`https://duckduckgo.com/?q=${encoded}`, {
        waitUntil: 'networkidle2',
        timeout: 15000,
      });

      // Wait for results
      await page.waitForSelector('[data-testid="result"]', { timeout: 8000 }).catch(() => { });

      // Extract results from DDG DOM
      const results = await page.evaluate((max) => {
        const items = [];
        const els = document.querySelectorAll('[data-testid="result"]');

        for (const el of els) {
          if (items.length >= max) break;

          const linkEl = el.querySelector('a[data-testid="result-title-a"]') || el.querySelector('a[href^="http"]');
          const snippetEl = el.querySelector('[data-result="snippet"]') || el.querySelector('span:not(:has(*))');

          if (linkEl) {
            const title = linkEl.textContent?.trim() || '';
            const url = linkEl.href || '';
            const snippet = snippetEl?.textContent?.trim() || '';

            if (title && url && !url.includes('duckduckgo.com')) {
              items.push({ title, url, snippet });
            }
          }
        }
        return items;
      }, maxResults);

      logger.info('WebSearch', `Found ${results.length} results`);
      return { query, engine: 'duckduckgo', results, count: results.length };
    } catch (err) {
      logger.error('WebSearch', `Search failed: ${err.message}`);
      return { error: err.message, results: [] };
    } finally {
      if (page) await page.close().catch(() => { });
    }
  },
});

/**
 * webScrape — Fetch any URL with headless Chrome and extract text.
 * Handles JS-rendered pages, SPAs, dynamic content.
 */
export const webScrapeTool = tool({
  description:
    'Open a web page in a real browser and extract readable text content. ' +
    'Handles JavaScript-rendered pages, SPAs, and dynamic content. ' +
    'Use to read docs, articles, guides, API refs, or any web page.',
  parameters: z.object({
    url: z.string().describe('The URL to scrape'),
  }),
  execute: async ({ url }) => {
    logger.info('WebScrape', `Scraping: ${url}`);
    let page;

    try {
      const browser = await getBrowser();
      page = await browser.newPage();

      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 20000,
      });

      // Extract title and main content
      const data = await page.evaluate(() => {
        const title = document.title || '';

        // Remove noise elements
        const remove = ['script', 'style', 'nav', 'footer', 'header', 'aside', 'iframe', 'noscript'];
        remove.forEach((tag) => {
          document.querySelectorAll(tag).forEach((el) => el.remove());
        });

        // Try to get main content area first
        const main =
          document.querySelector('main') ||
          document.querySelector('article') ||
          document.querySelector('[role="main"]') ||
          document.querySelector('.content') ||
          document.body;

        const text = main?.innerText || document.body.innerText || '';
        return { title, text };
      });

      // Clean up
      let content = data.text
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      if (content.length > MAX_CONTENT) {
        content = content.slice(0, MAX_CONTENT) + '\n\n[...truncated]';
      }

      logger.info('WebScrape', `Scraped ${url}: ${content.length} chars`);
      return { title: data.title, url, content, length: content.length };
    } catch (err) {
      logger.error('WebScrape', `Scrape failed: ${err.message}`);
      return { error: err.message, url };
    } finally {
      if (page) await page.close().catch(() => { });
    }
  },
});

// Cleanup on process exit
process.on('exit', () => _browser?.close().catch(() => { }));
process.on('SIGINT', () => { _browser?.close().catch(() => { }); process.exit(); });

export default { webSearchTool, webScrapeTool };
