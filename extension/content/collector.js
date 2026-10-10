// Runs in the extension's ISOLATED world on provider sites.
// 1. Relays usage JSON captured by hook.js to the service worker.
// 2. Scrapes usage meters from the page: "NN% used" text and ARIA progress bars,
//    plus the nearest label and "Resets …" line. See docs/PROVIDERS.md for per-site notes.
// 3. During background refresh, can open a provider's usage dialog (provider.openSteps).
(() => {
  let config = null; // { providerId, scrapeDom, autoOpen, openSteps } from the service worker
  let lastSent = '';
  let observer = null;
  let activeUntil = 0;

  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.__tokentracking !== 'json') return;
    send({ type: 'capture', kind: 'json', url: e.data.url, data: e.data.data });
  });

  async function refreshConfig() {
    try { config = await chrome.runtime.sendMessage({ type: 'whoami', href: location.href }); } catch { config = null; }
    if (!config || config.noDom) return; // JSON relay above still works
    if (config.scrapeDom) activeUntil = Date.now() + 90_000; // usage page: scrape eagerly for 90s
    startObserving();
    if (config.autoOpen && config.openSteps?.length) runOpenSteps(config.openSteps);
  }

  // Keep observing for the life of the page, but only scrape when it's cheap and likely useful:
  // on a usage page shortly after load, or whenever a valued progress bar is on screen (e.g. a settings dialog).
  function startObserving() {
    schedule();
    if (observer) return;
    observer = new MutationObserver(() => schedule());
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-valuenow', 'style'] });
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const eager = Date.now() < activeUntil;
      if (!eager && !document.querySelector('[role="progressbar"][aria-valuenow], progress')) return;
      const meters = scrape();
      const key = JSON.stringify(meters);
      if (meters.length && key !== lastSent) {
        lastSent = key;
        send({ type: 'capture', kind: 'dom', url: location.origin + location.pathname, meters });
      }
    }, 1500);
  }

  /** Click through to the usage view. Steps: { selector } or { text, within? } (exact text match on a clickable element). */
  async function runOpenSteps(steps) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const step of steps) {
      let el = null;
      for (let i = 0; i < 40 && !el; i++) { // wait up to ~20s for the element
        el = step.selector
          ? document.querySelector(step.selector)
          : [...document.querySelectorAll(step.within || 'button,[role=menuitem],[role=tab],a')].find((b) => b.innerText.trim() === step.text);
        if (!el) await sleep(500);
      }
      if (!el) return;
      el.click();
      await sleep(800);
    }
    activeUntil = Date.now() + 30_000;
    schedule();
  }

  const PCT_RE = /(\d{1,3}(?:\.\d+)?)\s*%/;
  const PCT_ALL = /(\d{1,3}(?:\.\d+)?)\s*%/g;
  const PCT_LEAF = /^\s*\d{1,3}(?:\.\d+)?\s*%(\s*(used|left|remaining))?\s*$/i;
  const RESET_RE = /reset|renew|refresh|available again/i;
  const ICON_RE = /^[a-z_]+$/; // Material icon ligatures like "info", "chevron_right"

  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const lines = (el) => (el.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const pctCount = (t) => (t.match(PCT_ALL) || []).length;

  /** Largest ancestor (≤8 levels, ≤400 chars) that still contains at most one percentage: the meter's "card". */
  function boxAround(el) {
    let box = el, cur = el;
    for (let i = 0; i < 8 && cur.parentElement; i++) {
      cur = cur.parentElement;
      const t = cur.innerText || '';
      if (pctCount(t) > 1 || t.length > 400) break;
      box = cur;
    }
    return box;
  }

  const isLabel = (l) => !RESET_RE.test(l) && !PCT_RE.test(l) && !ICON_RE.test(l) && l.length <= 80 && /[A-Za-z]/.test(l);

  /** Label = nearest plausible line before the % line, else after it. */
  function labelFrom(ls, idx) {
    for (let i = idx - 1; i >= 0; i--) if (isLabel(ls[i])) return ls[i];
    for (let i = idx + 1; i < ls.length; i++) if (isLabel(ls[i]) && !/upgrade|learn more/i.test(ls[i])) return ls[i];
    return 'Usage';
  }

  function barPercent(el) {
    if (el.tagName === 'PROGRESS') return el.max ? (el.value / el.max) * 100 : null;
    const now = el.getAttribute('aria-valuenow');
    if (now == null) return null;
    const min = +(el.getAttribute('aria-valuemin') || 0);
    const max = +(el.getAttribute('aria-valuemax') || 100);
    return max > min ? ((+now - min) / (max - min)) * 100 : null;
  }

  function scrape() {
    const meters = [];
    const seen = new Set();
    const add = (label, pct, resetText, usedText) => {
      const key = label.toLowerCase();
      if (pct == null || Number.isNaN(pct) || seen.has(key)) return;
      seen.add(key);
      meters.push({ label, percent: Math.round(pct * 100) / 100, resetText: resetText || null, usedText: usedText || null });
    };
    const fromText = (pctLine, fallback) => {
      if (!pctLine) return fallback;
      const v = parseFloat(pctLine.match(PCT_RE)[1]);
      return /left|remaining/i.test(pctLine) ? 100 - v : v;
    };

    // 1. ARIA progress bars that carry a value (labelled bars, e.g. Muse settings).
    for (const pb of document.querySelectorAll('[role="progressbar"][aria-valuenow], progress')) {
      if (!visible(pb)) continue;
      const ls = lines(boxAround(pb));
      const idx = ls.findIndex((l) => PCT_RE.test(l));
      const label = pb.getAttribute('aria-label') || labelFrom(ls, idx >= 0 ? idx : ls.length);
      add(label, fromText(ls[idx], barPercent(pb)), ls.find((l) => RESET_RE.test(l)), ls[idx]);
    }

    // 2. Text-only meters: a leaf element reading "NN% used" (e.g. Gemini /usage).
    for (const leaf of document.querySelectorAll('body *')) {
      if (leaf.childElementCount || !PCT_LEAF.test(leaf.textContent) || !visible(leaf)) continue;
      if (leaf.closest('nav,[role=navigation]')) continue;
      const ls = lines(boxAround(leaf));
      const idx = ls.findIndex((l) => PCT_RE.test(l));
      add(labelFrom(ls, idx), fromText(ls[idx]), ls.find((l) => RESET_RE.test(l)), ls[idx]);
    }
    return meters.slice(0, 20);
  }

  // SPA route changes (claude.ai uses hash routes for settings).
  let lastHref = location.href;
  setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; lastSent = ''; refreshConfig(); } }, 1000);

  refreshConfig();
})();
