/** All PoC types live here (project rule: types in types.ts, no exceptions). */

export interface PocConfig {
  dbUri: string;
  vaultDir: string;
  pocDir: string;
}

/** A bin ladder entry: the DuckDB bucket interval and the cached base table it aggregates from. */
export interface BinSpec {
  interval: string;
  source: string;
}

export interface Bin1m {
  t: string;
  open: number;
  high: number;
  low: number;
  close: number;
  trades: number;
  volume: number;
  vwap: number;
}

export interface ExtractBinsOptions {
  symbol: string;
  from?: string;
  to?: string;
  /** Bin interval: '1m' (default) or '5m'. */
  interval?: string;
}

export interface ExtractWindowOptions {
  table: string;
  symbol: string;
  from: string;
  to: string;
}

export interface ImportOptions {
  /** Source tables to import: 'quote' and/or 'trade'. */
  tables: string[];
  /** Restrict to these years; empty = every year present under raw/<table>/. */
  years: string[];
  /** Re-import years whose output already exists (needed when a partial year grows). */
  force: boolean;
  /** Latest day to include, YYYYMMDD. Days after this are skipped. */
  until?: string;
}

export interface ApiCandle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** One point of a cached series, aligned to the requested bin. */
export interface ApiPoint {
  t: string;
  v: number | null;
}

/** An indicator the UI may render: registered AND cached for this symbol. */
export interface ApiIndicator {
  id: string;
  label: string;
  family: string;
  tf: string;
  pane: string;
  kind: string;
  color: string;
  defaultVisible: boolean;
  /** pane === 'price' — draws on the candle chart rather than its own. */
  overlay: boolean;
  /**
   * Whether this indicator is meant to be precomputed to disk. The UI must not
   * warn that a `cached: false` indicator is missing from disk — its absence is
   * by design (it is derived on read).
   */
  cached: boolean;
}

export interface MakeBinsOptions {
  /** Bin interval to generate, e.g. '1s'. Only the finest is generated; the rest compose upward. */
  interval: string;
  /** Symbols to build; empty = every symbol with trade data. */
  symbols: string[];
  /** Years to build; empty = every year the trade table covers. */
  years: string[];
  force: boolean;
}

export interface DatasetTable {
  name: string;
  /** Years the table covers, ascending. */
  years: string[];
}

export interface ImportBinsOptions {
  /** Mongo bin collections to import, e.g. ['tradeBin1m', 'tradeBin5m']. */
  collections: string[];
  /** Restrict to these years; empty = every year the collection covers. */
  years: string[];
  /** Re-import years already recorded in the manifest. */
  force: boolean;
  /** Latest day to include, YYYYMMDD. */
  until?: string;
}

export interface PartitionResult {
  symbols: number;
  rows: number;
}

export interface ImportYearResult {
  table: string;
  year: string;
  symbols: number;
  rows: number;
  seconds: number;
}

export interface RangeParams {
  /** Formation window length, minutes. */
  window: number;
  /** Max relative amplitude (high-low)/mid for a window to qualify as range formation. */
  amplitude: number;
  /** Minutes the close must stay outside the band to confirm the range ended. */
  exitConfirm: number;
  /** Minimum total duration (minutes) for a candidate to be emitted. */
  minDuration: number;
  /** Fraction of band width near an edge that counts as touching it. */
  touchZone: number;
}

export interface RangeCandidate {
  symbol: string;
  start: string;
  end: string;
  top: number;
  bottom: number;
  /** Relative amplitude: (top - bottom) / mid. */
  amplitude: number;
  durationMin: number;
  touchesTop: number;
  touchesBottom: number;
  exitDirection: 'up' | 'down' | 'eof';
}

export interface RangesOptions {
  symbol: string;
  from: string;
  to: string;
  params: RangeParams;
}

export type Side = 'long' | 'short';

