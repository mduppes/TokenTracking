import { readFile } from 'node:fs/promises';
import { normalizeDomMeters } from '../../../lib/parse.js';

const scraperURL = new URL('../../../lib/scrape-dom.js', import.meta.url);

export function openAILoggedOut(href, text) {
  const url = new URL(href);
  return /(^|\.)auth\.openai\.com$/.test(url.hostname)
    || (/(^|\.)chatgpt\.com$/.test(url.hostname)
      && (/^\/(?:auth\/)?(?:login|logout)(?:\/|$)/.test(url.pathname)
        || (/^\s*(?:log|sign)\s+in\s*$/im.test(text) && !/usage/i.test(text))));
}

/** ChatGPT can render a guest shell while restoring its session. Decide login only after waiting
 * for meters; reinject each poll because authentication may navigate to a new document. */
export async function readOpenAIUsage(page, {
  timeoutMs = 60_000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const scraper = await readFile(scraperURL, 'utf8');
  const deadline = now() + timeoutMs;
  let state = null;
  for (;;) {
    try {
      state = await page.evaluate(`${scraper}\n;({ href: location.href, text: document.body?.innerText || '', raw: TokenTrackingDom.scrape() })`);
      // A login page can contain a percentage in marketing copy. Never record it as usage.
      if (/^https:\/\/chatgpt\.com\/settings\/usage(?:[/?#]|$)/.test(state.href) && state.raw?.length) {
        return { meters: normalizeDomMeters(state.raw), source: 'headless:dom' };
      }
    } catch {
      // Session restoration may destroy the execution context. A failed final sample is unknown.
      state = null;
    }
    if (now() >= deadline) break;
    await sleep(Math.min(1000, deadline - now()));
  }
  if (state && openAILoggedOut(state.href, state.text)) {
    return { login: true, message: 'ChatGPT still shows a login page after waiting 60 seconds' };
  }
  return { error: 'ChatGPT usage did not finish loading within 60 seconds; will retry next refresh (use Open browser to inspect the page)' };
}
