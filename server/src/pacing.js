// Pacing math: given the latest reading of a meter and its recent history,
// work out where you "should" be, how fast you're burning, and when you'd run out.

export const WINDOW_HOURS = { session: 5, daily: 24, weekly: 168, monthly: 730 };
const H = 36e5;

/**
 * @param {{usedPercent:number|null, resetsAt:string|null, window:string, capturedAt:string}} latest
 * @param {{usedPercent:number|null, capturedAt:string, resetsAt:string|null}[]} history  oldest → newest
 * @param {Date} now
 */
export function computePace(latest, history = [], now = new Date()) {
  const used = latest.usedPercent;
  const out = {
    status: 'unknown', expectedPercent: null, ratePerHour: null, projectedAtReset: null,
    exhaustAt: null, remainingMs: null, budgetPerHour: null, budgetPerDay: null, windowHours: WINDOW_HOURS[latest.window] ?? null,
  };
  if (used == null) return out;
  if (used >= 100) out.status = 'limited';

  const resetMs = latest.resetsAt ? Date.parse(latest.resetsAt) : NaN;
  const t = now.getTime();
  const winMs = out.windowHours ? out.windowHours * H : null;

  if (Number.isFinite(resetMs)) {
    out.remainingMs = Math.max(0, resetMs - t);
    if (winMs) {
      const start = resetMs - winMs;
      out.expectedPercent = round(clamp(((t - start) / winMs) * 100, 0, 100));
    }
  }

  // Burn rate: prefer observed slope within the current window, else average since window start.
  const inWindow = history.filter((h) => h.usedPercent != null && sameWindow(h, latest, winMs));
  if (inWindow.length >= 2) {
    const a = inWindow[0], b = inWindow.at(-1);
    const dt = (Date.parse(b.capturedAt) - Date.parse(a.capturedAt)) / H;
    // Need a span of ≥5% of the window (and ≥10 min): a burst right after a reset shouldn't be
    // extrapolated over the whole window (it flagged a 3% session as "will run out").
    const minSpan = Math.max(1 / 6, (out.windowHours || 0) * 0.05);
    if (dt >= minSpan) out.ratePerHour = round(Math.max(0, (b.usedPercent - a.usedPercent) / dt), 3);
  }
  if (out.ratePerHour == null && out.expectedPercent != null && winMs) {
    const elapsedH = (out.expectedPercent / 100) * (winMs / H);
    if (elapsedH > 0.05) out.ratePerHour = round(used / elapsedH, 3);
  }

  if (out.remainingMs != null) {
    const remH = out.remainingMs / H;
    const left = Math.max(0, 100 - used);
    out.budgetPerHour = remH > 0 ? round(left / remH) : null;
    out.budgetPerDay = remH >= 24 ? round(left / (remH / 24)) : null;
    if (out.ratePerHour != null) out.projectedAtReset = round(used + out.ratePerHour * remH);
  }
  if (out.ratePerHour > 0 && used < 100) {
    out.exhaustAt = new Date(t + ((100 - used) / out.ratePerHour) * H).toISOString();
  }

  if (out.status !== 'limited') {
    if (out.exhaustAt && used >= 5 && Number.isFinite(resetMs) && Date.parse(out.exhaustAt) < resetMs) out.status = 'over-pace';
    else if (out.expectedPercent != null && used > out.expectedPercent + 10) out.status = 'ahead';
    else if (out.expectedPercent != null || out.ratePerHour != null) out.status = 'ok';
  }
  return out;
}

function sameWindow(h, latest, winMs) {
  if (h.resetsAt && latest.resetsAt) return Math.abs(Date.parse(h.resetsAt) - Date.parse(latest.resetsAt)) < 10 * 6e4;
  if (winMs && latest.resetsAt) return Date.parse(h.capturedAt) >= Date.parse(latest.resetsAt) - winMs;
  return true;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n;
