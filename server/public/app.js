const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const tip = $('#tip');

const PACE_LABEL = { ok: 'On pace', ahead: 'Ahead of pace', 'over-pace': 'Will run out before reset', limited: 'Limit reached', unknown: 'Pace unknown' };
const STATUS_COLOR = { ok: 'var(--good)', ahead: 'var(--warning)', 'over-pace': 'var(--serious)', limited: 'var(--critical)', unknown: 'var(--text-muted)' };

let tableView = false;
// ?compact: the menu bar panel's view (single column, no header controls).
const compact = new URLSearchParams(location.search).has('compact');
if (compact) document.documentElement.classList.add('compact');
let data = null;

function dur(ms) {
  if (ms == null) return null;
  const m = Math.max(0, Math.round(ms / 6e4)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
}
function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(undefined, sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function ago(iso) { const m = Math.round((Date.now() - Date.parse(iso)) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; }

function budgetText(m) {
  const p = m.pace;
  // budgetPerDay is only set when ≥24h remain; otherwise show the hourly budget.
  if (p.budgetPerDay != null) return `Budget ${p.budgetPerDay}%/day`;
  if (p.budgetPerHour != null) return `Budget ${p.budgetPerHour}%/h`;
  return null;
}

function meterHtml(m, pi, mi) {
  const pct = m.usedPercent;
  const p = m.pace;
  const reset = p.remainingMs != null ? `Resets in ${dur(p.remainingMs)} · ${when(m.resetsAt)}` : m.resetText || 'Reset time unknown';
  const details = [
    reset,
    budgetText(m),
    p.exhaustAt && p.status === 'over-pace' ? `Runs out ~${when(p.exhaustAt)}` : null,
    p.projectedAtReset != null && p.status !== 'limited' ? `Projected ${Math.round(p.projectedAtReset)}% at reset` : null,
  ].filter(Boolean);
  return `<div class="meter">
    <div class="meter-head">
      <span class="meter-label">${esc(m.label)}</span>
      <span class="meter-value">${pct == null ? '?' : Math.round(pct)}<small>% used</small></span>
    </div>
    <div class="track" role="img" aria-label="${esc(m.label)}: ${pct == null ? 'unknown' : Math.round(pct)}% used${p.expectedPercent != null ? `, even pace would be ${Math.round(p.expectedPercent)}%` : ''}">
      <div class="fill" style="width:${Math.min(100, pct ?? 0)}%;background:${STATUS_COLOR[p.status]}"></div>
      ${p.expectedPercent != null ? `<div class="tick" style="left:calc(${p.expectedPercent}% - 1px)" title="Even pace: ${Math.round(p.expectedPercent)}%"></div>` : ''}
    </div>
    <span class="status"><span class="dot s-${p.status}"></span>${PACE_LABEL[p.status]}${p.expectedPercent != null ? ` (even pace ${Math.round(p.expectedPercent)}%)` : ''}</span>
    <div class="details">${details.map((d) => `<span>${esc(d)}</span>`).join('')}${m.stale ? `<span class="stale">Last read ${ago(m.capturedAt)}</span>` : ''}</div>
    ${m.history.length >= 2 ? `<svg class="spark" data-p="${pi}" data-m="${mi}" aria-hidden="true"></svg>` : ''}
  </div>`;
}

function drawSpark(svg, m) {
  // Match the viewBox to the rendered size (compact mode is shorter) so the line spans the full width.
  const w = svg.clientWidth || 300, h = svg.clientHeight || 36;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const pts = m.history.filter(([, v]) => v != null).map(([t, v]) => [Date.parse(t), v]);
  if (pts.length < 2) return;
  const t0 = pts[0][0], t1 = pts.at(-1)[0] || t0 + 1;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * (w - 4) + 2;
  const y = (v) => h - 2 - (Math.min(100, v) / 100) * (h - 4);
  const d = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join('');
  svg.innerHTML = `<path class="line" d="${d}"/><line class="cross" y1="0" y2="${h}" visibility="hidden"/><circle r="4" visibility="hidden"/>`;
  const cross = svg.querySelector('line'), dot = svg.querySelector('circle');
  svg.onpointermove = (e) => {
    const r = svg.getBoundingClientRect();
    const tx = t0 + ((e.clientX - r.left - 2) / (w - 4)) * (t1 - t0);
    const near = pts.reduce((a, b) => (Math.abs(b[0] - tx) < Math.abs(a[0] - tx) ? b : a));
    cross.setAttribute('x1', x(near[0])); cross.setAttribute('x2', x(near[0])); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(near[0])); dot.setAttribute('cy', y(near[1])); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.textContent = `${Math.round(near[1])}% · ${when(new Date(near[0]).toISOString())}`;
    tip.style.left = `${Math.min(innerWidth - 160, e.clientX + 12)}px`;
    tip.style.top = `${e.clientY - 32}px`;
  };
  svg.onpointerleave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
}

const PROVIDER_LABEL = { claude: 'Claude', cursor: 'Cursor', gemini: 'Gemini', muse: 'Muse' };

function renderNotices() {
  const h = data.headless;
  $('#refreshBtn').hidden = data.headless === null; // null = headless refresh disabled
  if (!h) { $('#notices').innerHTML = ''; return; }
  const entries = Object.entries(h.results || {});
  const names = (list) => {
    const n = list.map(([id]) => `<strong>${esc(PROVIDER_LABEL[id] || id)}</strong>`);
    return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : n[0];
  };
  const login = entries.filter(([, r]) => r.status === 'login');
  const other = entries.filter(([, r]) => r.status !== 'ok' && r.status !== 'login');
  const when = `<span class="muted">(last refresh ${ago(h.at)})</span>`;
  $('#notices').innerHTML = [
    login.length ? `<div class="notice"><span class="dot s-limited"></span><span>${names(login)} ${login.length > 1 ? 'need' : 'needs'} a login. Run <code>npm run browser-login</code> ${when}</span></div>` : '',
    ...other.map(([id, r]) => `<div class="notice"><span class="dot s-over-pace"></span><span>${names([[id]])}: ${esc(r.message || r.status)} ${when}</span></div>`),
  ].join('');
}

function render() {
  if (!data) return;
  renderNotices();
  $('#updated').textContent = `Updated ${when(data.generatedAt)} · refreshes every minute`;
  $('#viewToggle').textContent = tableView ? 'Card view' : 'Table view';
  $('#grid').hidden = tableView;
  $('#table').hidden = !tableView;
  if (!data.providers.length) {
    $('#grid').innerHTML = `<div class="empty"><strong>No usage data yet.</strong><br>Load the extension from <code>extension/</code> in Chrome (chrome://extensions → Developer mode → Load unpacked), then open a usage page such as claude.ai → Settings → Usage, or click “Refresh now” in the extension popup.</div>`;
    return;
  }
  $('#grid').innerHTML = data.providers.map((p, pi) => `<section class="card">
      <h2><span>${esc(p.name)}${p.plan ? ` <span class="meta">${esc(p.plan)}</span>` : ''}</span><span class="meta">${ago(p.lastCapturedAt)}</span></h2>
      ${p.meters.map((m, mi) => meterHtml(m, pi, mi)).join('')}
    </section>`).join('');
  document.querySelectorAll('svg.spark').forEach((svg) => drawSpark(svg, data.providers[svg.dataset.p].meters[svg.dataset.m]));

  $('#table').innerHTML = `<table><thead><tr><th>Provider</th><th>Meter</th><th>Window</th><th>Used</th><th>Even pace</th><th>Status</th><th>Resets</th><th>Budget</th><th>Read</th></tr></thead><tbody>
    ${data.providers.flatMap((p) => p.meters.map((m) => `<tr>
      <td>${esc(p.name)}</td><td>${esc(m.label)}</td><td>${esc(m.window)}</td>
      <td>${m.usedPercent == null ? '?' : Math.round(m.usedPercent) + '%'}</td>
      <td>${m.pace.expectedPercent == null ? '—' : Math.round(m.pace.expectedPercent) + '%'}</td>
      <td>${PACE_LABEL[m.pace.status]}</td>
      <td>${m.resetsAt ? `${when(m.resetsAt)} (${dur(m.pace.remainingMs)})` : esc(m.resetText || '—')}</td>
      <td>${esc(budgetText(m) || '—')}</td><td>${ago(m.capturedAt)}</td></tr>`)).join('')}
  </tbody></table>`;
}

async function load() {
  try {
    const res = await fetch('/api/status');
    data = await res.json();
    render();
  } catch {
    $('#updated').textContent = 'Could not reach the local service.';
  }
}

$('#refreshBtn').onclick = async () => {
  const b = $('#refreshBtn');
  b.disabled = true; b.textContent = 'Refreshing…';
  try { await fetch('/api/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch {}
  b.disabled = false; b.textContent = 'Refresh now';
  load();
};
$('#viewToggle').onclick = () => { tableView = !tableView; render(); };
addEventListener('resize', () => render());
load();
setInterval(load, 60_000);