export interface BandParams {
  /** Inner band lookback, minutes (v1 anchor: 360 = 6h). */
  innerWindow: number;
  /** Fraction of time the inner band must contain (v1: 0.8). */
  innerOccupancy: number;
  /** Outer band lookback, minutes (v2 anchor: 360 = 6h). */
  outerWindow: number;
  /** Fraction of time the outer band must contain (1 = strict min/max; <1 trims short-lived wicks — time-based defense). */
  outerOccupancy: number;
  /** Width multiplier applied to the outer band around its mid (1.1 = 10% leniency, tolerating re-tests of a level — level-based defense). */
  outerLeniency: number;
  /** Max inner width, bottom to top, relative (v2: 0.02) — wider means wait. */
  maxInnerWidth: number;
  /** Outer band width cap, relative (v2: 0.03): outer = min(cap, 100% of lookback), centered on its own mid. */
  outerCap: number;
  /** Temporal merge: working bands = bands(now) ∩ bands(now − this many minutes); empty intersection closes the gate ('disagreement'). 0 = off. */
  mergeLookback: number;
  /** Merge weight of the current band: each epoch's band is widened by 1/weight about its mid before intersecting — 1 = full constraint, →0 = ignored. */
  mergeWeightNow: number;
  /** Merge weight of the past band (see mergeWeightNow). */
  mergeWeightPast: number;
  /** Jump check: current inner must fit inside the outer band as of this many minutes ago (cross-time containment; catches level jumps, tolerates drift). */
  jumpLookback: number;
  /** Expansion check: rolling-average window for outer width, minutes. */
  expansionLookback: number;
  /** Expansion check: gate closes when current outer width > this × rolling average. */
  expansionMax: number;
  /** Gate stays closed for this many minutes after the close was outside the working outer band ('cooldown'): if resuming would be bad, so is starting. */
  crossCooldown: number;
  /** Working outer band is widened to at least this × the inner width (prevents unnecessary storm exits when calm makes the outer hug the inner). */
  outerMinRatio: number;
}

export interface Band {
  bottom: number;
  top: number;
}

export type GateCheck = 'disagreement' | 'inner-width' | 'containment' | 'jump' | 'expansion' | 'cooldown';

/** Precedence order for gateFail (first failing check wins). */
export const GATE_CHECK_ORDER: readonly GateCheck[] = [
  'disagreement',
  'inner-width',
  'containment',
  'jump',
  'expansion',
  'cooldown',
];

export interface BandsResult {
  inner: Band;
  outer: Band;
  /** Whether the trading-range gate passes right now (all checks pass). */
  gateOpen: boolean;
  /** First failed check when the gate is closed (precedence: GATE_CHECK_ORDER). */
  gateFail?: GateCheck;
  /** Per-check status (true = passing) — the gate decomposed for visualization. */
  checks?: Record<GateCheck, boolean>;
}

/** One precomputed band point (per minute): inner/outer bounds + gate. */
export interface BandPoint {
  t: string;
  ib: number;
  it: number;
  ob: number;
  ot: number;
  /** Gate open this minute. */
  g: boolean;
  /** Gate-fail reason when closed. */
  f?: string;
}

export type SimMode = 'idle' | 'trading' | 'waiting' | 'frozen' | 'busted';

export interface SimParams {
  bands: BandParams;
  account: AccountParams;
  /** Initial wallet, XBT. */
  initialWallet: number;
  /** Max gross leverage per side (v1: 0.5). */
  maxLeverage: number;
  /** Carried-for-gain leverage per side (v1: 0.05); step size = this. */
  baseLeverage: number;
  /** Ladder span: extends distributed from entry to entry ± this (v3: 0.002) — NOT to the band edge. */
  ladderSpan: number;
  /** Fraction of max size kept past the breakeven de-risk (v3: 0.5 → 5C of 10C remain). */
  deriskKeep: number;
  /** First step-collect distance from blended entry (v3: 0.002). */
  collectStart: number;
  /** Spacing between step collects (v3: 0.001 → 0.2%, 0.3%, 0.4%… until consumed). */
  collectSpacing: number;
  /** Fee-gated re-extend distance after a leg is fully collected (v1: 0.001). */
  reEntry: number;
  /** Fee buffer over blended entry for breakeven de-risking (v1: 0.001). */
  breakevenBuffer: number;

  /** Account considered lost when availableMargin < this fraction of the initial wallet (v1: 0.2). */
  bustThreshold: number;

