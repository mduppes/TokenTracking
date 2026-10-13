const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const tip = $('#tip');

const PACE_LABEL = { ok: 'On pace', ahead: 'Ahead of pace', 'over-pace': 'Will run out before reset', limited: 'Limit reached', unknown: 'Pace unknown' };
const STATUS_COLOR = { ok: 'var(--good)', ahead: 'var(--warning)', 'over-pace': 'var(--serious)', limited: 'var(--critical)', unknown: 'var(--text-muted)' };

const PROVIDER_ICONS = {
  openai: `<svg class="provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.7948.7948 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/></svg>`,
  claude: `<svg class="provider-icon" viewBox="-0.5 -0.5 27 25" aria-hidden="true"><path d="m4.709 15.955 4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 0 1-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/></svg>`,
  cursor: `<svg class="provider-icon" viewBox="-55 -40 577 612" aria-hidden="true"><path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z"/></svg>`,
  muse: `<svg class="provider-icon" viewBox="0 0 100 100" aria-hidden="true"><path d="M24.6257 16.1214C28.2365 16.1214 30.8187 18.9408 30.8187 23.3643C30.8185 27.7868 30.1055 31.7765 28.9225 40.2466C28.0743 46.1813 26.62 55.2418 26.0132 59.0088C27.1782 56.7815 29.9074 51.5757 30.3914 50.5982C36.1081 39.061 42.0657 28.7544 43.7826 26.0254C46.0594 22.382 48.062 20.9229 51.1597 20.9229C52.7685 20.923 54.6826 21.7357 55.6315 22.819C56.9178 24.2895 57.1859 26.6602 57.1411 29.244C57.0738 33.2073 56.5599 39.5264 55.8553 46.5698C55.5416 49.7057 54.9365 56.1066 54.5288 60.4004C58.1883 53.8532 64.9609 41.8109 67.6921 37.6058C70.0727 33.9402 72.466 31.5797 75.6836 31.5796C78.4595 31.5796 81.8809 33.5416 81.6772 38.7573C81.3774 46.4556 80.2673 63.2232 79.7607 70.7479C83.1662 65.7913 87.6377 58.4543 89.3148 55.6966C91.0104 52.908 92.75 50.6542 95.3898 50.5778C98.0987 50.4995 99.913 52.341 99.9959 55.1839C100.078 58.0277 98.3835 61.2256 96.1344 64.856C93.6937 68.7957 90.9621 73.0123 87.6383 76.9491C84.3148 80.8856 81.2604 83.8782 76.5991 83.8786C72.4243 83.8786 69.4869 81.1043 69.283 76.0254C69.1768 73.364 69.6804 67.6405 70.0602 63.1673C70.5 57.9875 71.0315 52.9861 71.403 49.6786C67.7337 56.3979 60.0101 70.4676 56.5348 75.9603C53.1343 81.3339 51.4774 83.2269 47.8882 83.2275C44.2977 83.2275 42.7226 80.6416 42.6717 76.7497C42.6142 72.5285 45.7852 47.1821 46.8587 38.737C45.1183 42.4616 40.839 51.6056 38.1551 57.0435C35.5587 62.3055 31.204 71.3978 28.0436 76.6357C25.7668 80.4094 23.2092 83.2273 19.4173 83.2275C15.6252 83.2275 13.4847 80.6784 13.4847 76.5788C13.4847 72.4794 14.6716 65.6492 15.9465 57.1777C16.5839 53.0781 17.3108 48.6133 18.1315 43.8761C18.7324 40.448 19.7764 34.4169 20.4183 30.7129C17.502 35.2539 12.2536 43.4278 10.6567 45.8903C8.88113 48.6291 7.28747 50.626 4.64681 50.6266C1.7329 50.6266 0.000532901 48.3522 0 45.7113C0 43.0703 1.34323 41.0344 3.52376 37.4512C6.32403 32.8465 11.3578 26.57 14.1154 23.2747C17.3656 19.3912 20.6139 16.1219 24.6257 16.1214Z"/></svg>`,
  'grok-bot': `<svg class="provider-icon" viewBox="45 45 422 422" aria-hidden="true"><path d="M210.484 312.759L343.465 210.383C349.984 205.364 359.302 207.322 362.408 215.117C378.758 256.231 371.454 305.64 338.925 339.563C306.397 373.487 261.137 380.927 219.768 363.983L174.577 385.803C239.394 432.008 318.104 420.581 367.289 369.251C406.303 328.564 418.386 273.104 407.088 223.091L407.19 223.198C390.807 149.726 411.218 120.359 453.03 60.3072C454.02 58.8833 455.01 57.4595 456 56L400.978 113.382V113.204L210.45 312.794M183.042 337.641C136.519 291.294 144.54 219.567 184.236 178.203C213.59 147.59 261.683 135.096 303.666 153.464L348.755 131.75C340.632 125.627 330.221 119.042 318.275 114.414C264.277 91.2407 199.63 102.774 155.735 148.516C113.513 192.549 100.236 260.254 123.036 318.027C140.069 361.206 112.148 391.748 84.0229 422.575C74.0561 433.503 64.0553 444.431 56 456L183.007 337.677"/></svg>`,
  gemini: `<svg class="provider-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.93 4.68-.96 2.19-2.58 3.81t-3.81 2.55Q2.49 12 0 12q2.49 0 4.68.93a12.3 12.3 0 0 1 3.81 2.58 12.3 12.3 0 0 1 2.58 3.81Z"/></svg>`,
  antigravity: `<svg class="provider-icon" viewBox="0 1 24 21" aria-hidden="true"><path d="M3.2 20.2C5 18.5 6.8 15.5 8.2 11.5C9.6 7.5 10.6 2 12 2C13.4 2 14.4 7.5 15.8 11.5C17.2 15.5 19 18.5 20.8 20.2C21.7 20.9 21.2 21.8 20 21.8C18.8 21.8 17.6 20.5 16.5 17.5C15 13.5 13.7 8.5 12 8.5C10.3 8.5 9 13.5 7.5 17.5C6.4 20.5 5.2 21.8 4 21.8C2.8 21.8 2.3 20.9 3.2 20.2Z"/></svg>`,
};

