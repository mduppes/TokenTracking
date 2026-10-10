const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 6e4);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
}

function until(iso) {
  if (!iso) return '';
  const m = Math.round((Date.parse(iso) - Date.now()) / 6e4);
  if (m <= 0) return 'resetting';
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return `resets in ${d ? `${d}d ` : ''}${h ? `${h}h ` : ''}${d ? '' : `${mm}m`}`.trim();
}

async function render() {
  const st = await chrome.runtime.sendMessage({ type: 'getState' });
  $('#server').textContent = st.server ? (st.server.ok ? '● service connected' : '● service offline') : '';
  $('#server').style.color = st.server?.ok ? 'var(--ok)' : 'var(--bad)';
  $('#list').innerHTML = st.providers.filter((p) => p.enabled).map((p) => {
    const meters = p.last?.meters || [];
    const body = meters.length
      ? meters.map((m) => {
          const pct = m.usedPercent ?? 0;
          const cls = pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : '';
          return `<div class="meter"><div class="row"><span>${esc(m.label)}</span><span>${m.usedPercent == null ? '?' : Math.round(pct) + '%'} <span class="muted">${esc(until(m.resetsAt) || m.resetText || '')}</span></span></div>
            <div class="bar"><i class="${cls}" style="width:${Math.min(100, pct)}%"></i></div></div>`;
        }).join('')
      : `<div class="muted">No data yet. ${p.usageUrl ? `<a href="${esc(p.usageUrl)}" target="_blank">Open usage page</a>` : 'Open its usage page once, or set the URL in Options.'}</div>`;
    return `<div class="prov"><h2><span>${esc(p.name)}</span><span class="muted">${p.last ? ago(p.last.capturedAt) : ''}</span></h2>${body}</div>`;
  }).join('');
  const lr = st.lastRefresh;
  $('#status').textContent = `${st.queued ? `${st.queued} snapshot(s) waiting for the service · ` : ''}Last refresh: ${lr ? ago(lr.at) : 'never'}`;
  $('#dashboard').onclick = () => chrome.tabs.create({ url: st.settings.serverUrl });
}

$('#refresh').onclick = async () => {
  $('#refresh').disabled = true;
  $('#refresh').textContent = 'Refreshing…';
  await chrome.runtime.sendMessage({ type: 'refreshNow' });
  $('#refresh').disabled = false;
  $('#refresh').textContent = 'Refresh now';
  render();
};
$('#options').onclick = () => chrome.runtime.openOptionsPage();
render();