  /** Recompute bands at most every N minutes (v1: 1). */
  bandRefreshMin: number;

  /** Freeze only when price exceeds the outer band by this relative margin (0 = at the edge). */
  exitMargin: number;

  /** Consecutive minutes beyond the outer band (+margin) required to confirm a storm (1 = immediate). */
  exitConfirm: number;
}

/**
 * Strategy values as functions: constants today, calculations tomorrow
 * (periodic range updates, volatility-scaled sizing, etc.) without the
 * engine changing shape.
 */
export interface Strategy {
  /** Current bands, refreshed at most every bandRefreshMin. undefined until windows fill. */
  bands(closes: number[], lows: number[], highs: number[], minuteIndex: number): BandsResult | undefined;
  /** Contracts per ladder step for the current wallet/price. */
  stepContracts(wallet: number, price: number): number;
  ladderSpan(): number;
  deriskKeep(): number;
  collectStart(): number;
  collectSpacing(): number;
  reEntry(): number;
  breakevenBuffer(): number;
  bustFloor(): number;
  ladderSteps(): number;
}

export interface SimEvent {
  t: string;
  type: string;
  detail: string;
}

export interface HourlyRow {
  hour: string;
  priceMin: number;
  priceMax: number;
  walletMin: number;
  walletMax: number;
  equityMin: number;
  equityMax: number;
  uPnlMin: number;
  uPnlMax: number;
  availMin: number;
  availMax: number;
  /** Entries gap (longEntry − shortEntry) as a fraction of price; NaN when a leg is empty. */
  gapMin: number;
  gapMax: number;
  realized: number;
  feesPaid: number;
  trades: number;
  mode: SimMode;
}

export interface BatchOptions {
  symbol: string;
  /** Inclusive month bounds, "YYYY-MM". */
  fromMonth: string;
  toMonth: string;
  /** Fresh wallet per month, BTC (native unit — no USD anywhere). */
  initialBtc: number;
}

export interface BatchMonth {
  month: string;
  hours: number;
  /** Hourly equity in mBTC (mid of min/max), from month start. */
  equityMBtcSeries: number[];
  finalMBtc: number;
  /** Final equity as a fraction of the initial wallet. */
  finalXbtPct: number;
  minMBtc: number;
  maxMBtc: number;
  frozeAt?: string;
  bustedAt?: string;
  gapAtFreeze?: number;
  frozenUPnl?: number;
  fees: number;
  realized: number;
  events: number;
}

export interface SimResult {
  rows: HourlyRow[];
  events: SimEvent[];
  frozeAt?: string;
  bustedAt?: string;
  /** Entries gap as a fraction of price at the freeze moment. */
  gapAtFreeze?: number;
  /** uPnL locked in by the freeze (the frozen loss), XBT. */
  frozenUPnl?: number;
  finalSnapshot: AccountSnapshot;
}

export interface PositionLeg {
  /** Size in contracts (1 contract = 1 USD on XBTUSD). 0 = no position. */
  size: number;
  /** Average entry price (harmonic-blended for inverse contracts). 0 when size is 0. */
  avgEntry: number;
}

export interface AccountParams {
  /** Taker fee as a fraction of notional (0.0005 = 0.05%). */
  takerFee: number;
  /** Initial margin fraction per leg, charged gross (0.01 = 1% = 100x). */
  initMargin: number;
}

export interface AccountState {
  /** Wallet balance in XBT (settlement currency of XBTUSD). */
  wallet: number;
  long: PositionLeg;
  short: PositionLeg;
  /** Lifetime realized PnL in XBT (fees excluded; see feesPaid). */
  realized: number;
  /** Lifetime fees paid in XBT. */
  feesPaid: number;
}

export interface AccountSnapshot extends AccountState {
  /** Mark price the snapshot was taken at. */
  price: number;
  uPnlLong: number;
  uPnlShort: number;
  uPnl: number;
  /** Gross position margin (both legs, initMargin each) in XBT. */
  positionMargin: number;
  /** wallet + uPnl - positionMargin. */
  availableMargin: number;
  /** wallet + uPnl. */
  equity: number;
}
