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

/** Countdown pill: the most prominent thing on a meter is when it frees up (option A). */
function resetPill(m) {
  const p = m.pace;
  if (p.remainingMs == null) return `<span class="pill pill-unknown" title="${esc(m.resetText || 'Reset time unknown')}"><span aria-hidden="true">↻</span> ?</span>`;
  return `<span class="pill pill-${p.status}" title="Resets ${esc(when(m.resetsAt))}"><span aria-hidden="true">↻</span> ${p.remainingMs <= 0 ? 'reset' : dur(p.remainingMs)}</span>`;
}

function meterHtml(m, pi, mi) {
  const pct = m.usedPercent;
  const p = m.pace;
  const details = [
    budgetText(m),
    p.exhaustAt && p.status === 'over-pace' ? `Runs out ~${when(p.exhaustAt)}` : null,
    p.projectedAtReset != null && p.status !== 'limited' ? `Projected ${Math.round(p.projectedAtReset)}% at reset` : null,
  ].filter(Boolean);
  return `<div class="meter">
    <div class="meter-head">
      <span class="meter-label">${esc(m.label)}</span>
      ${resetPill(m)}
    </div>
    <div class="track" role="img" aria-label="${esc(m.label)}: ${pct == null ? 'unknown' : Math.round(pct)}% used${p.expectedPercent != null ? `, even pace would be ${Math.round(p.expectedPercent)}%` : ''}">
      <div class="fill" style="width:${Math.min(100, pct ?? 0)}%;background:${STATUS_COLOR[p.status]}"></div>
      ${p.expectedPercent != null ? `<div class="tick" style="left:calc(${p.expectedPercent}% - 1px)" title="Even pace: ${Math.round(p.expectedPercent)}%"></div>` : ''}
    </div>
    <div class="meter-sub">
      <span class="status"><span class="meter-value">${pct == null ? '?' : Math.round(pct)}<small>% used</small></span><span class="dot s-${p.status}"></span>${PACE_LABEL[p.status]}${p.expectedPercent != null ? ` · even pace ${Math.round(p.expectedPercent)}%` : ''}</span>
    </div>
    <div class="details">${details.map((d) => `<span>${esc(d)}</span>`).join('')}${m.stale ? `<span class="stale">Last read ${ago(m.capturedAt)}</span>` : ''}</div>
    ${m.history.length >= 2 ? `<svg class="spark" data-p="${pi}" data-m="${mi}" aria-hidden="true"></svg>` : ''}
  </div>`;
}

/** "Resets next" list across all services, soonest first (option B). */
function renderUpNext() {
  const rows = data.providers.flatMap((p) => p.meters.map((m) => ({ p, m })))
    .filter(({ m }) => m.pace.remainingMs != null)
    .sort((a, b) => a.m.pace.remainingMs - b.m.pace.remainingMs)
    .slice(0, compact ? 5 : 8);
  if (!rows.length) { $('#upnext').innerHTML = ''; return; }
  $('#upnext').innerHTML = `<section class="card upnext"><h2>Resets next</h2><div class="upnext-grid">${rows.map(({ p, m }) => `
    <span class="un-name">${esc(p.name)} · ${esc(m.label)}</span>
    <span class="un-pct s-text-${m.pace.status}">${m.usedPercent == null ? '?' : Math.round(m.usedPercent)}%</span>
    <span class="un-in">${m.pace.remainingMs <= 0 ? 'reset' : `in ${dur(m.pace.remainingMs)}`}${m.stale ? ' <span class="stale-tag" title="Last read ' + ago(m.capturedAt) + '">stale</span>' : ''}</span>
    <span class="un-when">${esc(when(m.resetsAt))}</span>`).join('')}</div></section>`;
}

