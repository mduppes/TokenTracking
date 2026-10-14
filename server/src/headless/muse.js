import { readFile } from 'node:fs/promises';
import { normalizeDomMeters } from '../../../lib/parse.js';
import { MUSE_OPEN_STEPS, parseMuseLimitNotice } from '../../../lib/providers.js';

const scraperURL = new URL('../../../lib/scrape-dom.js', import.meta.url);

export function museIsWarmingUp(text) {
  return /^(?:Connecting[.…]*|(?:[^\n]{0,20}\s)?(?:is\s+)?warming up[.…]*)$/i.test(String(text || '').trim());
}

/** Muse's agent and Settings usage can warm up separately. Keep the page alive for both,
 * and consult the guarded limit notice only after giving the current meter time to appear. */
export async function readMuseUsage(page, {
  timeoutMs = 180_000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const scraper = await readFile(scraperURL, 'utf8');
  const deadline = now() + timeoutMs;
  let state = null;
  for (;;) {
    try {
      state = await page.evaluate(`${scraper}\n;({
        shell: !!document.querySelector('button[data-testid="hatch-dock-more"]'),
        busy: [...document.querySelectorAll('body *')].some(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0
            && (${museIsWarmingUp.toString()})(el.innerText);
        }),
        dialog: [...document.querySelectorAll('[role="dialog"]')].some(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }),
        text: document.body?.innerText || '',
        raw: TokenTrackingDom.scrape()
      })`);
      if (!state.busy && state.shell && !state.dialog && now() < deadline) {
        await page.evaluate(`TokenTrackingDom.runOpenSteps(${JSON.stringify(MUSE_OPEN_STEPS)})`, 30_000);
      } else if (!state.busy && state.dialog && state.raw?.length) {
        const [m] = normalizeDomMeters(state.raw, new Date(now()));
        return { meters: [{ ...m, id: 'weekly', label: 'Weekly limit', window: 'weekly' }], plan: m.label, source: 'headless:dom' };
      }
    } catch {
      // A navigation or agent reload can destroy the context; reinject on the next poll.
      state = null;
    }
    if (now() >= deadline) break;
    await sleep(Math.min(2000, deadline - now()));
  }
  const notice = parseMuseLimitNotice(state?.text, new Date(now()));
  if (notice) return { meters: [notice], source: 'headless:limit-notice' };
  return { error: state?.busy
    ? 'Muse is still warming up or connecting after 3 min; keeping the last reading and retrying next refresh'
    : 'Muse usage did not finish loading within 3 min; keeping the last reading and retrying next refresh' };
}
