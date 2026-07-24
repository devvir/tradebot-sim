/**
 * The served zone-viewer page: same interaction model as the static zones
 * chart (drag pan, wheel zoom about cursor, double-click reset, crosshair
 * tooltip) but the viewport is a time range and every move fetches an
 * aggregated slice from the local server. Rows: [t,o,h,l,c,ib,it,ob,ot,g]
 * (g = −1 during warmup).
 */
export function zonesViewerPage(title: string, tMin: number, tMax: number): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; background: #0d0d0d; color: #a6adba; font: 13px/1.4 system-ui, sans-serif; }
  header { padding: 10px 14px 6px; }
  h1 { font-size: 15px; margin: 0; color: #e8e8e8; }
  .hint { font-size: 12px; color: #6b7280; }
  canvas { display: block; width: 100vw; height: 80vh; cursor: crosshair; }
  #tip { position: fixed; pointer-events: none; background: #16181d; border: 1px solid #2a2e36;
    border-radius: 6px; padding: 6px 9px; font-size: 12px; visibility: hidden; z-index: 5;
    font-variant-numeric: tabular-nums; }
  #tip b { color: #e8e8e8; }
  .legend { padding: 4px 14px 10px; font-size: 12px; color: #8b93a3; }
  button { background: #16181d; color: #a6adba; border: 1px solid #2a2e36; border-radius: 4px; font: 11px system-ui; padding: 2px 8px; cursor: pointer; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 5px 0 14px; vertical-align: -1px; }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <div class="hint">drag / two-finger sideways = pan · wheel up-down = zoom (about cursor) · double-click = full period · <button id="scaleBtn">scale: log</button></div>
</header>
<canvas id="cv"></canvas><div id="tip"></div>
<div class="legend">
  <span class="sw" style="background:rgba(25,158,112,0.5)"></span>trading (open, inside inner)
  <span class="sw" style="background:rgba(180,175,60,0.5)"></span>waiting (open, between bands)
  <span class="sw" style="background:rgba(230,140,30,0.5)"></span>storm/recovery (open, beyond outer)
  <span class="sw" style="background:rgba(205,85,55,0.5)"></span>gate closed
  <span class="sw" style="background:#2a2e36"></span>warmup
</div>
<script>
const T_MIN = ${tMin}, T_MAX = ${tMax};
const cv = document.getElementById('cv');
const tip = document.getElementById('tip');
const ctx = cv.getContext('2d');
const PAD_R = 70, PAD_B = 34, GATE_H = 8;

let v0 = T_MIN, v1 = T_MAX;
let logScale = true;
let rows = [];
let hoverX = null;
let hoverY = null;
const stateOfRow = r => {
  if (r[9] <= 0) return r[9];
  const c = r[4];
  if (c >= r[5] && c <= r[6]) return 1;
  if (c >= r[7] && c <= r[8]) return 2;
  return 3;
};
let fetchTimer = null;
let fetchSeq = 0;

function scheduleFetch() {
  clearTimeout(fetchTimer);
  fetchTimer = setTimeout(fetchSlice, 60);
}

async function fetchSlice() {
  const seq = ++fetchSeq;
  const res = await fetch('/slice?from=' + Math.floor(v0) + '&to=' + Math.ceil(v1) + '&n=260');
  const data = await res.json();

  if (seq === fetchSeq) { rows = data; draw(); }
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  cv.width = cv.clientWidth * dpr;
  cv.height = cv.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
window.addEventListener('resize', resize);

function draw() {
  const W = cv.clientWidth, H = cv.clientHeight;
  const plotW = W - PAD_R, plotH = H - PAD_B - GATE_H;

  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, W, H);
  if (rows.length === 0) return;

  let lo = Infinity, hi = -Infinity;
  for (const r of rows) {
    if (r[3] < lo) lo = r[3];
    if (r[2] > hi) hi = r[2];
    if (r[9] >= 0) { lo = Math.min(lo, r[7]); hi = Math.max(hi, r[8]); }
  }
  const pad = (hi - lo) * 0.04 || 1;
  lo -= pad; hi += pad;
  if (logScale && lo <= 0) lo = Math.min(hi / 2, 0.01);
  const T = v => logScale ? Math.log(v) : v;
  const Tlo = T(lo), Thi = T(hi);
  const y = v => plotH * (1 - (T(v) - Tlo) / (Thi - Tlo));
  const yInv = yy => { const t = Tlo + (1 - yy / plotH) * (Thi - Tlo); return logScale ? Math.exp(t) : t; };
  const x = t => ((t - v0) / (v1 - v0)) * plotW;

  /**
   * Zones tinted by gate state: green-family when open, red/brown when
   * closed — the bands themselves show when trading would happen. Drawn
   * per contiguous same-state run (overlapping one point to avoid seams).
   */
  /** Visual state: 1 trading · 2 waiting (between bands) · 3 storm/recovery (beyond outer) · 0 gate closed. */
  const stateOf = r => {
    if (r[9] < 0) return -1;
    if (r[9] === 0) return 0;
    const c = r[4];
    if (c >= r[5] && c <= r[6]) return 1;
    if (c >= r[7] && c <= r[8]) return 2;
    return 3;
  };
  const ZONE_COLORS = {
    1: { outer: 'rgba(57,135,229,0.10)',  inner: 'rgba(25,158,112,0.16)' },
    2: { outer: 'rgba(57,135,229,0.08)',  inner: 'rgba(180,175,60,0.13)' },
    3: { outer: 'rgba(230,140,30,0.13)',  inner: 'rgba(230,140,30,0.10)' },
    0: { outer: 'rgba(205,85,55,0.09)',   inner: 'rgba(205,85,55,0.17)' },
  };

  function fillRun(run, loI, hiI, fill) {
    if (run.length < 2) return;
    ctx.beginPath();
    run.forEach((r, k) => {
      const xx = x(r[0]);
      if (k === 0) ctx.moveTo(xx, y(r[hiI])); else ctx.lineTo(xx, y(r[hiI]));
    });
    for (let k = run.length - 1; k >= 0; k--) ctx.lineTo(x(run[k][0]), y(run[k][loI]));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  {
    let run = [], state = null;
    const flush = () => {
      if (state !== null && ZONE_COLORS[state]) {
        fillRun(run, 7, 8, ZONE_COLORS[state].outer);
        fillRun(run, 5, 6, ZONE_COLORS[state].inner);
      }
    };
    for (const r of rows) {
      const s = stateOf(r);
      if (s !== state) {
        if (run.length) run.push(r);   /** overlap one point to avoid seams */
        flush();
        run = [r];
        state = s;
      } else {
        run.push(r);
      }
    }
    flush();
  }

  ctx.strokeStyle = '#1d2631'; ctx.fillStyle = '#6b7280'; ctx.textAlign = 'left'; ctx.font = '11px system-ui';
  for (let k = 0; k <= 5; k++) {
    const v = yInv(plotH * (1 - k / 5));
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
    ctx.fillText(v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(1), plotW + 6, yy + 4);
  }

  const cw = plotW / rows.length;
  rows.forEach((r, k) => {
    const up = r[4] >= r[1];
    const xx = x(r[0]) + cw / 2;
    ctx.strokeStyle = ctx.fillStyle = up ? '#0a9b62' : '#fe3c3c';
    ctx.beginPath(); ctx.moveTo(xx, y(r[2])); ctx.lineTo(xx, y(r[3])); ctx.stroke();
    const bw = Math.max(1, cw * 0.7);
    ctx.fillRect(xx - bw / 2, Math.min(y(r[1]), y(r[4])), bw, Math.max(1, Math.abs(y(r[1]) - y(r[4]))));

    const st = stateOf(r);
    ctx.fillStyle = st < 0 ? '#2a2e36' : st === 1 ? '#0a9b62' : st === 2 ? '#8a8433' : st === 3 ? '#c07820' : '#4a4f58';
    ctx.fillRect(x(r[0]), plotH + 2, Math.ceil(cw), GATE_H - 2);
  });

  ctx.fillStyle = '#6b7280'; ctx.textAlign = 'center';
  for (let k = 0; k <= 6; k++) {
    const t = v0 + ((v1 - v0) * k) / 6;
    const d = new Date(t).toISOString();
    const label = (v1 - v0) > 90 * 864e5 ? d.slice(0, 10) : d.slice(5, 16).replace('T', ' ');
    ctx.fillText(label, (plotW * k) / 6, H - 8);
  }

  if (hoverX !== null) {
    ctx.strokeStyle = 'rgba(166,173,186,0.4)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(hoverX, 0); ctx.lineTo(hoverX, plotH + GATE_H); ctx.stroke();

    /** Horizontal price line + right-axis price label. */
    if (hoverY !== null && hoverY <= plotH) {
      ctx.beginPath(); ctx.moveTo(0, hoverY); ctx.lineTo(plotW, hoverY); ctx.stroke();
      ctx.setLineDash([]);
      const pv = yInv(hoverY);
      ctx.fillStyle = '#16181d';
      ctx.fillRect(plotW + 2, hoverY - 9, PAD_R - 4, 18);
      ctx.strokeStyle = '#2a2e36';
      ctx.strokeRect(plotW + 2, hoverY - 9, PAD_R - 4, 18);
      ctx.fillStyle = '#e8e8e8'; ctx.textAlign = 'left'; ctx.font = '11px system-ui';
      ctx.fillText(pv >= 1000 ? Math.round(pv).toLocaleString() : pv.toFixed(1), plotW + 6, hoverY + 4);
    }

    ctx.setLineDash([]);
  }
}

cv.addEventListener('wheel', ev => {
  ev.preventDefault();

  if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
    const span = v1 - v0;
    const dt = (ev.deltaX / (cv.clientWidth - PAD_R)) * span;
    v0 = Math.max(T_MIN, Math.min(T_MAX - span, v0 + dt));
    v1 = v0 + span;
    draw();
    scheduleFetch();
    return;
  }

  const frac = Math.max(0, Math.min(1, ev.offsetX / (cv.clientWidth - PAD_R)));
  const center = v0 + (v1 - v0) * frac;
  const factor = ev.deltaY > 0 ? 1.3 : 0.75;
  let span = Math.max(30 * 60e3, Math.min(T_MAX - T_MIN, (v1 - v0) * factor));
  v0 = Math.max(T_MIN, center - span * frac);
  v1 = Math.min(T_MAX, v0 + span);
  v0 = Math.max(T_MIN, v1 - span);
  draw();
  scheduleFetch();
}, { passive: false });

let dragging = null;
cv.addEventListener('mousedown', ev => { dragging = { x: ev.clientX, v0, v1 }; });
window.addEventListener('mouseup', () => { dragging = null; });
window.addEventListener('mousemove', ev => {
  if (dragging) {
    const dt = ((dragging.x - ev.clientX) / (cv.clientWidth - PAD_R)) * (dragging.v1 - dragging.v0);
    const span = dragging.v1 - dragging.v0;
    v0 = Math.max(T_MIN, Math.min(T_MAX - span, dragging.v0 + dt));
    v1 = v0 + span;
    draw();
    scheduleFetch();
  }
});
cv.addEventListener('dblclick', () => { v0 = T_MIN; v1 = T_MAX; draw(); scheduleFetch(); });

cv.addEventListener('mousemove', ev => {
  hoverX = ev.offsetX;
  hoverY = ev.offsetY;
  if (rows.length) {
    const t = v0 + (ev.offsetX / (cv.clientWidth - PAD_R)) * (v1 - v0);
    let best = rows[0];
    for (const r of rows) if (Math.abs(r[0] - t) < Math.abs(best[0] - t)) best = r;
    const f = v => v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(1);
    tip.style.visibility = 'visible';
    tip.style.left = Math.min(window.innerWidth - 250, ev.clientX + 14) + 'px';
    tip.style.top = (ev.clientY + 12) + 'px';
    tip.innerHTML = '<b>' + new Date(best[0]).toISOString().slice(0, 16).replace('T', ' ') + '</b><br>O ' +
      f(best[1]) + ' H ' + f(best[2]) + ' L ' + f(best[3]) + ' C ' + f(best[4]) +
      (best[9] >= 0 ? '<br>inner ' + f(best[5]) + ' – ' + f(best[6]) + '<br>outer ' + f(best[7]) + ' – ' + f(best[8]) +
        '<br>gate ' + (best[9] ? '<b style="color:#0a9b62">open</b>' + [' · trading', ' · waiting', ' · <b style="color:#c07820">storm/recovery</b>'][stateOfRow(best) - 1] : 'closed' + (best[10] ? ' (' + best[10] + ')' : '')) : '<br><i>warmup</i>');
  }
  draw();
});
cv.addEventListener('mouseleave', () => { hoverX = null; hoverY = null; tip.style.visibility = 'hidden'; draw(); });

document.getElementById('scaleBtn').addEventListener('click', ev => {
  logScale = ! logScale;
  ev.target.textContent = 'scale: ' + (logScale ? 'log' : 'linear');
  draw();
});

resize();
fetchSlice();
</script>
</body>
</html>
`;
}
