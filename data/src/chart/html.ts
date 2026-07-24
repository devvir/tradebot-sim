import { readFileSync, writeFileSync } from 'fs';

import type { HourlyRow } from '@poc/core';

/**
 * Render a sim hourly evolution log into a self-contained HTML chart page
 * (no external assets; theme-aware; POC.md "charting parses the log later").
 *
 * Layout: stacked small-multiple panels sharing the time axis — price,
 * account (equity/wallet/available), uPnL, trades — plus a mode strip.
 * One y-axis per panel (never dual-axis); hover crosshair + tooltip; data
 * table for accessibility relief.
 */
export function renderChart(csvPath: string, outPath: string, title: string): void {
  const rows = parseCsv(csvPath);
  const html = page(title, rows);

  writeFileSync(outPath, html);
}

function parseCsv(path: string): HourlyRow[] {
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const header = lines[0].split(',');
  const idx = (name: string) => header.indexOf(name);

  return lines.slice(1).map((line) => {
    const c = line.split(',');

    return {
      hour: c[idx('hour')],
      priceMin: +c[idx('priceMin')],
      priceMax: +c[idx('priceMax')],
      walletMin: +c[idx('walletMin')],
      walletMax: +c[idx('walletMax')],
      equityMin: +c[idx('equityMin')],
      equityMax: +c[idx('equityMax')],
      uPnlMin: +c[idx('uPnlMin')],
      uPnlMax: +c[idx('uPnlMax')],
      availMin: +c[idx('availMin')],
      availMax: +c[idx('availMax')],
      gapMin: c[idx('gapMin')] === '' ? NaN : +c[idx('gapMin')],
      gapMax: c[idx('gapMax')] === '' ? NaN : +c[idx('gapMax')],
      realized: +c[idx('realized')],
      feesPaid: +c[idx('feesPaid')],
      trades: +c[idx('trades')],
      mode: c[idx('mode')] as HourlyRow['mode'],
    };
  });
}

