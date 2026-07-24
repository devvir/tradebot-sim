import { useEffect, useRef } from 'react';

import { changePoints } from '../series';

import type { ApiIndicator, ApiPoint } from '@poc/core';

interface Props {
  spec: ApiIndicator;
  points: ApiPoint[];
  height: number;
  onRemove?: () => void;
}

/**
 * One sub-pane: a single non-overlaid series on its own canvas with its own
 * scale.
 *
 * The featured area is one instance of this; the common area is a list of
 * them. They are the same component on purpose — writing them separately is
 * how this UI would rot.
 */
export function IndicatorPane({ spec, points, height, onRemove }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;

    if (! canvas) {
      return;
    }

    draw(canvas, points, spec.color, spec.kind, height);
  }, [points, spec, height]);

  const last = [...points].reverse().find((p) => p.v != null);

  return (
    <div style={{ borderTop: '1px solid #1c2027', position: 'relative' }}>
      <div style={headerStyle}>
        <span style={{ width: 8, height: 8, background: spec.color, borderRadius: 2 }} />
        <b style={{ fontWeight: 600 }}>{spec.label}</b>
        <span style={{ color: '#6b7280' }}>{spec.tf}</span>
        {last?.v != null && <span style={{ color: spec.color }}>{last.v.toFixed(4)}</span>}
        {onRemove && (
          <button onClick={onRemove} style={removeStyle} title="remove pane">
            ×
          </button>
        )}
      </div>
      <canvas ref={ref} style={{ width: '100%', height, display: 'block' }} />
    </div>
  );
}

function draw(canvas: HTMLCanvasElement, points: ApiPoint[], color: string, kind: string, height: number) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;

  canvas.width = w * dpr;
  canvas.height = height * dpr;

  const ctx = canvas.getContext('2d')!;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, w, height);

  const values = points.map((p) => p.v).filter((v): v is number => v != null);

  if (values.length === 0) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px system-ui';
    ctx.fillText('no values in range', 10, height / 2);

    return;
  }

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const y = (v: number) => height - 6 - ((v - lo) / span) * (height - 12);
  const step = w / points.length;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  let started = false;

  /**
   * Index by timestamp so vertices keep their true x position after the
   * flat runs are dropped — the series is still spaced by the chart's bin.
   */
  const at = new Map(points.map((p, i) => [p.t, i]));

  changePoints(points).forEach((p) => {
    const i = at.get(p.t);

    if (p.v == null || i === undefined) {
      return;
    }

    const x = i * step + step / 2;

    started ? ctx.lineTo(x, y(p.v)) : ctx.moveTo(x, y(p.v));
    started = true;
  });

  ctx.stroke();

  if (kind === 'area') {
    ctx.lineTo(w, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = `${color}22`;
    ctx.fill();
  }

  ctx.fillStyle = '#4b5563';
  ctx.font = '10px system-ui';
  ctx.fillText(hi.toFixed(2), 4, 10);
  ctx.fillText(lo.toFixed(2), 4, height - 2);
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  font: '11px system-ui',
  color: '#e8e8e8',
  padding: '4px 8px',
  background: '#12151a',
};

const removeStyle: React.CSSProperties = {
  marginLeft: 'auto',
  background: 'transparent',
  color: '#6b7280',
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
};
