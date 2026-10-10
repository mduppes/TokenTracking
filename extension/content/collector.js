// Runs in the extension's ISOLATED world on provider sites.
// 1. Relays usage JSON captured by hook.js to the service worker.
// 2. Scrapes usage meters from the page via lib/scrape-dom.js ("NN% used" text, ARIA progress bars). See docs/PROVIDERS.md for per-site notes.
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

  async function runOpenSteps(steps) {
    await TokenTrackingDom.runOpenSteps(steps);
    activeUntil = Date.now() + 30_000;
    schedule();
  }

  const scrape = () => TokenTrackingDom.scrape();

  // SPA route changes (claude.ai uses hash routes for settings).
  let lastHref = location.href;
  setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; lastSent = ''; refreshConfig(); } }, 1000);

  refreshConfig();
})();
