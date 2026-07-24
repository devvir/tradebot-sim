import type { FeatureSpec } from './types';

/**
 * Microstructure feature registry — trade & quote families. Each `agg` is a
 * DuckDB expression evaluated inside `GROUP BY minute`. Raw per-minute values
 * (unsmoothed); smoothing is a later post-process if wanted. Adding a feature
 * is one spec; the pipeline computes every feature of a source in a single
 * scan.
 *
 * Trade columns: side ('Buy'/'Sell' = aggressor), size, price, symbol, timestamp.
 * Quote columns: bidSize, bidPrice, askPrice, askSize, symbol, timestamp.
 */

const C = ['#3987e5', '#199e70', '#d55181', '#c98500', '#d95926', '#9085e9', '#2ab7ca', '#e66767'];

/** Trade tick features — the signed-flow family bins cannot give (aggressor side). */
const TRADE: FeatureSpec[] = [
  { id: 'tf_imbalance_1m', source: 'trade', family: 'order-flow', label: 'Order-flow imbalance', pane: 'flow', kind: 'line', color: C[0],
    agg: `(sum(size) FILTER (WHERE side = 'Buy') - sum(size) FILTER (WHERE side = 'Sell')) / nullif(sum(size), 0)` },
  { id: 'tf_aggressor_1m', source: 'trade', family: 'order-flow', label: 'Aggressor ratio (buy share)', pane: 'flow', kind: 'line', color: C[1],
    agg: `sum(size) FILTER (WHERE side = 'Buy') / nullif(sum(size), 0)` },
  { id: 'tf_delta_1m', source: 'trade', family: 'order-flow', label: 'Signed net volume (delta)', pane: 'delta', kind: 'area', color: C[4],
    agg: `sum(CASE WHEN side = 'Buy' THEN size ELSE -size END)` },
  { id: 'tf_buyvol_1m', source: 'trade', family: 'volume', label: 'Buy (aggressor) volume', pane: 'tradevol', kind: 'area', color: C[1],
    agg: `sum(size) FILTER (WHERE side = 'Buy')` },
  { id: 'tf_sellvol_1m', source: 'trade', family: 'volume', label: 'Sell (aggressor) volume', pane: 'tradevol', kind: 'area', color: C[7],
    agg: `sum(size) FILTER (WHERE side = 'Sell')` },
  { id: 'tf_trades_1m', source: 'trade', family: 'activity', label: 'Trade count', pane: 'tradecount', kind: 'area', color: C[5],
    agg: `count(*)` },
  { id: 'tf_avgsize_1m', source: 'trade', family: 'trade-size', label: 'Avg trade size (exact, ticks)', pane: 'tradesize', kind: 'area', color: C[3],
    agg: `avg(size)` },
  { id: 'tf_maxsize_1m', source: 'trade', family: 'trade-size', label: 'Max trade size (whale print)', pane: 'tradesize', kind: 'line', color: C[2],
    agg: `max(size)` },
  { id: 'tf_p95size_1m', source: 'trade', family: 'trade-size', label: 'Trade size p95', pane: 'tradesize', kind: 'line', color: C[6],
    agg: `approx_quantile(size, 0.95)` },
  { id: 'tf_vwapdev_1m', source: 'trade', family: 'value', label: 'Close vs trade-VWAP', pane: 'tvwapdev', kind: 'line', color: C[0],
    agg: `(last(price ORDER BY timestamp) - sum(price * size) / nullif(sum(size), 0)) / nullif(last(price ORDER BY timestamp), 0)` },
];

/** Quote features — spread / imbalance / microprice / churn. */
const QUOTE: FeatureSpec[] = [
  { id: 'qf_spread_1m', source: 'quote', family: 'spread', label: 'Bid-ask spread (avg, USD)', pane: 'spread', kind: 'line', color: C[0],
    agg: `avg(askPrice - bidPrice)` },
  { id: 'qf_spread_max_1m', source: 'quote', family: 'spread', label: 'Bid-ask spread (max, USD)', pane: 'spread', kind: 'line', color: C[2],
    agg: `max(askPrice - bidPrice)` },
  { id: 'qf_spread_rel_1m', source: 'quote', family: 'spread', label: 'Relative spread (frac)', pane: 'spreadrel', kind: 'area', color: C[4],
    agg: `avg((askPrice - bidPrice) / nullif((askPrice + bidPrice) / 2, 0))` },
  { id: 'qf_imbalance_1m', source: 'quote', family: 'quote-imbalance', label: 'Top-of-book imbalance', pane: 'qimb', kind: 'line', color: C[1],
    agg: `avg((bidSize - askSize) / nullif(bidSize + askSize, 0))` },
  { id: 'qf_microdev_1m', source: 'quote', family: 'microprice', label: 'Microprice − mid (lean)', pane: 'micro', kind: 'line', color: C[5],
    agg: `avg((bidPrice * askSize + askPrice * bidSize) / nullif(bidSize + askSize, 0) - (bidPrice + askPrice) / 2)` },
  { id: 'qf_quotes_1m', source: 'quote', family: 'quote-churn', label: 'Quote update count (churn)', pane: 'qchurn', kind: 'area', color: C[6],
    agg: `count(*)` },
  { id: 'qf_midvol_1m', source: 'quote', family: 'volatility', label: 'Mid micro-volatility (stdev)', pane: 'midvol', kind: 'area', color: C[3],
    agg: `stddev((bidPrice + askPrice) / 2)` },
];

export const FEATURES: FeatureSpec[] = [...TRADE, ...QUOTE];