/** Header: when the data was last read and when the next background refresh runs. */
function freshnessText() {
  const latest = data.providers.map((p) => p.lastCapturedAt).filter(Boolean).sort().at(-1);
  const parts = [latest ? `Updated ${ago(latest)}` : 'No data yet'];
  const next = data.headless?.nextAt;
  if (next) parts.push(Date.parse(next) <= Date.now() ? 'refreshing…' : `next refresh in ${dur(Date.parse(next) - Date.now())}`);
  return parts.join(' · ');
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

/** Providers that use the TokenTracking browser profile (POST /api/login opens a login window). */
const LOGIN_PROVIDERS = new Set(['claude', 'cursor', 'gemini', 'muse']);

const PROVIDER_LABEL = { claude: 'Claude', cursor: 'Cursor', gemini: 'Gemini', muse: 'Muse', antigravity: 'Antigravity' };

/** "claude_max" → "Max", "pro" → "Pro" */
const planLabel = (plan) => String(plan).replace(/^claude_/i, '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function renderNotices() {
  const h = data.headless || {};
  $('#refreshBtn').hidden = data.headless === null; // null = headless refresh disabled
  const results = h.results || {};
  const names = (ids) => {
    const n = ids.map((id) => `<strong>${esc(PROVIDER_LABEL[id] || id)}</strong>`);
    return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : n[0];
  };
  const reason = (r) => (r.status === 'login' ? 'needs a login' : r.message || r.status);
  const loginBtn = (id) => (LOGIN_PROVIDERS.has(id) ? ` <button type="button" class="login-btn" data-provider="${esc(id)}">Log in</button>` : '');

  // 1. Stale services: readings older than ~2 missed refreshes, with the last refresh's reason.
  const stale = data.providers.filter((p) => p.meters.some((m) => m.stale));
  const staleIds = new Set(stale.map((p) => p.id));
  const staleNotes = stale.map((p) => {
    const oldest = p.meters.filter((m) => m.stale).map((m) => m.capturedAt).sort()[0];
    const r = results[p.id];
    const why = r && r.status !== 'ok' ? ` · last refresh: ${esc(reason(r))}` : '';
    return `<div class="notice"><span class="dot s-unknown"></span><span>${names([p.id])} is stale: last read ${ago(oldest)}${why}</span>${loginBtn(p.id)}</div>`;
  });

  // 2. Refresh problems for services that aren't already listed as stale.
  const entries = Object.entries(results).filter(([id]) => !staleIds.has(id));
  const login = entries.filter(([, r]) => r.status === 'login').map(([id]) => id);
  const other = entries.filter(([, r]) => r.status !== 'ok' && r.status !== 'login' && r.status !== 'skipped');
  const when = h.at ? ` <span class="muted">(last refresh ${ago(h.at)})</span>` : '';
  $('#notices').innerHTML = [
    ...staleNotes,
    ...login.map((id) => `<div class="notice"><span class="dot s-limited"></span><span>${names([id])} needs a login${when}</span>${loginBtn(id)}</div>`),
    ...other.map(([id, r]) => `<div class="notice"><span class="dot s-over-pace"></span><span>${names([id])}: ${esc(reason(r))}${when}</span></div>`),
  ].join('');
}

function render() {
  if (!data) return;
  renderNotices();
  $('#updated').textContent = freshnessText();
  renderUpNext();
  $('#viewToggle').textContent = tableView ? 'Card view' : 'Table view';
  $('#grid').hidden = tableView;
  $('#table').hidden = !tableView;
  if (!data.providers.length) {
    $('#grid').innerHTML = `<div class="empty"><strong>No usage data yet.</strong><br>Log in once with <code>npm run browser-login</code> (then quit that Chrome window), and click “Refresh now”.</div>`;
    return;
  }
  $('#grid').innerHTML = data.providers.map((p, pi) => `<section class="card">
      <h2><span>${esc(p.name)}${p.plan ? ` <span class="meta">${esc(planLabel(p.plan))}</span>` : ''}</span><span class="meta">${ago(p.lastCapturedAt)}</span></h2>
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
// "Log in" buttons in notices: open the TokenTracking browser on that provider's login page.
$('#notices').addEventListener('click', async (e) => {
  const btn = e.target.closest('.login-btn');
  if (!btn) return;
  btn.disabled = true;
  const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: btn.dataset.provider }) }).catch(() => null);
  const r = res ? await res.json().catch(() => ({})) : { reason: 'service unreachable' };
  btn.replaceWith(Object.assign(document.createElement('span'), {
    className: 'login-hint',
    textContent: r.ok ? 'Login window opened: log in, then quit it (⌘Q). It refreshes automatically.' : r.reason || 'Could not open the login window.',
  }));
});
$('#viewToggle').onclick = () => { tableView = !tableView; render(); };
addEventListener('resize', () => render());
load();
setInterval(load, 60_000);
