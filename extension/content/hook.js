// Runs in the page's MAIN world at document_start on provider sites only.
// Wraps fetch/XHR so that JSON responses whose URL looks usage-related are copied
// to the isolated collector script (window.postMessage). Nothing else is forwarded,
// and nothing leaves the browser except via the extension → 127.0.0.1 path.
(() => {
  if (window.__tokentrackingHooked) return;
  window.__tokentrackingHooked = true;

  const RE = /usage|limit|quota|credit|billing|plan|subscription/i;
  const MAX_BYTES = 300_000;

  const forward = (rawUrl, text) => {
    try {
      if (!text || text.length > MAX_BYTES) return;
      const u = new URL(rawUrl, location.href);
      if (u.origin !== location.origin || !RE.test(u.pathname)) return;
      const data = JSON.parse(text);
      // Query strings are dropped: they can carry ids we don't need.
      window.postMessage({ __tokentracking: 'json', url: u.origin + u.pathname, data }, location.origin);
    } catch { /* not JSON or not interesting */ }
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      if ((res.headers.get('content-type') || '').includes('json') && RE.test(res.url)) {
        res.clone().text().then((t) => forward(res.url, t), () => {});
      }
    } catch { /* never break the page */ }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      this.addEventListener('load', () => {
        try {
          if (!RE.test(String(url))) return;
          if (this.responseType === '' || this.responseType === 'text') forward(url, this.responseText);
          else if (this.responseType === 'json') forward(url, JSON.stringify(this.response));
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
    return origOpen.call(this, method, url, ...rest);
  };
})();
