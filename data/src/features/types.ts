/** Data source a feature aggregates from (its Parquet tier). */
export type FeatureSource = 'trade' | 'quote';

/**
 * A market-microstructure feature computed by aggregating a source Parquet
 * (trade / quote) into a per-minute series. `agg` is a DuckDB SQL expression
 * over that source's raw columns, evaluated inside a `GROUP BY minute`. The
 * output lands in the same per-indicator cache shape as the bins indicators,
 * so the UI treats all of them uniformly.
 */
export interface FeatureSpec {
  /** Cache id / filename, convention `<src>f_<name>_1m` (e.g. `tf_imbalance_1m`). */
  id: string;
  source: FeatureSource;
  family: string;
  label: string;
  pane: string;
  kind: 'line' | 'area';
  color: string;
  /** DuckDB aggregate expression over the source's raw columns → the per-minute value. */
  agg: string;
}