function page(title: string, rows: HourlyRow[]): string {
  const data = JSON.stringify(rows);

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
    --s-price: #2a78d6; --s-equity: #008300; --s-wallet: #e87ba4;
    --s-avail: #eda100; --s-upnl: #1baf7a; --s-trades: #eb6834;
    --st-trading: #0ca30c; --st-waiting: #fab219; --st-frozen: #d03b3b; --st-idle: #898781;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) .viz-root {
      color-scheme: dark;
      --surface-1: #1a1a19; --page: #0d0d0d;
      --ink-1: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
      --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
      --s-price: #3987e5; --s-equity: #008300; --s-wallet: #d55181;
      --s-avail: #c98500; --s-upnl: #199e70; --s-trades: #d95926;
    }
  }
  :root[data-theme="dark"] .viz-root {
    color-scheme: dark;
    --surface-1: #1a1a19; --page: #0d0d0d;
    --ink-1: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
    --s-price: #3987e5; --s-equity: #008300; --s-wallet: #d55181;
    --s-avail: #c98500; --s-upnl: #199e70; --s-trades: #d95926;
  }
  body { margin: 0; background: var(--page); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .viz-root { color: var(--ink-1); max-width: 1240px; margin: 0 auto; padding: 20px 16px 60px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sub { color: var(--ink-2); margin: 0 0 18px; font-size: 13px; }
  .panel { background: var(--surface-1); border: 1px solid var(--ring); border-radius: 8px; padding: 12px 14px 6px; margin-bottom: 14px; }
  .panel h2 { font-size: 13px; font-weight: 600; margin: 0 0 2px; color: var(--ink-1); }
  .legend { display: flex; gap: 14px; font-size: 12px; color: var(--ink-2); margin-bottom: 4px; flex-wrap: wrap; }
  .legend .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
  .chartwrap { overflow-x: auto; }
  svg { display: block; }
  .gridline { stroke: var(--grid); stroke-width: 1; }
  .zeroline { stroke: var(--axis); stroke-width: 1; }
  .ticktext { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .dlabel { font-size: 11px; font-weight: 600; }
  .crosshair { stroke: var(--axis); stroke-width: 1; stroke-dasharray: 3 3; visibility: hidden; }
  #tooltip { position: fixed; pointer-events: none; background: var(--surface-1); color: var(--ink-1);
    border: 1px solid var(--ring); border-radius: 6px; padding: 8px 10px; font-size: 12px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.15); visibility: hidden; z-index: 10; min-width: 210px; }
  #tooltip .t { color: var(--ink-2); margin-bottom: 4px; }
  #tooltip table { border-collapse: collapse; }
  #tooltip td { padding: 1px 4px 1px 0; font-variant-numeric: tabular-nums; }
  details { margin-top: 20px; color: var(--ink-2); }
  details table { border-collapse: collapse; font-size: 12px; margin-top: 8px; font-variant-numeric: tabular-nums; }
  details th, details td { border-bottom: 1px solid var(--grid); padding: 3px 10px 3px 0; text-align: right; }
  details th:first-child, details td:first-child { text-align: left; }
</style>
</head>
<body>
<div class="viz-root">
  <h1>${title}</h1>
  <p class="sub">Hourly min–max evolution. Naive v1, no recovery — the run stops at the first freeze.</p>
  <div id="panels"></div>
  <div id="tooltip"></div>
  <details><summary>Data table</summary><div id="tablewrap"></div></details>
</div>
<script>
const ROWS = ${data};
const W = 1180, PL = 74, PR = 120, PH = 190, MODE_H = 46;

const cssVar = (name) => getComputedStyle(document.querySelector('.viz-root')).getPropertyValue(name).trim();

const panels = [
  { title: 'Price (USD)', series: [
    { name: 'price', varName: '--s-price', lo: r => r.priceMin, hi: r => r.priceMax, band: true } ], fmt: v => Math.round(v).toLocaleString() },
  { title: 'Account (XBT)', series: [
    { name: 'equity', varName: '--s-equity', lo: r => r.equityMin, hi: r => r.equityMax, band: true },
    { name: 'wallet', varName: '--s-wallet', lo: r => r.walletMin, hi: r => r.walletMax },
    { name: 'available', varName: '--s-avail', lo: r => r.availMin, hi: r => r.availMax } ], fmt: v => v.toFixed(4) },
  { title: 'Unrealized PnL (XBT)', series: [
    { name: 'uPnL', varName: '--s-upnl', lo: r => r.uPnlMin, hi: r => r.uPnlMax, band: true } ], fmt: v => v.toFixed(4), zero: true },
  { title: 'Entries gap (% of price) — the frozen-loss variable', series: [
    { name: 'gap', varName: '--s-wallet', lo: r => r.gapMin * 100, hi: r => r.gapMax * 100, band: true } ], fmt: v => v.toFixed(3) + '%', zero: true, skipNaN: true },
  { title: 'Trades per hour', series: [
    { name: 'trades', varName: '--s-trades', lo: r => r.trades, hi: r => r.trades, bars: true } ], fmt: v => String(Math.round(v)) },
];

const X = i => PL + (W - PL - PR) * (ROWS.length <= 1 ? 0 : i / (ROWS.length - 1));

function yScale(min, max, height) {
  const pad = (max - min) * 0.06 || 1e-9;
  const lo = min - pad, hi = max + pad;
  return v => 8 + (height - 16) * (1 - (v - lo) / (hi - lo));
}

function extent(panel) {
  let min = Infinity, max = -Infinity;
  for (const s of panel.series) for (const r of ROWS) {
    const lo = s.lo(r), hi = s.hi(r);
    if (Number.isFinite(lo)) min = Math.min(min, lo);
    if (Number.isFinite(hi)) max = Math.max(max, hi);
  }
  if (panel.zero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (! Number.isFinite(min)) { min = 0; max = 1; }
  return [min, max];
}

function pathFor(fn, ys) {
  let d = '', pen = false;
  ROWS.forEach((r, i) => {
    const v = fn(r);
    if (! Number.isFinite(v)) { pen = false; return; }
    d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + ys(v).toFixed(1);
    pen = true;
  });
  return d;
}

/** Contiguous index runs where both band bounds are finite. */
function finiteRuns(s) {
  const runs = []; let run = [];
  ROWS.forEach((r, i) => {
    if (Number.isFinite(s.lo(r)) && Number.isFinite(s.hi(r))) { run.push(i); }
    else if (run.length) { runs.push(run); run = []; }
  });
  if (run.length) runs.push(run);
  return runs;
}

function ticks(min, max, n) {
  const out = []; for (let k = 0; k <= n; k++) out.push(min + (max - min) * k / n); return out;
}

const container = document.getElementById('panels');
let svgIdx = 0;

for (const p of panels) {
  const [min, max] = extent(p);
  const ys = yScale(min, max, PH);
  const el = document.createElement('div');
  el.className = 'panel';

  let legend = '';
  if (p.series.length > 1) {
    legend = '<div class="legend">' + p.series.map(s =>
      '<span><span class="sw" style="background:var(' + s.varName + ')"></span>' + s.name + '</span>').join('') + '</div>';
  }

  let g = '';
  for (const t of ticks(min, max, 4)) {
    g += '<line class="gridline" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + ys(t).toFixed(1) + '" y2="' + ys(t).toFixed(1) + '"/>' +
         '<text class="ticktext" x="' + (PL - 8) + '" y="' + (ys(t) + 4).toFixed(1) + '" text-anchor="end">' + p.fmt(t) + '</text>';
  }
  if (p.zero) g += '<line class="zeroline" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + ys(0).toFixed(1) + '" y2="' + ys(0).toFixed(1) + '"/>';

  let marks = '';
  for (const s of p.series) {
    const color = 'var(' + s.varName + ')';
    if (s.bars) {
      const bw = Math.max(1, (W - PL - PR) / ROWS.length - 1);
      marks += ROWS.map((r, i) => {
        const y = ys(s.hi(r));
        return '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) +
          '" height="' + Math.max(0, ys(Math.max(0, min)) - y).toFixed(1) + '" rx="1" fill="' + color + '"/>';
      }).join('');
    } else if (s.band) {
      for (const run of finiteRuns(s)) {
        const top = run.map((i, k) => (k ? 'L' : 'M') + X(i).toFixed(1) + ' ' + ys(s.hi(ROWS[i])).toFixed(1)).join('');
        const bottom = [...run].reverse().map(i => 'L' + X(i).toFixed(1) + ' ' + ys(s.lo(ROWS[i])).toFixed(1)).join('');
        marks += '<path d="' + top + bottom + 'Z" fill="' + color + '" opacity="0.22"/>';
      }
      marks += '<path d="' + pathFor(r => (s.lo(r) + s.hi(r)) / 2, ys) + '" fill="none" stroke="' + color + '" stroke-width="2"/>';
    } else {
      marks += '<path d="' + pathFor(r => (s.lo(r) + s.hi(r)) / 2, ys) + '" fill="none" stroke="' + color + '" stroke-width="2"/>';
    }
    const lastFinite = [...ROWS].reverse().find(r => Number.isFinite(s.lo(r)) && Number.isFinite(s.hi(r)));
    if (lastFinite) {
      const lastV = (s.lo(lastFinite) + s.hi(lastFinite)) / 2;
      marks += '<text class="dlabel" fill="' + color + '" x="' + (W - PR + 8) + '" y="' + (ys(lastV) + 4).toFixed(1) + '">' +
        s.name + ' ' + p.fmt(lastV) + '</text>';
    }
  }

  const dates = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * (ROWS.length - 1)));
  let xAxis = dates.map(i =>
    '<text class="ticktext" x="' + X(i).toFixed(1) + '" y="' + (PH + 14) + '" text-anchor="middle">' + ROWS[i].hour.slice(0, 10) + '</text>').join('');

  el.innerHTML = '<h2>' + p.title + '</h2>' + legend +
    '<div class="chartwrap"><svg id="svg' + svgIdx + '" width="' + W + '" height="' + (PH + 20) + '" viewBox="0 0 ' + W + ' ' + (PH + 20) + '">' +
    g + marks + '<line class="crosshair" id="ch' + svgIdx + '" y1="0" y2="' + PH + '"/></svg></div>';
  container.appendChild(el);
  svgIdx++;
}

