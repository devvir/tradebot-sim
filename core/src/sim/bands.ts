import { GATE_CHECK_ORDER } from '../types';

import type { Band, BandParams, BandsResult, GateCheck } from '../types';

/**
 * Stateful gate tracker layering band-DYNAMICS checks over computeBands's
 * position checks. A level jump makes the position checks maximally
 * permissive (the outer swallows the new level while the trimmed inner
 * ignores it), so two dynamics red flags close the gate instead:
 *
 * - jump: the current inner band must fit inside the outer band as it was
 *   jumpLookback minutes ago — slow drift passes, jumps fail;
 * - expansion: current outer width must stay under expansionMax × its
 *   rolling average over expansionLookback minutes.
 *
 * Feed update() once per bin, in time order. sampleMinutes scales the
 * lookbacks when bins are coarser than 1m.
 */
export class BandGateTracker {
  private rawHistory: { inner: Band; outer: Band }[] = [];
  private widthHistory: number[] = [];
  private mergeSamples: number;
  private jumpSamples: number;
  private expansionSamples: number;
  private cooldownSamples: number;
  private sampleIndex = 0;
  private lastOutsideAt = -Infinity;

  constructor(private params: BandParams, sampleMinutes = 1) {
    this.mergeSamples = params.mergeLookback > 0 ? Math.max(1, Math.round(params.mergeLookback / sampleMinutes)) : 0;
    this.jumpSamples = Math.max(2, Math.round(params.jumpLookback / sampleMinutes));
    this.expansionSamples = Math.max(2, Math.round(params.expansionLookback / sampleMinutes));
    this.cooldownSamples = Math.round(params.crossCooldown / sampleMinutes);
  }

  update(raw: BandsResult, close?: number): BandsResult {
    this.sampleIndex++;

    let inner = raw.inner;
    let outer = raw.outer;

    /** 1. Temporal merge: only the region both moments endorse. */
    let failDisagreement = false;
    const mergeIdx = this.rawHistory.length - this.mergeSamples;

    if (this.mergeSamples > 0 && mergeIdx >= 0) {
      const old = this.rawHistory[mergeIdx];
      const wNow = 1 / Math.max(1e-6, this.params.mergeWeightNow);
      const wPast = 1 / Math.max(1e-6, this.params.mergeWeightPast);
      const mInner = intersect(widenBand(inner, wNow), widenBand(old.inner, wPast));
      const mOuter = intersect(widenBand(outer, wNow), widenBand(old.outer, wPast));

      if (! mInner || ! mOuter) {
        failDisagreement = true;
      } else {
        inner = mInner;
        outer = mOuter;
      }
    }

    /** 2. Working outer is at least outerMinRatio × the inner width. */
    const innerWidthAbs = inner.top - inner.bottom;
    const outerWidthAbs = outer.top - outer.bottom;

    if (outerWidthAbs < innerWidthAbs * this.params.outerMinRatio) {
      outer = widenBand(outer, (innerWidthAbs * this.params.outerMinRatio) / Math.max(1e-12, outerWidthAbs));
    }

    /**
     * Evaluate EVERY check (no short-circuit) so the gate decomposes into
     * its components for visualization. gateOpen is still all-pass, and
     * gateFail is the first failure in precedence order — so downstream
     * (sim) behavior is unchanged.
     */
    const innerWidthRel = (inner.top - inner.bottom) / ((inner.top + inner.bottom) / 2);
    const failInnerWidth = innerWidthRel > this.params.maxInnerWidth;
    const failContainment = inner.bottom < outer.bottom || inner.top > outer.top;

    const jumpIdx = this.rawHistory.length - this.jumpSamples;
    const failJump =
      jumpIdx >= 0 &&
      (inner.bottom < this.rawHistory[jumpIdx].outer.bottom || inner.top > this.rawHistory[jumpIdx].outer.top);

    const width = (outer.top - outer.bottom) / ((outer.top + outer.bottom) / 2);
    let failExpansion = false;

    if (this.widthHistory.length >= this.expansionSamples / 2) {
      const avg = this.widthHistory.reduce((s, w) => s + w, 0) / this.widthHistory.length;

      failExpansion = width > this.params.expansionMax * avg;
    }

    if (close !== undefined && (close > outer.top || close < outer.bottom)) {
      this.lastOutsideAt = this.sampleIndex;
    }

    const failCooldown =
      this.cooldownSamples > 0 && this.sampleIndex - this.lastOutsideAt < this.cooldownSamples;

    /** checks: true = passing. Order defines gateFail precedence. */
    const checks: Record<GateCheck, boolean> = {
      disagreement: ! failDisagreement,
      'inner-width': ! failInnerWidth,
      containment: ! failContainment,
      jump: ! failJump,
      expansion: ! failExpansion,
      cooldown: ! failCooldown,
    };

    let gateFail: BandsResult['gateFail'];

    for (const check of GATE_CHECK_ORDER) {
      if (! checks[check]) {
        gateFail = check;
        break;
      }
    }

    this.rawHistory.push({ inner: raw.inner, outer: raw.outer });

    const keep = Math.max(this.mergeSamples, this.jumpSamples);

    if (this.rawHistory.length > keep) {
      this.rawHistory.shift();
    }

    this.widthHistory.push(width);

    if (this.widthHistory.length > this.expansionSamples) {
      this.widthHistory.shift();
    }

    return { inner, outer, gateOpen: ! gateFail, gateFail, checks };
  }
}

