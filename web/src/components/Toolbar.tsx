import { AUTO } from '../bins';
import { setChartState } from '../store';

import type { ChartState } from '../types';

interface Props {
  state: ChartState;
  bins: string[];
  /** Bin sizes with no cached source yet — shown, but not selectable. */
  disabledBins: string[];
  /** What Auto currently resolves to, so the label says which size is in use. */
  resolved: string;
}

/**
 * Chart controls: symbol, range, candle type, bin size.
 *
 * `Auto` lets the zoom level pick the resolution — it is one option among the
 * pinned sizes, not a mode. Sizes with no cached source are disabled rather
 * than silently served coarser data.
 */
export function Toolbar({ state, bins, disabledBins, resolved }: Props) {
  return (
    <div style={barStyle}>
      <input
        value={state.symbol}
        onChange={(e) => setChartState({ symbol: e.target.value.toUpperCase() })}
        style={{ ...inputStyle, width: 100 }}
      />

      <input
        type="datetime-local"
        step={60}
        value={local(state.from)}
        onChange={(e) => setChartState({ from: fromLocal(e.target.value) })}
        style={inputStyle}
      />
      <input
        type="datetime-local"
        step={60}
        value={local(state.to)}
        onChange={(e) => setChartState({ to: fromLocal(e.target.value) })}
        style={inputStyle}
      />

      <label className="flex cursor-pointer items-center gap-1 text-xs text-[#8b93a3]" title="logarithmic price axis">
        <input
          type="checkbox"
          checked={state.logScale}
          onChange={(e) => setChartState({ logScale: e.target.checked })}
        />
        log
      </label>

      <select
        value={state.candleType}
        onChange={(e) => setChartState({ candleType: e.target.value as ChartState['candleType'] })}
        style={inputStyle}
      >
        <option value="regular">Regular</option>
        <option value="heikin-ashi">Heikin-Ashi</option>
      </select>

      <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
        {[AUTO, '1s', ...bins].map((b) => {
          const disabled = disabledBins.includes(b);
          const active = state.bin === b;

          return (
            <button
              key={b}
              disabled={disabled}
              onClick={() => setChartState({ bin: b })}
              title={disabled ? 'no cached bins at this resolution' : undefined}
              style={{
                ...binStyle,
                background: active ? '#2b6cb0' : '#1a1d23',
                color: disabled ? '#3f4551' : '#e8e8e8',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {b === AUTO && active ? `${AUTO} · ${resolved}` : b}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** ISO instant → the `YYYY-MM-DDTHH:MM` a datetime-local input expects. */
function local(iso: string): string {
  return iso.slice(0, 16);
}

function fromLocal(value: string): string {
  return value ? `${value}:00.000Z` : value;
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: 6,
  background: '#12151a',
  borderBottom: '1px solid #1c2027',
  flexWrap: 'wrap',
  flex: '0 0 auto',
};

const inputStyle: React.CSSProperties = {
  background: '#1a1d23',
  color: '#e8e8e8',
  border: '1px solid #2c313a',
  borderRadius: 4,
  padding: '3px 6px',
  font: '12px system-ui',
};

const binStyle: React.CSSProperties = {
  border: '1px solid #2c313a',
  borderRadius: 3,
  padding: '3px 7px',
  font: '11px system-ui',
};