/** Mode strip (status colors; identity also carried by the legend text + tooltip). */
{
  const el = document.createElement('div');
  el.className = 'panel';
  const colors = { trading: 'var(--st-trading)', waiting: 'var(--st-waiting)', frozen: 'var(--st-frozen)', idle: 'var(--st-idle)' };
  const bw = (W - PL - PR) / ROWS.length;
  const marks = ROWS.map((r, i) =>
    '<rect x="' + (PL + i * bw).toFixed(2) + '" y="8" width="' + (bw + 0.5).toFixed(2) + '" height="22" fill="' + colors[r.mode] + '"/>').join('');
  el.innerHTML = '<h2>Mode</h2><div class="legend">' +
    Object.entries(colors).map(([m, c]) => '<span><span class="sw" style="background:' + c + '"></span>' + m + '</span>').join('') +
    '</div><div class="chartwrap"><svg id="svgmode" width="' + W + '" height="' + MODE_H + '" viewBox="0 0 ' + W + ' ' + MODE_H + '">' + marks +
    '<line class="crosshair" id="chmode" y1="0" y2="30"/></svg></div>';
  container.appendChild(el);
}

/** Shared crosshair + tooltip. */
const tooltip = document.getElementById('tooltip');
const allSvgs = [...document.querySelectorAll('svg')];
const crosshairs = [...document.querySelectorAll('.crosshair')];

