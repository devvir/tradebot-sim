import { useEffect, useMemo, useRef } from 'react';

import { MIN_SPAN_MS } from '../bins';
import { changePoints } from '../series';
import { setChartState } from '../store';
import { priceTicks, tickDecimals, timeTicks, niceStep } from '../ticks';

import type { ApiCandle, ApiIndicator, ApiPoint } from '@poc/core';
import type { CandleType } from '../types';

interface Props {
  candles: ApiCandle[];
  overlays: { spec: ApiIndicator; points: ApiPoint[] }[];
  candleType: CandleType;
  /** Logarithmic price axis — equal vertical distance means equal % move. */
  logScale: boolean;
  /** Visible range as ISO instants — the source of truth for zoom and pan. */
  from: string;
  to: string;
}

/** Widest span the chart will zoom out to — the dataset is ~11 years. */
const MAX_SPAN_MS = 12 * 365 * 24 * 3600_000;

/** Gutter reserved for the price axis, so candles never run under the labels. */
const AXIS_W = 62;

/** Room at the bottom for the time axis. */
const AXIS_H = 18;

/**
 * The candle chart. Draws on a canvas because the point counts get large and
 * DOM nodes per candle do not survive that.
 *
 * Zoom and pan rewrite the shared visible range — from the range itself, never
 * from the loaded candles — so they keep working even when the current range
 * holds no data. The span is clamped so zooming in can never collapse it to a
 * single instant (which read as "no data" and used to trap the view).
 */
export function CandleChart({ candles, overlays, candleType, logScale, from, to }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; from: number; to: number } | null>(null);
  const shown = useMemo(() => (candleType === 'heikin-ashi' ? toHeikinAshi(candles) : candles), [candles, candleType]);

  useEffect(() => {
    const canvas = ref.current;
    const box = wrap.current;

    if (! canvas || ! box) {
      return;
    }

    const render = () => draw(canvas, shown, overlays, box.clientHeight, logScale);

    render();

    const ro = new ResizeObserver(render);

    ro.observe(box);

    return () => ro.disconnect();
  }, [shown, overlays, logScale]);

  /**
   * Wheel handling is a NATIVE listener, deliberately.
   *
   * React registers `onWheel` passively at the root, so `preventDefault()` in a
   * synthetic handler is a no-op — and without it Chrome reads a two-finger
   * horizontal swipe as back/forward navigation and leaves the page.
   *
   * Vertical wheel zooms about the pointer; horizontal wheel (a two-finger
   * sideways swipe) pans, which is what the gesture means everywhere else.
   */
  useEffect(() => {
    const canvas = ref.current;

    if (! canvas) {
      return;
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();

      const lo = Date.parse(from);
      const hi = Date.parse(to);
      const span = hi - lo;
      const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();

      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const shift = (e.deltaX / rect.width) * span;

        setChartState({ from: iso(lo + shift), to: iso(hi + shift) });

        return;
      }

      const frac = (e.clientX - rect.left) / rect.width;
      const anchor = lo + span * frac;
      const next = clamp(span * (e.deltaY > 0 ? 1.3 : 1 / 1.3), MIN_SPAN_MS, MAX_SPAN_MS);

      setChartState({ from: iso(anchor - next * frac), to: iso(anchor - next * frac + next) });
    }

    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => canvas.removeEventListener('wheel', onWheel);
  }, [from, to]);

  function onDown(e: React.MouseEvent) {
    drag.current = { x: e.clientX, from: Date.parse(from), to: Date.parse(to) };
  }

  function onMove(e: React.MouseEvent) {
    const d = drag.current;
    const box = wrap.current;

    if (! d || ! box) {
      return;
    }

    const span = d.to - d.from;
    const shift = ((d.x - e.clientX) / box.clientWidth) * span;

    setChartState({ from: iso(d.from + shift), to: iso(d.to + shift) });
  }

  return (
    <div ref={wrap} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <canvas
        ref={ref}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          cursor: drag.current ? 'grabbing' : 'grab',
          /** Belt and braces with preventDefault: no swipe-to-navigate, ever. */
          overscrollBehavior: 'none',
          touchAction: 'none',
        }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
      />
    </div>
  );
}

/**
 * Heikin-Ashi derives from regular OHLC — each candle needs only the previous
 * HA candle, so it streams and needs no cached bins of its own.
 */
function toHeikinAshi(candles: ApiCandle[]): ApiCandle[] {
  const out: ApiCandle[] = [];

  for (const c of candles) {
    const close = (c.o + c.h + c.l + c.c) / 4;
    const prev = out[out.length - 1];
    const open = prev ? (prev.o + prev.c) / 2 : (c.o + c.c) / 2;

    out.push({ t: c.t, o: open, c: close, h: Math.max(c.h, open, close), l: Math.min(c.l, open, close), v: c.v });
  }

  return out;
}