function providerIcon(id, meterId) {
  if (meterId === 'grok-bot') return PROVIDER_ICONS['grok-bot'] || '';
  return PROVIDER_ICONS[id] || '';
}

let tableView = false;
// ?compact: the menu bar panel's view (single column, no header controls).
const compact = new URLSearchParams(location.search).has('compact');
if (compact) document.documentElement.classList.add('compact');
let data = null;
let refreshError = null;

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

/** "Resets next": rows come pre-sorted from the service (status.js withPresentation). */
function renderUpNext() {
  const rows = (data.resetsNext || []).slice(0, compact ? 5 : 8);
  if (!rows.length) { $('#upnext').innerHTML = ''; return; }
  $('#upnext').innerHTML = `<section class="card upnext"><h2>Resets next</h2><div class="upnext-grid">${rows.map((r) => {
    const ms = Date.parse(r.resetsAt) - Date.now();
    return `
    <span class="un-name">${providerIcon(r.provider, r.meterId)}${esc(r.providerName)} · ${esc(r.label)}</span>
    <span class="un-pct s-text-${r.status}">${r.usedPercent == null ? '?' : Math.round(r.usedPercent)}%</span>
    <span class="un-in">${ms <= 0 ? 'reset' : `in ${dur(ms)}`}${r.stale ? ` <span class="stale-tag" title="Last read ${ago(r.capturedAt)}">stale</span>` : ''}</span>
    <span class="un-when">${esc(when(r.resetsAt))}</span>`;
  }).join('')}</div></section>`;
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

/** Notices (stale, needs login, errors) come ready-made from the service (status.js withPresentation). */
function renderNotices() {
  const feedback = $('#refreshFeedback');
  feedback.textContent = refreshError || data.refreshMessage || '';
  feedback.hidden = !feedback.textContent;
  $('#refreshBtn').hidden = data.headless === null; // null = headless refresh disabled
  const dot = { stale: 's-unknown', login: 's-limited', error: 's-over-pace' };
  $('#notices').innerHTML = (data.notices || []).map((n) => `<div class="notice"><span class="dot ${dot[n.kind] || 's-unknown'}"></span><span>${esc(n.text)}</span>${
    n.canLogIn ? ` <button type="button" class="login-btn" data-provider="${esc(n.provider)}">${esc(n.actionLabel || 'Open browser')}</button>` : ''}</div>`).join('');
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
      <h2><span class="provider-title">${providerIcon(p.id)}${esc(p.name)}${p.planLabel ? ` <span class="meta">${esc(p.planLabel)}</span>` : ''}</span>${p.lastCapturedAt ? `<span class="meta">${ago(p.lastCapturedAt)}</span>` : ''}</h2>
      ${p.meters.length ? p.meters.map((m, mi) => meterHtml(m, pi, mi)).join('') : `<div class="provider-empty"><p>${esc(p.emptyText)}</p><div>${p.canOpenBrowser ? `<button type="button" class="login-btn" data-provider="${esc(p.id)}">${esc(p.actionLabel)}</button>` : ''}</div></div>`}
    </section>`).join('');
  document.querySelectorAll('svg.spark').forEach((svg) => drawSpark(svg, data.providers[svg.dataset.p].meters[svg.dataset.m]));

  $('#table').innerHTML = `<table><thead><tr><th>Provider</th><th>Meter</th><th>Window</th><th>Used</th><th>Even pace</th><th>Status</th><th>Resets</th><th>Budget</th><th>Read</th></tr></thead><tbody>
    ${data.providers.flatMap((p) => p.meters.length ? p.meters.map((m) => `<tr>
      <td><span class="provider-title">${providerIcon(p.id)}${esc(p.name)}</span></td><td>${esc(m.label)}</td><td>${esc(m.window)}</td>
      <td>${m.usedPercent == null ? '?' : Math.round(m.usedPercent) + '%'}</td>
      <td>${m.pace.expectedPercent == null ? '—' : Math.round(m.pace.expectedPercent) + '%'}</td>
      <td>${PACE_LABEL[m.pace.status]}</td>
      <td>${m.resetsAt ? `${when(m.resetsAt)} (${dur(m.pace.remainingMs)})` : esc(m.resetText || '—')}</td>
      <td>${esc(budgetText(m) || '—')}</td><td>${ago(m.capturedAt)}</td></tr>`) : [`<tr><td><span class="provider-title">${providerIcon(p.id)}${esc(p.name)}</span></td><td colspan="8">${esc(p.emptyText)} ${p.canOpenBrowser ? `<button type="button" class="login-btn" data-provider="${esc(p.id)}">${esc(p.actionLabel)}</button>` : ''}</td></tr>`]).join('')}
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
  refreshError = null;
  try {
    const r = await fetch('/api/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new Error(`The service returned HTTP ${r.status}.`);
    const run = await r.json();
    if (run.error) throw new Error(run.error);
  } catch (e) { refreshError = `Refresh failed: ${e.message}`; }
  finally { b.disabled = false; b.textContent = 'Refresh now'; }
  await load();
  if (refreshError) { $('#refreshFeedback').textContent = refreshError; $('#refreshFeedback').hidden = false; }
};
// Open the dedicated browser session so the user can inspect it and log in if needed.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.login-btn');
  if (!btn) return;
  btn.disabled = true;
  const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: btn.dataset.provider }) }).catch(() => null);
  const r = res ? await res.json().catch(() => ({})) : { reason: 'service unreachable' };
  btn.disabled = false;
  btn.parentElement.querySelector('.login-hint')?.remove();
  btn.after(Object.assign(document.createElement('span'), {
    className: 'login-hint',
    textContent: r.ok ? 'Browser opened: check your login, then quit it (⌘Q). It refreshes automatically.' : r.reason || 'Could not open the browser.',
  }));
});
$('#viewToggle').onclick = () => { tableView = !tableView; render(); };
addEventListener('resize', () => render());
load();
setInterval(load, 60_000);