/** Widen a band's width by `factor` around its mid (merge-weight loosening). */
function widenBand(band: Band, factor: number): Band {
  const center = (band.top + band.bottom) / 2;

  return {
    bottom: center - (center - band.bottom) * factor,
    top: center + (band.top - center) * factor,
  };
}

/** Intersection of two bands; undefined when disjoint. */
function intersect(a: Band, b: Band): Band | undefined {
  const bottom = Math.max(a.bottom, b.bottom);
  const top = Math.min(a.top, b.top);

  return top > bottom ? { bottom, top } : undefined;
}

/**
 * Naive v2 band calculator (NAIVE.md).
 *
 * Inner band: the zone where price has been `innerOccupancy` (80%) of the
 * time over `innerWindow` minutes — the time-weighted symmetric percentile
 * interval of 1m closes (e.g. [p10, p90] for 80%). ("Shortest interval
 * containing 80%" is a known alternative, deferred.)
 *
 * Outer band: the zone holding `outerOccupancy` of the last `outerWindow`
 * minutes (strict min low/max high at occupancy 1), **capped at `outerCap`
 * width** centered on its own mid — "min(3%, 100% of last 6h)".
 *
 * Gate: inner width ≤ maxInnerWidth (wider = wait), and inner ⊆ outer
 * (containment fails after a recent relocation — exactly when price hasn't
 * settled). The outer band needs no width gate: it is capped by
 * construction.
 *
 * Inputs are the trailing windows as plain arrays; the caller owns
 * windowing. `closes` length should be innerWindow, `lows`/`highs` length
 * outerWindow.
 */
export function computeBands(
  closes: number[],
  lows: number[],
  highs: number[],
  params: BandParams,
): BandsResult {
  const inner = percentileBand(closes, params.innerOccupancy);
  const outer = capBand(widen(rawOuter(lows, highs, params.outerOccupancy), params.outerLeniency), params.outerCap);

  const innerWidth = (inner.top - inner.bottom) / mid(inner);

  let gateFail: BandsResult['gateFail'];

  if (innerWidth > params.maxInnerWidth) {
    gateFail = 'inner-width';
  } else if (inner.bottom < outer.bottom || inner.top > outer.top) {
    gateFail = 'containment';
  }

  return { inner, outer, gateOpen: ! gateFail, gateFail };
}

function rawOuter(lows: number[], highs: number[], occupancy: number): Band {
  if (occupancy >= 1) {
    return { bottom: Math.min(...lows), top: Math.max(...highs) };
  }

  const sortedLows = [...lows].sort((a, b) => a - b);
  const sortedHighs = [...highs].sort((a, b) => a - b);
  const tail = (1 - occupancy) / 2;

  return {
    bottom: sortedLows[Math.round(tail * (sortedLows.length - 1))],
    top: sortedHighs[Math.round((1 - tail) * (sortedHighs.length - 1))],
  };
}

/** Widen a band's width by `factor` around its mid (the leniency for re-tested levels). */
function widen(band: Band, factor: number): Band {
  const center = (band.top + band.bottom) / 2;

  return {
    bottom: center - (center - band.bottom) * factor,
    top: center + (band.top - center) * factor,
  };
}

function capBand(band: Band, cap: number): Band {
  const center = mid(band);
  const width = (band.top - band.bottom) / center;

  if (width <= cap) {
    return band;
  }

  return { bottom: center * (1 - cap / 2), top: center * (1 + cap / 2) };
}

function percentileBand(closes: number[], occupancy: number): Band {
  const sorted = [...closes].sort((a, b) => a - b);
  const tail = (1 - occupancy) / 2;
  const lo = Math.round(tail * (sorted.length - 1));
  const hi = Math.round((1 - tail) * (sorted.length - 1));

  return { bottom: sorted[lo], top: sorted[hi] };
}

function mid(band: Band): number {
  return (band.top + band.bottom) / 2;
}
