# Research notes

Empirical findings and the questions they open. Not a build plan — things
measured on real data, kept so they are not re-measured or half-remembered.

**Every topic here stays open unless it says otherwise.** A number measured once
is a starting point, not a conclusion.

## These are not BitMEX patterns

Measurements are run on BitMEX because that is the data on hand. The findings
are almost certainly **not venue-specific**: price action is global, the same
participants trade Binance, Coinbase and BitMEX, and they react to the same
signals — whether mechanical or tacitly agreed. Expect these to be *bitcoin*
patterns, and probably crypto patterns generally.

That gives a concrete test rather than an assumption. A venue artifact — fee
schedule, liquidation engine, tick size, a quirk of one matching engine — will
**not** reproduce elsewhere. A real pattern will. So cross-venue agreement
separates the two, and disagreement is itself a finding worth chasing.

Doing it needs data we do not have yet: another venue's trades, at least for a
sample period. Worth pricing up before any result here is leaned on heavily.

## Why look for patterns like these

Two different things can make a pattern work, and they behave differently:

- **Mechanical tension** — dojis, head and shoulders, flags. The shape reflects
  a real imbalance between buyers and sellers, so it would work even if nobody
  had a name for it.
- **Coordination** — the pattern works because enough participants expect it to
  and trade accordingly. "It already broke up; even on a deep retrace we are
  going up." Self-fulfilling, and none the less real for it.

The range-extension result below looks like the second kind. That matters for
how it is treated:

- A coordination pattern is only as durable as the belief behind it, so it can
  decay. Do not report one aggregate number, and do not split into arbitrary
  eras either — **compute the statistic as a rolling series** (weekly, smoothed)
  so its evolution is visible as a curve: stable, drifting, or dying.

  This costs nothing architecturally: a rolling pattern statistic *is* a cached
  series, so it renders in the indicator panes like anything else. Pattern
  research and the charting platform are the same machinery.
- It should be **stronger where the crowd is watching**: round numbers, session
  boundaries, obvious levels, popular timeframes. If an effect is invisible at
  1h but present at 4h and 1d, that is a signal about who is looking, and a way
  to tell the two kinds apart.
- Expect these to be **plentiful and individually small**. The search is worth
  systematising rather than doing ad hoc — which is what this file is for.

## Range extension: does a bar that breaks one side also break the other?

**Status: open — actively being investigated, not concluded.** The numbers below
are the first pass. The open questions at the end are the work, not footnotes.

Measured 2026-07-23, XBTUSD, full history, BitMEX calendar bars.

**Unconditional, per bar vs its predecessor:**

| | bars | outside (breaks both) | inside (breaks neither) |
| --- | --- | --- | --- |
| 1h | 94,096 | 10.3% | 20.2% |
| 1d | 3,930 | 10.5% | 21.6% |

Remarkably stable across timeframes, ~1:2 outside:inside at both.

**Conditional — given one side is broken, the other holds ~87%** of the time
(1h; 88% at 1d). But that average hides the shape, which is what matters:

| first cross at | bars | other side holds |
| --- | --- | --- |
| minute 1 | 13,177 | **80.3%** |
| minutes 2–10 | ~25,000 | 83–85% |
| minutes 11–20 | ~14,000 | 86–92% |
| minutes 21–40 | ~14,000 | 92–98% |
| minutes 41–60 | ~7,000 | 98–100% |

The rise toward 100% is mostly arithmetic — a bar crossing at minute 59 has no
time left to reverse. The tradeable figure is the **~80%** at the top, since
that is when the signal actually arrives.

### Break margin — requiring a decisive break

Same data, but the break must exceed the previous extreme by a margin, and the
*opposite* extreme is tested exactly (no margin), only from the break onward —
the tradeable conditioning.

| break margin | events | opposite extreme holds |
| --- | --- | --- |
| 0% (any touch) | 76,106 | 87.3% |
| 0.05% | 67,311 | 90.5% |
| **0.1%** | 59,118 | **92.1%** |
| 0.2% | 45,300 | 93.6% |
| 0.5% | 22,950 | 95.5% |

0.1% of margin buys ~5 points of hold rate while keeping 78% of events; beyond
that it is diminishing (0.5% buys 3.4 more points but discards 70% of events).
Note the entry cost moves the other way: breaking in at `prev_high x 1.001`
concedes 0.1% of the move before fees, so the margin maximizing *hold rate* is
not the one maximizing EV.

### Stability over time

Hold rate at 0.1% margin, by year — the evolution rather than one number:

| | | | | | |
| --- | --- | --- | --- | --- | --- |
| 2015 | 90.9 | 2019 | 90.8 | 2023 | 91.9 |
| 2016 | 91.9 | 2020 | 91.4 | 2024 | 93.3 |
| 2017 | 93.7 | 2021 | 90.3 | 2025 | 93.8 |
| 2018 | 92.9 | 2022 | 91.1 | 2026 | 92.8 |

**90.3–93.8% across eleven years**, no decay, a slight upward drift. That range
covers BitMEX from niche venue to institutional crypto and two full cycles, with
a completely turned-over participant mix. A purely belief-driven effect would be
expected to erode over that; this looks closer to mechanical tension, or to
coordination entrenched enough to behave like it.

Worth redoing weekly and smoothed before trusting the shape — yearly buckets can
hide within-year swings.

### Open questions

- **Does it depend on candle size?** Body or full range. Almost certainly not
  absolute size — a $50 range means different things in 2015 and 2024 — but size
  **relative to a local average**. Which raises: how long a lookback defines
  "local", and how far back is still relevant? Worth sweeping rather than
  guessing.
- **Regime dependence.** These numbers pool 2015 with 2024, trending with
  ranging. Splitting by realized volatility, or by the range gate, would likely
  spread them considerably.
- **Minute-1 crossings are real, not gaps.** (Corrected: BitMEX opens each bar
  at the previous close, and a close always sits inside its own bar's range, so
  a bar can never open beyond the previous extreme. There are no gap-opens.)
  They are genuine intrabar moves in the first minute — but they are also the
  bucket with the weakest hold rate, so worth understanding rather than
  discarding.
- **Payoff asymmetry is unmeasured.** Frequency is only half of it: crossing the
  opposite extreme means at least the previous bar's full range against the
  position. An 80/20 split with a 1:2+ adverse excursion is not automatically
  positive, and round-trip fees are 0.10%. Measure the distribution of adverse
  excursion, not just the hit rate.
- Rerun on 1d, and on other liquid symbols, to see whether the stability across
  timeframes also holds across instruments.
- **Cross-venue check** (see the section above) — the strongest available test of
  whether this is real or a BitMEX artifact. Needs data from another exchange.
- **Weekly rolling series, smoothed**, rather than the yearly buckets above, so
  the shape of the evolution is visible rather than inferred.
- **Does direction matter?** Up-breaks and down-breaks are pooled here. Crypto
  is not symmetric — worth separating.
- **Which side gets broken first**, and whether the hold rate depends on where
  in the previous bar's range the close sat.