for (const svg of allSvgs) {
  svg.addEventListener('mousemove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (W / rect.width);
    const i = Math.max(0, Math.min(ROWS.length - 1, Math.round((px - PL) / ((W - PL - PR) / (ROWS.length - 1)))));
    const r = ROWS[i];
    const x = X(i).toFixed(1);
    for (const ch of crosshairs) { ch.setAttribute('x1', x); ch.setAttribute('x2', x); ch.style.visibility = 'visible'; }
    tooltip.style.visibility = 'visible';
    tooltip.style.left = Math.min(window.innerWidth - 260, ev.clientX + 16) + 'px';
    tooltip.style.top = (ev.clientY + 14) + 'px';
    tooltip.innerHTML = '<div class="t">' + r.hour + ':00 · ' + r.mode + '</div><table>' +
      '<tr><td>price</td><td>' + Math.round(r.priceMin).toLocaleString() + ' – ' + Math.round(r.priceMax).toLocaleString() + '</td></tr>' +
      '<tr><td>equity</td><td>' + r.equityMin.toFixed(6) + ' – ' + r.equityMax.toFixed(6) + '</td></tr>' +
      '<tr><td>wallet</td><td>' + r.walletMin.toFixed(6) + ' – ' + r.walletMax.toFixed(6) + '</td></tr>' +
      '<tr><td>available</td><td>' + r.availMin.toFixed(6) + ' – ' + r.availMax.toFixed(6) + '</td></tr>' +
      '<tr><td>uPnL</td><td>' + r.uPnlMin.toFixed(6) + ' – ' + r.uPnlMax.toFixed(6) + '</td></tr>' +
      '<tr><td>realized</td><td>' + r.realized.toFixed(6) + '</td></tr>' +
      '<tr><td>fees</td><td>' + r.feesPaid.toFixed(6) + '</td></tr>' +
      '<tr><td>trades</td><td>' + r.trades + '</td></tr></table>';
  });
  svg.addEventListener('mouseleave', () => {
    tooltip.style.visibility = 'hidden';
    for (const ch of crosshairs) ch.style.visibility = 'hidden';
  });
}

/** Data table (accessibility relief for sub-contrast light series). */
{
  const wrap = document.getElementById('tablewrap');
  const rowsHtml = ROWS.map(r =>
    '<tr><td>' + r.hour + '</td><td>' + r.priceMin + '–' + r.priceMax + '</td><td>' + r.equityMin.toFixed(6) +
    '</td><td>' + r.walletMin.toFixed(6) + '</td><td>' + r.availMin.toFixed(6) + '</td><td>' + r.uPnlMin.toFixed(6) +
    '</td><td>' + r.realized.toFixed(6) + '</td><td>' + r.feesPaid.toFixed(6) + '</td><td>' + r.trades + '</td><td>' + r.mode + '</td></tr>').join('');
  wrap.innerHTML = '<table><tr><th>hour</th><th>price</th><th>equity min</th><th>wallet min</th><th>avail min</th>' +
    '<th>uPnL min</th><th>realized</th><th>fees</th><th>trades</th><th>mode</th></tr>' + rowsHtml + '</table>';
}
</script>
</body>
</html>
`;
}
