const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const st = await chrome.runtime.sendMessage({ type: 'getState' });
const s = st.settings;

$('#serverUrl').value = s.serverUrl;
$('#intervalMin').value = s.intervalMin;
$('#backgroundRefresh').checked = s.backgroundRefresh;
$('#refreshMode').value = s.refreshMode;
$('#debugCapture').checked = s.debugCapture;
$('#lastRefresh').textContent = st.lastRefresh ? JSON.stringify(st.lastRefresh, null, 2) : '—';

$('#providers').innerHTML = st.providers.map((p) => `
  <tr>
    <td><label style="margin:0"><input type="checkbox" data-enabled="${p.id}" ${p.enabled ? 'checked' : ''}> ${esc(p.name)}</label></td>
    <td><input type="text" data-url="${p.id}" placeholder="Usage page URL (optional)" value="${esc(s.usageUrls[p.id] || '')}"></td>
    <td class="muted" style="font-size:11px">${p.usageUrl ? `default: ${esc(p.usageUrl)}` : 'no default URL'}</td>
  </tr>`).join('');

$('#test').onclick = async () => {
  await save();
  const r = await chrome.runtime.sendMessage({ type: 'testServer' });
  $('#testResult').textContent = r.ok ? 'Connected ✓' : `Not reachable (${r.error || r.status}). Is "npm start" running?`;
};

async function save() {
  const enabled = {}, usageUrls = {};
  document.querySelectorAll('[data-enabled]').forEach((el) => { enabled[el.dataset.enabled] = el.checked; });
  document.querySelectorAll('[data-url]').forEach((el) => { const v = el.value.trim(); if (v) usageUrls[el.dataset.url] = v; });
  const settings = {
    serverUrl: $('#serverUrl').value.trim().replace(/\/$/, '') || 'http://127.0.0.1:7878',
    intervalMin: Math.max(5, Math.min(240, +$('#intervalMin').value || 15)),
    backgroundRefresh: $('#backgroundRefresh').checked,
    refreshMode: $('#refreshMode').value,
    debugCapture: $('#debugCapture').checked,
    enabled,
    usageUrls,
  };
  await chrome.storage.local.set({ settings });
  $('#saved').textContent = 'Saved';
  setTimeout(() => { $('#saved').textContent = ''; }, 1500);
}
$('#save').onclick = save;
