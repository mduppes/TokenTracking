// Drives real headless Chrome (skipped if Chrome isn't installed) to test the CDP client and the
// shared page reader (lib/scrape-dom.js) against fixtures modeled on the live pages.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CHROME, launchChrome, openPage } from '../server/src/headless/chrome.js';
import { normalizeDomMeters } from '../lib/parse.js';
import { readMuseUsage } from '../server/src/headless/muse.js';

const chromePath = process.env.TOKENTRACKING_CHROME || DEFAULT_CHROME;
const skip = !existsSync(chromePath) && 'Google Chrome not installed';
const SCRAPER = readFileSync(new URL('../lib/scrape-dom.js', import.meta.url), 'utf8');

// Structure seen on gemini.google.com/usage (2026-10-10): label, icon ligature, "N% used", reset line.
const GEMINI = `<main><h1>Usage limits</h1>
  <section><div><div><div>Current usage</div><div>info</div></div><strong>1% used</strong></div><div class="bar"></div><p>Resets at 10:19 AM</p></section>
  <section><div><span>Weekly limit</span><p>Resets Oct 13 at 1:19 AM</p></div><strong>0% used</strong></section>
  <nav><span>Recents</span><span>50% used budget chat</span></nav></main>`;

// Structure seen in muse.ai Settings → General (2026-10-10): labelled ARIA progress bar, opened via a menu.
const MUSE = `<button data-testid="hatch-dock-more" aria-label="Settings" onclick="document.getElementById('menu').hidden=false">≡</button>
  <div id="menu" hidden><div role="menuitem" onclick="document.getElementById('dlg').hidden=false">Settings</div></div>
  <div id="dlg" hidden role="dialog"><h3>Usage</h3><div><div>Free plan</div><div>Weekly limit resets on Oct 14</div><div>95% used</div>
  <div role="progressbar" aria-label="Free plan" aria-valuenow="95" aria-valuemax="100" style="height:4px;width:200px"></div><a>Upgrade</a></div></div>`;

// Structure seen on chatgpt.com/settings/usage?tab=overview (2026-10-17):
// Plan limits with progress bars (aria-label="Usage remaining") and % left, followed by Recent plan usage
// breakdown chart tab ("Weekly") and 100% total that must not be recognized as a quota meter.
const OPENAI = `<main><h1>Usage</h1>
  <section>
    <h2>Plan limits</h2>
    <div>
      <div>5-hour limit</div>
      <div>Resets in 5h 0m</div>
      <span>100% left</span>
      <progress max="100" value="100" aria-label="Usage remaining"></progress>
    </div>
    <div>
      <div>Weekly limit</div>
      <div>Resets in 4d 22h</div>
      <span>17% left</span>
      <progress max="100" value="17" aria-label="Usage remaining"></progress>
    </div>
  </section>
  <section>
    <h2>Recent plan usage</h2>
    <div><button role="tab">5-hour</button><button role="tab">Weekly</button></div>
    <span class="heading-lg">100%</span>
    <div>Balance history isn’t available yet</div>
  </section></main>`;

let conn, profile;
before(async () => {
  if (skip) return;
  profile = mkdtempSync(join(tmpdir(), 'tt-chrome-'));
  conn = await launchChrome({ chromePath, profileDir: profile });
});
after(async () => {
  if (conn) await conn.close();
  if (profile) rmSync(profile, { recursive: true, force: true });
});

async function load(html) {
  const page = await openPage(conn);
  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><body>${html}</body>`)}`);
  await page.evaluate(SCRAPER);
  return page;
}

test('scraper reads Gemini-style text meters, ignores nav', { skip }, async () => {
  const page = await load(GEMINI);
  const raw = await page.evaluate('TokenTrackingDom.scrape()');
  await page.close();
  assert.deepEqual(raw.map((m) => [m.label, m.percent, m.resetText]), [
    ['Current usage', 1, 'Resets at 10:19 AM'],
    ['Weekly limit', 0, 'Resets Oct 13 at 1:19 AM'],
  ]);
  const meters = normalizeDomMeters(raw, new Date(2026, 9, 10, 8, 0));
  assert.deepEqual(meters.map((m) => m.window), ['session', 'weekly']);
  assert.equal(new Date(meters[1].resetsAt).getDate(), 13);
});

test('openSteps reveal a Muse-style dialog, then the progress bar is read', { skip }, async () => {
  const page = await load(MUSE);
  assert.deepEqual(await page.evaluate('TokenTrackingDom.scrape()'), []);
  const opened = await page.evaluate(`TokenTrackingDom.runOpenSteps(${JSON.stringify([{ selector: 'button[data-testid="hatch-dock-more"]' }, { text: 'Settings' }])})`);
  assert.equal(opened, true);
  const raw = await page.evaluate('TokenTrackingDom.scrape()');
  await page.close();
  assert.equal(raw.length, 1);
  assert.deepEqual([raw[0].label, raw[0].percent, raw[0].resetText], ['Free plan', 95, 'Weekly limit resets on Oct 14']);
  assert.equal(normalizeDomMeters(raw)[0].window, 'weekly');
});

test('Muse reader waits for a visible warming-up state before opening Settings and reading zero', { skip }, async () => {
  const page = await load(`<div id="warm"><span>☀</span><span>is warming up</span></div>${MUSE.replaceAll('95', '0')}`);
  const evaluate = page.evaluate.bind(page);
  const errors = [];
  page.evaluate = async (...args) => {
    try { return await evaluate(...args); } catch (e) { errors.push(e.message); throw e; }
  };
  let elapsed = 0;
  try {
    const result = await readMuseUsage(page, {
      now: () => new Date(2026, 9, 10, 8, 0).getTime() + elapsed,
      sleep: async (ms) => {
        elapsed += ms;
        if (elapsed === 140_000) {
          assert.equal(await page.evaluate('document.getElementById("dlg").hidden'), true);
          await page.evaluate('document.getElementById("warm").remove()');
        }
      },
    });
    assert.deepEqual(errors, []);
    assert.equal(elapsed, 142_000);
    assert.equal(result.meters[0].usedPercent, 0);
    assert.equal(result.plan, 'Free plan');
  } finally {
    await page.close();
  }
});

test('scraper reads OpenAI-style progress bars with generic aria-label, ignores activity breakdown chart', { skip }, async () => {
  const page = await load(OPENAI);
  const raw = await page.evaluate('TokenTrackingDom.scrape()');
  await page.close();
  assert.deepEqual(raw.map((m) => [m.label, m.percent, m.resetText]), [
    ['5-hour limit', 0, 'Resets in 5h 0m'],
    ['Weekly limit', 83, 'Resets in 4d 22h'],
  ]);
  const meters = normalizeDomMeters(raw);
  assert.deepEqual(meters.map((m) => [m.id, m.window, m.usedPercent]), [
    ['5-hour-limit', 'session', 0],
    ['weekly-limit', 'weekly', 83],
  ]);
});
