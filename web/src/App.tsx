import { useEffect, useState } from 'react';

import { fetchBins } from './api';
import { AUTO, resolveBin } from './bins';
import { CandleChart } from './components/CandleChart';
import { IndicatorPane } from './components/IndicatorPane';
import { IndicatorSelector } from './components/IndicatorSelector';
import { Toolbar } from './components/Toolbar';
import { setChartState, toggleFavorite, useChartState } from './store';
import { useCandles, useIndicators, useSeriesMap } from './useSeries';

/**
 * Page layout: four stacked areas — featured indicator, candle chart, boolean
 * bar, common indicators.
 *
 * The chart is the point of the page and takes every pixel the indicator areas
 * do not need: an empty area costs only its control bar, and each added pane
 * takes its own height from the chart rather than from a fixed reservation.
 *
 * The featured and common areas are the same component (one instance vs a
 * list), and all three selectors are the same component differing only in
 * cardinality and overlay filter. Adding an indicator changes nothing here.
 */
export function App() {
  const state = useChartState();
  const indicators = useIndicators(state.symbol);
  const [bins, setBins] = useState<string[]>([]);

  useEffect(() => {
    fetchBins().then(setBins).catch(() => setBins([]));
  }, []);

  const bin = resolveBin(state.bin, state.from, state.to);
  const candles = useCandles(state.symbol, state.from, state.to, bin);
  const paneIds = [...(state.featured ? [state.featured] : []), ...state.bottom];
  const series = useSeriesMap([...paneIds, ...state.overlays], state.symbol, state.from, state.to, bin);
  const byId = Object.fromEntries(indicators.map((i) => [i.id, i]));

  const overlays = state.overlays
    .filter((id) => byId[id])
    .map((id) => ({ spec: byId[id], points: series[id] ?? [] }));

  const featured = state.featured ? byId[state.featured] : undefined;
  const bottom = state.bottom.filter((id) => byId[id]);

  /** 1s has no cached source yet — see docs/planning/ROADMAP.md. */
  const disabledBins = ['1s'];

  return (
    <div style={pageStyle}>
      <Toolbar state={state} bins={bins} disabledBins={disabledBins} resolved={bin} />

      <Area
        title="Featured"
        collapsed={state.featuredCollapsed}
        onToggle={() => setChartState({ featuredCollapsed: ! state.featuredCollapsed })}
        selector={
          <IndicatorSelector
            indicators={indicators}
            overlay={false}
            multi={false}
            selected={state.featured ? [state.featured] : []}
            onChange={(ids) => setChartState({ featured: ids[0] ?? null })}
            label="Featured indicator"
            favorites={state.favorites}
            onToggleFavorite={toggleFavorite}
          />
        }
      >
        {featured && (
          <IndicatorPane
            spec={featured}
            points={series[featured.id] ?? []}
            height={110}
            onRemove={() => setChartState({ featured: null })}
          />
        )}
      </Area>

      <div style={{ position: 'relative', flex: 1, minHeight: 220, display: 'flex', borderTop: '1px solid #262b34' }}>
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10 }}>
          <IndicatorSelector
            indicators={indicators}
            overlay
            multi
            selected={state.overlays}
            onChange={(ids) => setChartState({ overlays: ids })}
            label="Overlays"
            favorites={state.favorites}
            onToggleFavorite={toggleFavorite}
          />
        </div>
        <CandleChart
          candles={candles}
          overlays={overlays}
          candleType={state.candleType}
          logScale={state.logScale}
          from={state.from}
          to={state.to}
        />
      </div>

      {/* Boolean bar: gate-style series render here as a thin two-colour ribbon.
          Nothing declares a boolean kind yet, so it stays empty by design. */}
      <div style={{ height: 8, background: '#12151a', borderTop: '1px solid #1c2027', flex: '0 0 auto' }} />

      <Area
        title="Common"
        collapsed={state.bottomCollapsed}
        onToggle={() => setChartState({ bottomCollapsed: ! state.bottomCollapsed })}
        selector={
          <IndicatorSelector
            indicators={indicators}
            overlay={false}
            multi
            selected={state.bottom}
            onChange={(ids) => setChartState({ bottom: ids })}
            label="Common indicators"
            favorites={state.favorites}
            onToggleFavorite={toggleFavorite}
          />
        }
      >
        {bottom.map((id) => (
          <IndicatorPane
            key={id}
            spec={byId[id]}
            points={series[id] ?? []}
            height={90}
            onRemove={() => setChartState({ bottom: state.bottom.filter((b) => b !== id) })}
          />
        ))}
      </Area>

      <div style={statusStyle}>
        {candles.length} candles · {bin}
        {state.bin === AUTO ? ' (auto)' : ''} · {indicators.length} indicators cached · wheel to zoom, drag to pan
      </div>
    </div>
  );
}

/**
 * A collapsible region with its selector in the header.
 *
 * Shared by both pane areas. With nothing selected it is just its control bar —
 * it never reserves space it is not using.
 */
function Area({
  title,
  collapsed,
  onToggle,
  selector,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  selector: React.ReactNode;
  children: React.ReactNode;
}) {
  const empty = Array.isArray(children) ? children.length === 0 : ! children;

  return (
    <div style={{ borderTop: '1px solid #1c2027', flex: '0 0 auto', maxHeight: '55vh', overflowY: 'auto' }}>
      <div style={headerStyle}>
        <button
          onClick={onToggle}
          disabled={empty}
          style={{ background: 'none', border: 'none', color: empty ? '#333' : '#6b7280', cursor: empty ? 'default' : 'pointer' }}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span style={{ color: '#6b7280', font: '11px system-ui', textTransform: 'uppercase' }}>{title}</span>
        {selector}
      </div>
      {! collapsed && children}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  background: '#0d0d0d',
  color: '#e8e8e8',
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  font: '13px system-ui',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '3px 8px',
  background: '#12151a',
  position: 'sticky',
  top: 0,
};

const statusStyle: React.CSSProperties = {
  padding: '3px 10px',
  color: '#4b5563',
  font: '11px system-ui',
  flex: '0 0 auto',
  borderTop: '1px solid #1c2027',
};
