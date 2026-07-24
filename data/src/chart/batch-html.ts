import { writeFileSync } from 'fs';

import type { BatchMonth } from '@poc/core';

/**
 * Batch overview page: stat tiles + a diverging final-balance-per-month
 * chart (bird's eye), then one panel per year with the 12 monthly mBTC
 * equity curves (hover to identify; identity never rides on hue alone —
 * 12 series fold to a single muted hue by design, per palette caps).
 * Native BTC units throughout — no USD.
 */
export function renderBatchChart(months: BatchMonth[], outPath: string, title: string, initialBtc: number): void {
  writeFileSync(outPath, page(title, months, initialBtc));
}

function page(title: string, months: BatchMonth[], initialBtc: number): string {
  const data = JSON.stringify(
    months.map((m) => ({
      ...m,
      /** Downsample long series for page weight: every 2nd point past 1k. */
      equityMBtcSeries:
        m.equityMBtcSeries.length > 1000
          ? m.equityMBtcSeries.filter((_, i) => i % 2 === 0)
          : m.equityMBtcSeries,
    })),
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  .viz-root {
    color-scheme: light;
    --surface-1: #fcfcfb; --page: #f9f9f7;
    --ink-1: #0b0b0b; --ink-2: #52514e; --muted: #898781;
    --grid: #e1e0d9; --axis: #c3c2b7; --ring: rgba(11,11,11,0.10);
    --pos: #2a78d6; --neg: #e34948; --line: #2a78d6;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .viz-root {
      color-scheme: dark;
      --surface-1: #1a1a19; --page: #0d0d0d;
      --ink-1: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
      --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
      --pos: #3987e5; --neg: #e66767; --line: #3987e5;
    }
  }
  :root[data-theme="dark"] .viz-root {
    color-scheme: dark;
    --surface-1: #1a1a19; --page: #0d0d0d;
    --ink-1: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
    --pos: #3987e5; --neg: #e66767; --line: #3987e5;
  }
  body { margin: 0; background: var(--page); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .viz-root { color: var(--ink-1); max-width: 1240px; margin: 0 auto; padding: 20px 16px 60px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: var(--ink-2); margin: 0 0 16px; font-size: 13px; }
  .tiles { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .tile { background: var(--surface-1); border: 1px solid var(--ring); border-radius: 8px; padding: 10px 16px; min-width: 120px; }
  .tile .v { font-size: 20px; font-weight: 650; }
  .tile .l { font-size: 12px; color: var(--ink-2); }
  .panel { background: var(--surface-1); border: 1px solid var(--ring); border-radius: 8px; padding: 12px 14px 6px; margin-bottom: 14px; }
  .panel h2 { font-size: 13px; font-weight: 600; margin: 0 0 6px; }
  .legend { font-size: 12px; color: var(--ink-2); margin-bottom: 4px; }
  .legend .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
  .chartwrap { overflow-x: auto; }
  svg { display: block; }
  .gridline { stroke: var(--grid); stroke-width: 1; }
  .baseline { stroke: var(--axis); stroke-width: 1.2; }
  .ticktext { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .mline { stroke-width: 1.6; fill: none; opacity: 0.55; }
  .mline.hot { opacity: 1; stroke-width: 2.4; }
  #tooltip { position: fixed; pointer-events: none; background: var(--surface-1); color: var(--ink-1);
    border: 1px solid var(--ring); border-radius: 6px; padding: 7px 10px; font-size: 12px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.15); visibility: hidden; z-index: 10; }
  details { margin-top: 18px; color: var(--ink-2); }
  details table { border-collapse: collapse; font-size: 12px; margin-top: 8px; font-variant-numeric: tabular-nums; }
  details th, details td { border-bottom: 1px solid var(--grid); padding: 3px 10px 3px 0; text-align: right; }
  details th:first-child, details td:first-child { text-align: left; }
</style>
</head>
<body>
<div class="viz-root">
  <h1>${title}</h1>
  <p class="sub">Each month restarts from scratch (fresh ${1000 * initialBtc} mBTC, no positions). No recovery: the first freeze ends the month's trading.
  All values are native BTC units (mBTC) — no USD anywhere, so bitcoin's own price drift adds no noise.</p>
  <div class="tiles" id="tiles"></div>
  <div id="panels"></div>
  <div id="tooltip"></div>
  <details><summary>Data table (all months)</summary><div id="tablewrap"></div></details>
</div>
<script>
const M = ${data};
const INIT_MBTC = ${1000 * initialBtc};
const W = 1180, PL = 64, PR = 30;
const LINE_COLORS = ['#3987e5','#00a352','#d55181','#c98500','#199e70','#d95926','#9085e9','#e66767','#2ab7ca','#a0a537','#c17ad6','#8d9aa8'];

const pct = v => ((v - 1) * 100).toFixed(2) + '%';
const mb = v => v.toFixed(3);
const sorted = [...M].sort((a, b) => a.finalXbtPct - b.finalXbtPct);
const med = sorted[Math.floor(sorted.length / 2)];
const avg = M.reduce((s, m) => s + m.finalXbtPct, 0) / M.length;
const pos = M.filter(m => m.finalXbtPct > 1).length;
const frozen = M.filter(m => m.frozeAt).length;
const busted = M.filter(m => m.bustedAt).length;

const tiles = [
  ['months', M.length],
  ['avg (XBT%)', pct(avg)],
  ['median (XBT%)', pct(med.finalXbtPct)],
  ['best (XBT%)', pct(sorted[sorted.length - 1].finalXbtPct) + ' · ' + sorted[sorted.length - 1].month],
  ['worst (XBT%)', pct(sorted[0].finalXbtPct) + ' · ' + sorted[0].month],
  ['months green', pos + ' / ' + M.length],
  ['froze / busted', frozen + ' / ' + busted],
];

const gaps = M.filter(m => Number.isFinite(m.gapAtFreeze)).map(m => m.gapAtFreeze).sort((a, b) => a - b);

if (gaps.length) {
  const gq = f => (gaps[Math.floor(f * (gaps.length - 1))] * 100).toFixed(3) + '%';
  tiles.push(['gap at freeze (median)', gq(0.5)], ['gap at freeze (p90)', gq(0.9)]);
}
document.getElementById('tiles').innerHTML =
  tiles.map(([l, v]) => '<div class="tile"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>').join('');

const container = document.getElementById('panels');
const tooltip = document.getElementById('tooltip');

/** Bird's eye: diverging bars of final XBT% per month. */
{
  const H = 200;
  const vals = M.map(m => m.finalXbtPct - 1);
  const extent = Math.max(1e-9, ...vals.map(Math.abs)) * 1.08;
  const y = v => 10 + (H - 20) * (1 - (v + extent) / (2 * extent));
  const bw = Math.max(2, (W - PL - PR) / M.length - 2);
  const x = i => PL + (W - PL - PR) * (i + 0.5) / M.length;

  let g = '';
  for (const t of [-extent, -extent / 2, 0, extent / 2, extent]) {
    g += '<line class="' + (t === 0 ? 'baseline' : 'gridline') + '" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '"/>' +
         '<text class="ticktext" x="' + (PL - 8) + '" y="' + (y(t) + 4).toFixed(1) + '" text-anchor="end">' + (t * 100).toFixed(2) + '%</text>';
  }

  const bars = M.map((m, i) => {
    const v = m.finalXbtPct - 1;
    const top = Math.min(y(0), y(v));
    const h = Math.abs(y(v) - y(0));
    return '<rect data-i="' + i + '" x="' + (x(i) - bw / 2).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + bw.toFixed(1) +
      '" height="' + Math.max(1, h).toFixed(1) + '" rx="1" fill="var(--' + (v >= 0 ? 'pos' : 'neg') + ')"/>';
  }).join('');

  const labels = M.map((m, i) => i % 12 === 0
    ? '<text class="ticktext" x="' + x(i).toFixed(1) + '" y="' + (H + 12) + '" text-anchor="middle">' + m.month + '</text>' : '').join('');

  const el = document.createElement('div');
  el.className = 'panel';
  el.innerHTML = '<h2>Final balance per month, XBT-relative (drift-free)</h2>' +
    '<div class="legend"><span class="sw" style="background:var(--pos)"></span>ended above start' +
    ' &nbsp; <span class="sw" style="background:var(--neg)"></span>ended below start</div>' +
    '<div class="chartwrap"><svg width="' + W + '" height="' + (H + 18) + '" viewBox="0 0 ' + W + ' ' + (H + 18) + '">' + g + bars + labels + '</svg></div>';
  container.appendChild(el);

  el.querySelector('svg').addEventListener('mousemove', ev => {
    const t = ev.target;
    if (t.tagName !== 'rect') { tooltip.style.visibility = 'hidden'; return; }
    const m = M[+t.dataset.i];
    tooltip.style.visibility = 'visible';
    tooltip.style.left = Math.min(window.innerWidth - 240, ev.clientX + 14) + 'px';
    tooltip.style.top = (ev.clientY + 12) + 'px';
    tooltip.innerHTML = '<b>' + m.month + '</b> · ' + pct(m.finalXbtPct) + ' (XBT)<br>final ' + usd(m.finalUsd) +
      ' USD · min ' + usd(m.minUsd) + ' · max ' + usd(m.maxUsd) + '<br>' +
      (m.frozeAt ? 'froze ' + m.frozeAt.slice(5, 16) : 'never froze') + (m.bustedAt ? ' · BUSTED' : '') + ' · fees ' + m.fees.toFixed(5) + ' XBT';
  });
  el.querySelector('svg').addEventListener('mouseleave', () => (tooltip.style.visibility = 'hidden'));
}

/** Per-year panels: 12 monthly USD equity curves. */
const years = [...new Set(M.map(m => m.month.slice(0, 4)))];

for (const year of years) {
  const ms = M.filter(m => m.month.startsWith(year));
  const H = 210;
  const maxLen = Math.max(...ms.map(m => m.equityMBtcSeries.length));
  let lo = Infinity, hi = -Infinity;
  for (const m of ms) for (const v of m.equityMBtcSeries) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = (hi - lo) * 0.05 || 1;
  const y = v => 8 + (H - 16) * (1 - (v - lo + pad) / (hi - lo + 2 * pad));
  const x = i => PL + (W - PL - PR) * (maxLen <= 1 ? 0 : i / (maxLen - 1));

  let g = '';
  const step = (hi - lo + 2 * pad) / 4;
  for (let k = 0; k <= 4; k++) {
    const v = lo - pad + step * k;
    g += '<line class="gridline" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
         '<text class="ticktext" x="' + (PL - 8) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + mb(v) + '</text>';
  }
  if (INIT_MBTC >= lo - pad && INIT_MBTC <= hi + pad) {
    g += '<line class="baseline" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(INIT_MBTC).toFixed(1) + '" y2="' + y(INIT_MBTC).toFixed(1) + '"/>';
  }

  const paths = ms.map((m, k) =>
    '<path class="mline" style="stroke:' + LINE_COLORS[k % LINE_COLORS.length] + '" data-m="' + m.month + '" d="' +
    m.equityMBtcSeries.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('') + '"/>').join('');

  let xAxis = '';
  for (let d = 0; d * 24 <= maxLen; d += 5) {
    xAxis += '<text class="ticktext" x="' + x(d * 24).toFixed(1) + '" y="' + (H + 12) + '" text-anchor="middle">' + d + 'd</text>';
  }

  const el = document.createElement('div');
  el.className = 'panel';
  el.innerHTML = '<h2>' + year + ' — monthly equity curves, mBTC (each line = one month from a fresh ' + INIT_MBTC + ' mBTC; line end = frozen)</h2>' +
    '<div class="chartwrap"><svg width="' + W + '" height="' + (H + 18) + '" viewBox="0 0 ' + W + ' ' + (H + 18) + '">' + g + paths + xAxis + '</svg></div>';
  container.appendChild(el);

  const svg = el.querySelector('svg');
  svg.addEventListener('mousemove', ev => {
    const t = ev.target;
    for (const p of svg.querySelectorAll('.mline')) p.classList.remove('hot');
    if (t.classList && t.classList.contains('mline')) {
      t.classList.add('hot');
      const m = M.find(mm => mm.month === t.dataset.m);
      tooltip.style.visibility = 'visible';
      tooltip.style.left = Math.min(window.innerWidth - 240, ev.clientX + 14) + 'px';
      tooltip.style.top = (ev.clientY + 12) + 'px';
      tooltip.innerHTML = '<b>' + m.month + '</b> · final ' + mb(m.finalMBtc) + ' mBTC (' + pct(m.finalXbtPct) + ')<br>' +
        (m.frozeAt ? 'froze ' + m.frozeAt.slice(5, 16) : 'never froze') + (m.bustedAt ? ' · BUSTED' : '');
    } else {
      tooltip.style.visibility = 'hidden';
    }
  });
  svg.addEventListener('mouseleave', () => {
    tooltip.style.visibility = 'hidden';
    for (const p of svg.querySelectorAll('.mline')) p.classList.remove('hot');
  });
}

/** Table view. */
document.getElementById('tablewrap').innerHTML = '<table><tr><th>month</th><th>final XBT%</th><th>final mBTC</th>' +
  '<th>min mBTC</th><th>max mBTC</th><th>froze</th><th>gap@freeze</th><th>frozen uPnL</th><th>fees XBT</th><th>events</th></tr>' +
  M.map(m => '<tr><td>' + m.month + '</td><td>' + pct(m.finalXbtPct) + '</td><td>' + mb(m.finalMBtc) + '</td><td>' +
    mb(m.minMBtc) + '</td><td>' + mb(m.maxMBtc) + '</td><td>' + (m.frozeAt ? m.frozeAt.slice(0, 16) : '—') + '</td><td>' +
    (Number.isFinite(m.gapAtFreeze) ? (m.gapAtFreeze * 100).toFixed(3) + '%' : '—') + '</td><td>' +
    (Number.isFinite(m.frozenUPnl) ? m.frozenUPnl.toFixed(6) : '—') + '</td><td>' + m.fees.toFixed(5) + '</td><td>' + m.events + '</td></tr>').join('') + '</table>';
</script>
</body>
</html>
`;
}
