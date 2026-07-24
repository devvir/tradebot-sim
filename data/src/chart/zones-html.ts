import { writeFileSync } from 'fs';

import type { BandPoint, Bin1m } from '@poc/core';

/**
 * Interactive zone viewer: canvas candle chart (1m base, auto-aggregating
 * with zoom) with the precomputed inner/outer bands overlaid and a gate
 * strip. Pan by drag, zoom by wheel (about the cursor), double-click to
 * reset, crosshair tooltip with OHLC + band values. Dark theme, mirroring
 * the services/ui chart look. Self-contained file — no external assets.
 */
export function renderZonesChart(bins: Bin1m[], bands: BandPoint[], outPath: string, title: string): void {
  const candles = bins.map((b) => [b.t, b.open, b.high, b.low, b.close]);
  const bandMap = bands.map((p) => [p.t, p.ib, p.it, p.ob, p.ot, p.g ? 1 : 0]);

  writeFileSync(outPath, page(title, JSON.stringify(candles), JSON.stringify(bandMap)));
}

function page(title: string, candles: string, bands: string): string {
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
  #wrap { position: relative; }
  canvas { display: block; width: 100vw; height: 78vh; cursor: crosshair; }
  #tip { position: fixed; pointer-events: none; background: #16181d; border: 1px solid #2a2e36;
    border-radius: 6px; padding: 6px 9px; font-size: 12px; visibility: hidden; z-index: 5;
    font-variant-numeric: tabular-nums; }
  #tip b { color: #e8e8e8; }
  .legend { padding: 4px 14px 10px; font-size: 12px; color: #8b93a3; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 5px 0 14px; vertical-align: -1px; }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <div class="hint">drag = pan · wheel = zoom (about cursor) · double-click = reset</div>
</header>
<div id="wrap"><canvas id="cv"></canvas><div id="tip"></div></div>
<div class="legend">
  <span class="sw" style="background:rgba(57,135,229,0.35)"></span>outer band
  <span class="sw" style="background:rgba(25,158,112,0.4)"></span>inner band
  <span class="sw" style="background:#0a9b62"></span>gate open (bottom strip)
  <span class="sw" style="background:#4a4f58"></span>gate closed
</div>
<script>
const C = ${candles};   // [t,o,h,l,c] per 1m
const B = ${bands};     // [t,ib,it,ob,ot,gate] per 1m, starts after warmup
const N = C.length;

/** Align band index to candle index: bands start at warmupOffset. */
const warmup = N - B.length;

const cv = document.getElementById('cv');
const tip = document.getElementById('tip');
const ctx = cv.getContext('2d');

let i0 = 0, i1 = N;             // viewport over 1m indexes
let hoverX = null;

const PAD_R = 70, PAD_B = 34, GATE_H = 8;

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

  const span = i1 - i0;
  const bucket = Math.max(1, Math.ceil(span / 220));
  const nb = Math.ceil(span / bucket);
  const cw = plotW / nb;

  /** Price extent over visible candles + bands. */
  let lo = Infinity, hi = -Infinity;
  for (let i = i0; i < i1; i++) {
    if (C[i][3] < lo) lo = C[i][3];
    if (C[i][2] > hi) hi = C[i][2];
    const bi = i - warmup;
    if (bi >= 0 && bi < B.length) { lo = Math.min(lo, B[bi][3]); hi = Math.max(hi, B[bi][4]); }
  }
  const pad = (hi - lo) * 0.04 || 1;
  lo -= pad; hi += pad;
  const y = v => plotH * (1 - (v - lo) / (hi - lo));
  const xOf = i => ((i - i0) / span) * plotW;

  /** Zones: sample bands at bucket steps, draw as filled polygons. */
  function zone(loIdx, hiIdx, fill) {
    ctx.beginPath();
    let started = false;
    for (let i = i0; i < i1; i += bucket) {
      const bi = i - warmup;
      if (bi < 0 || bi >= B.length) continue;
      const x = xOf(i);
      if (! started) { ctx.moveTo(x, y(B[bi][hiIdx])); started = true; }
      else ctx.lineTo(x, y(B[bi][hiIdx]));
    }
    for (let i = i1 - 1; i >= i0; i -= bucket) {
      const bi = i - warmup;
      if (bi < 0 || bi >= B.length) continue;
      ctx.lineTo(xOf(i), y(B[bi][loIdx]));
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  zone(3, 4, 'rgba(57,135,229,0.10)');   // outer
  zone(1, 2, 'rgba(25,158,112,0.14)');   // inner

  /** Grid + price labels. */
  ctx.strokeStyle = '#1d2631'; ctx.fillStyle = '#6b7280'; ctx.textAlign = 'left'; ctx.font = '11px system-ui';
  for (let k = 0; k <= 5; k++) {
    const v = lo + ((hi - lo) * k) / 5;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
    ctx.fillText(v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(1), plotW + 6, yy + 4);
  }

  /** Candles (aggregated to bucket). */
  for (let k = 0; k < nb; k++) {
    const s = i0 + k * bucket, e = Math.min(i1, s + bucket);
    let o = C[s][1], c = C[e - 1][4], h = -Infinity, l = Infinity;
    for (let i = s; i < e; i++) { if (C[i][2] > h) h = C[i][2]; if (C[i][3] < l) l = C[i][3]; }
    const up = c >= o;
    const x = k * cw + cw / 2;
    ctx.strokeStyle = ctx.fillStyle = up ? '#0a9b62' : '#fe3c3c';
    ctx.beginPath(); ctx.moveTo(x, y(h)); ctx.lineTo(x, y(l)); ctx.stroke();
    const bw = Math.max(1, cw * 0.7);
    ctx.fillRect(x - bw / 2, Math.min(y(o), y(c)), bw, Math.max(1, Math.abs(y(o) - y(c))));
  }

  /** Gate strip. */
  for (let k = 0; k < nb; k++) {
    const s = i0 + k * bucket;
    const bi = s - warmup;
    if (bi < 0 || bi >= B.length) continue;
    ctx.fillStyle = B[bi][5] ? '#0a9b62' : '#4a4f58';
    ctx.fillRect(k * cw, plotH + 2, Math.ceil(cw), GATE_H - 2);
  }

  /** Time labels. */
  ctx.fillStyle = '#6b7280'; ctx.textAlign = 'center';
  for (let k = 0; k <= 6; k++) {
    const i = Math.min(N - 1, Math.round(i0 + (span * k) / 6));
    const t = C[i][0];
    ctx.fillText(t.slice(5, 10) + ' ' + t.slice(11, 16), xOf(i), H - 8);
  }

  /** Crosshair. */
  if (hoverX !== null) {
    ctx.strokeStyle = 'rgba(166,173,186,0.4)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(hoverX, 0); ctx.lineTo(hoverX, plotH + GATE_H); ctx.stroke();
    ctx.setLineDash([]);
  }
}

cv.addEventListener('wheel', ev => {
  ev.preventDefault();
  const frac = ev.offsetX / (cv.clientWidth - PAD_R);
  const center = i0 + (i1 - i0) * Math.max(0, Math.min(1, frac));
  const factor = ev.deltaY > 0 ? 1.25 : 0.8;
  let span = Math.max(30, Math.min(N, Math.round((i1 - i0) * factor)));
  i0 = Math.max(0, Math.round(center - span * frac));
  i1 = Math.min(N, i0 + span);
  i0 = Math.max(0, i1 - span);
  draw();
}, { passive: false });

let dragging = null;
cv.addEventListener('mousedown', ev => { dragging = { x: ev.clientX, i0, i1 }; });
window.addEventListener('mouseup', () => { dragging = null; });
window.addEventListener('mousemove', ev => {
  if (dragging) {
    const dx = ev.clientX - dragging.x;
    const span = dragging.i1 - dragging.i0;
    const di = Math.round((-dx / (cv.clientWidth - PAD_R)) * span);
    i0 = Math.max(0, Math.min(N - span, dragging.i0 + di));
    i1 = i0 + span;
    draw();
  }
});
cv.addEventListener('dblclick', () => { i0 = 0; i1 = N; draw(); });

cv.addEventListener('mousemove', ev => {
  hoverX = ev.offsetX;
  const span = i1 - i0;
  const i = Math.max(0, Math.min(N - 1, Math.round(i0 + (ev.offsetX / (cv.clientWidth - PAD_R)) * span)));
  const c = C[i];
  const bi = i - warmup;
  const b = bi >= 0 && bi < B.length ? B[bi] : null;
  tip.style.visibility = 'visible';
  tip.style.left = Math.min(window.innerWidth - 250, ev.clientX + 14) + 'px';
  tip.style.top = (ev.clientY + 12) + 'px';
  const f = v => v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(1);
  tip.innerHTML = '<b>' + c[0].slice(0, 16).replace('T', ' ') + '</b><br>O ' + f(c[1]) + ' H ' + f(c[2]) +
    ' L ' + f(c[3]) + ' C ' + f(c[4]) +
    (b ? '<br>inner ' + f(b[1]) + ' – ' + f(b[2]) + '<br>outer ' + f(b[3]) + ' – ' + f(b[4]) +
      '<br>gate ' + (b[5] ? '<b style="color:#0a9b62">open</b>' : 'closed') : '<br><i>warmup</i>');
  draw();
});
cv.addEventListener('mouseleave', () => { hoverX = null; tip.style.visibility = 'hidden'; draw(); });

resize();
</script>
</body>
</html>
`;
}