function draw(
  canvas: HTMLCanvasElement,
  candles: ApiCandle[],
  overlays: Props['overlays'],
  height: number,
  logScale: boolean,
) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;

  canvas.width = w * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d')!;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, w, height);

  if (candles.length === 0) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('no data in range — zoom out or pick another window', w / 2, height / 2);
    ctx.textAlign = 'left';

    return;
  }

  /** Price scale spans candles AND overlays, or an overlay would clip. */
  const values = candles.flatMap((c) => [c.h, c.l]);

  overlays.forEach((o) => o.points.forEach((p) => p.v != null && values.push(p.v)));

  /**
   * A log axis is only defined for positive values. Overlays share the price
   * axis and not all of them are prices — a spread or a slope can sit at or
   * below zero — so non-positive values are excluded from the scale and skipped
   * when plotting, rather than silently collapsing the whole axis.
   */
  const usable = logScale ? values.filter((v) => v > 0) : values;
  const log = logScale && usable.length > 0;
  const lo = Math.min(...usable);
  const hi = Math.max(...usable);
  const project = (v: number) => (log ? Math.log(v) : v);
  const plo = project(lo);
  const phi = project(hi);
  const pad = (phi - plo) * 0.05 || (log ? 0.01 : 1);
  const plotH = height - AXIS_H;
  const y = (v: number) => plotH - 6 - ((project(v) - plo + pad) / (phi - plo + pad * 2)) * (plotH - 16);
  const plottable = (v: number) => ! log || v > 0;
  const plotW = w - AXIS_W;
  const step = plotW / candles.length;
  const body = Math.max(1, Math.min(step * 0.7, 14));

  drawGrid(ctx, { w, height, plotW, plotH, lo, hi, y, candles, step });

  candles.forEach((c, i) => {
    const x = i * step + step / 2;
    const up = c.c >= c.o;

    ctx.strokeStyle = up ? '#0a9b62' : '#d1453b';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(x, y(c.h));
    ctx.lineTo(x, y(c.l));
    ctx.stroke();
    ctx.fillRect(x - body / 2, y(Math.max(c.o, c.c)), body, Math.max(1, Math.abs(y(c.o) - y(c.c))));
  });

  const index = new Map(candles.map((c, i) => [c.t, i]));

  for (const { spec, points } of overlays) {
    ctx.strokeStyle = spec.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    let started = false;

    /** Vertices where the value changed; the segments between are the line. */
    for (const p of changePoints(points)) {
      const i = index.get(p.t);

      if (i === undefined || p.v == null || ! plottable(p.v)) {
        continue;
      }

      const x = i * step + step / 2;

      started ? ctx.lineTo(x, y(p.v)) : ctx.moveTo(x, y(p.v));
      started = true;
    }

    ctx.stroke();
  }

}

/**
 * Gridlines and axes: round price levels on the right, natural time boundaries
 * along the bottom. Drawn under the candles so it reads as a backdrop, and kept
 * dim enough that price is still what the eye lands on.
 */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  g: {
    w: number;
    height: number;
    plotW: number;
    plotH: number;
    lo: number;
    hi: number;
    y: (v: number) => number;
    candles: ApiCandle[];
    step: number;
  },
) {
  const { w, height, plotW, plotH, lo, hi, y, candles, step } = g;
  const target = Math.max(3, Math.round(plotH / 60));
  const prices = priceTicks(lo, hi, target);
  const decimals = tickDecimals(niceStep(hi - lo, target));

  ctx.font = '11px system-ui';
  ctx.lineWidth = 1;

  for (const p of prices) {
    const py = Math.round(y(p)) + 0.5;

    ctx.strokeStyle = '#1a1f27';
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(plotW, py);
    ctx.stroke();

    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'left';
    ctx.fillText(p.toFixed(decimals), plotW + 6, py + 4);
  }

  /** Time gridlines land on the nearest candle to each natural boundary. */
  const first = Date.parse(candles[0].t);
  const last = Date.parse(candles[candles.length - 1].t);
  const spanMs = last - first || 1;
  const times = timeTicks(first, last, Math.max(2, Math.round(plotW / 140)));

  ctx.textAlign = 'center';

  for (const t of times) {
    const i = Math.round(((t - first) / spanMs) * (candles.length - 1));
    const x = Math.round(i * step + step / 2) + 0.5;

    ctx.strokeStyle = '#1a1f27';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, plotH);
    ctx.stroke();

    ctx.fillStyle = '#6b7280';
    ctx.fillText(stamp(new Date(t).toISOString(), spanMs), x, height - 5);
  }

  /** Axis rules, a touch brighter than the grid so the plot area reads as bounded. */
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#262b34';
  ctx.beginPath();
  ctx.moveTo(plotW + 0.5, 0);
  ctx.lineTo(plotW + 0.5, plotH);
  ctx.moveTo(0, plotH + 0.5);
  ctx.lineTo(w, plotH + 0.5);
  ctx.stroke();
}

/** Time-of-day inside a day, date beyond it — whichever the span makes meaningful. */
function stamp(t: string, spanMs = 0): string {
  return spanMs > 0 && spanMs < 3 * 86_400_000 ? t.slice(11, 16) : t.slice(5, 10);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
