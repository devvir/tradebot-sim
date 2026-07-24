# Barrier Predictor

Directional predictor for small, bracketed trades: given the current price and a
pair of exit levels, estimate the probability that the upper level is reached
before the lower one, within a bounded forward horizon.

This is the decision function for range-scalper entries. It answers "should I
take this trade, at what target, and with what stop" as a single calibrated
probability rather than a score.

## 1. The question, stated precisely

For a current price `c`, an up barrier `U = c + u`, a down barrier `L = c - l`,
and a forward horizon `H`:

```
p = P(price touches U before it touches L, within H)
```

Three constraints make this well-posed, and all three are required:

- **A horizon.** Without `H`, any level is reached with probability 1 given
  enough time. `H` is what makes the answer non-trivial.
- **A competing barrier.** A single level is a survival question; two levels are
  a race. The race is what a bracketed trade actually is.
- **A reference point.** `c` is the fill price, not the mid or the last trade.

Outcomes are ternary: `UP` (U first), `DOWN` (L first), `TIMEOUT` (neither
within H). Timeouts are modelled explicitly, never dropped — discarding them
biases the estimate toward whichever barrier is nearer.

Monotonicity is structural, not imposed: reaching `U` implies having passed
every level between `c` and `U`, so `p` is automatically non-increasing in `u`
and non-decreasing in `l`. No constraint needs to be added to enforce it.

## 2. The baseline, and why it is the centre of the design

If price is a martingale over the window, the identity
`p·U + (1-p)·L = c` forces:

```
p₀ = (c - L) / (U - L) = l / (u + l)
```

This is the **null hypothesis**, not an assumption about the market. It is not a
symmetry assumption — it produces strongly asymmetric probabilities whenever the
barriers are asymmetric (a near barrier is likely, a far barrier is not). What
it forbids is a *specific number* for that asymmetry.

Two consequences drive everything downstream.

**Barrier geometry is EV-neutral.** With round-trip fee `F`, expected value
under the null is:

```
EV = p₀(u - F) - (1 - p₀)(l + F) = -F     for every choice of u and l
```

Exactly the fee, always. No configuration of target and stop improves it. You
cannot engineer profitability from the payoff ratio; only genuine predictive
edge pays.

**The required edge is fixed by the barrier span.** Profitability requires
`p > (l + F)/(u + l)`, so the edge needed over the null is:

```
required edge = F / (u + l)
```

| barriers (u, l) | span | required edge over null |
| --- | --- | --- |
| 0.2% / 0.1% | 0.3% | +33 pp |
| 0.5% / 0.3% | 0.8% | +12.5 pp |
| 1.5% / 1.0% | 2.5% | +4 pp |
| 3% / 2% | 5% | +2 pp |

Documented short-horizon predictability in liquid crypto is on the order of 1–3
percentage points. **Narrow barriers are therefore not tradeable as taker.**
Widening the span is the highest-leverage parameter available, and it costs only
trade frequency.

## 3. Model

Two layers. The first is free; the second is the only part that learns.

**Layer 1 — geometric offset.** Compute `p₀` in closed form.

**Layer 2 — deviation model.** A logistic regression on the binary `UP` vs
`DOWN` outcome, with `logit(p₀)` as a **fixed offset** (coefficient pinned to 1,
not fitted):

```
logit(p) = logit(p₀) + β·features
```

The offset absorbs everything that is pure geometry, so the fitted coefficients
describe only the departure from a martingale — which is the entire information
content. The output is a calibrated probability, directly usable for sizing.

Timeouts are handled as a separate head (a second model for `P(TIMEOUT)`), with
the UP/DOWN model fitted conditional on resolution.

### Why this over the alternatives

- **Raw empirical frequency per barrier pair** — step function, needs a separate
  estimate per `(u, l)`, and reads zero for anything never observed. Unusable in
  the tail.
- **Closed-form drift/diffusion** (`p = (1 - e^(-2μ(c-L)/σ²)) / (1 - e^(-2μ(u+l)/σ²))`)
  — elegant, gives the whole continuous surface from one parameter `μ_eff`, but
  assumes Brownian motion and so misses jumps and overshoot. **Keep it as a
  sanity check**, not the production estimator.
- **Logistic with offset** — flexible enough for jumps and fat tails, cheap,
  calibrated, and generalises across barrier scales when scale is a feature.

### Features

Barrier scale must be among them, otherwise the model cannot generalise across
`X` (see §5):

- `(u + l) / (σ·√H)` — barrier span in volatility units
- `u / l` — asymmetry ratio
- signed trade flow, EW-weighted, ~10 s half-life
- order-book imbalance (orderBookL2 is available and is the best-documented
  short-horizon predictor; price alone is much weaker)
- realized volatility, EW, ~5 min half-life
- range position: distance to detected range high/low, normalised
- range age and touch count

All features are **exponentially weighted**, with half-lives matched to their own
timescale. Plain rolling windows weight a 30-minute-old tick identically to the
last one and then drop it off a cliff; EW decay is the correct model of
information staleness.

### Labels

Triple-barrier labeling. For each anchor, walk forward until `U`, `L`, or `H`,
and record which came first. One linear sweep over history.

## 4. Parameters

**Clock — use tick time, not wall-clock.** Trade-count time is a rough
volatility clock; returns sampled per-N-trades are closer to stationary and
Gaussian than per-N-seconds (Ané–Geman subordination). Wall-clock drags in
intraday volatility seasonality and dead zones as noise to be conditioned away
later. Keep wall-clock only as a comparison.

**Lookback — three scales, not one:**

| scale | span | carries |
| --- | --- | --- |
| fast | 5–30 s | order flow, immediate pressure |
| structural | 10–30 min | the range: bounds, age, touch count |
| regime | 2–6 h | is volatility normal, is the range real |

For trades exiting in seconds to minutes, the **structural window dominates**,
and 10–30 minutes is the starting point. Long lookbacks (hours+) describe a
regime that has already ended and are actively harmful at this trade horizon.

The edge-vs-lookback curve is an inverted U — too short is noise, too long is
stale. Sweep the structural window over 2/5/10/30/60 min and read where it
peaks; do not fix it by taste.

**Forward horizon.** Time-to-touch scales as `(barrier / σ_per_tick)²`. Set
`H ≈ 2–4×` the expected touch time, then tune so the timeout fraction lands
around 10–20%. Too short and most labels are timeouts and carry nothing; too
long and barriers get hit by drift the features never saw.

> Sizing note: a per-second σ of ~0.01% for XBTUSD (implying ~225 s to touch a
> 0.15% barrier) is a √t extrapolation from an assumed 2–3% daily vol. It is an
> unverified estimate used only to bracket the search — measure it on the actual
> bins before fixing `H`.

**Model refresh.** Coefficients go stale as the regime shifts. Refit on a
rolling window of days, and monitor calibration drift.

## 5. Scanning the target: one fit, many X

The target parametrization of interest is `target = c + 2X`, `stop = c - X`,
scanned over `X ∈ [0.15%, 0.5%]`.

**The null is scale-invariant under this parametrization:**

```
p₀ = X / (2X + X) = 1/3     for every X
```

The geometric term cancels completely, so **any variation of `p` with `X` is
pure signal** — jump structure, volatility term structure, range structure. This
makes the X-scan the cleanest available experiment on non-martingale behaviour.

A single fitted model covers the whole range, provided barrier scale is a
feature. Evaluate on a grid of ~20 values of `X`; each point is one dot product
plus a sigmoid, so the full curve costs microseconds.

**The objective is not maximum `p`.** `p` falls monotonically with `X`, so
maximising it drives `X → 0` where fees dominate. Expected value is:

```
EV(X) = X·(3p(X) - 1) - F
```

Profitable when `p > 1/3 + F/(3X)`. Because holding time scales as `X²`,
throughput matters for a scalper, and EV per unit time peaks at:

```
X* ≈ 2F / (3p - 1)
```

With `F = 0.1%`: `p = 0.45 → X* ≈ 0.57%`; `p = 0.50 → X* ≈ 0.40%`. The optimum
sits at or above the top of the 0.15–0.5% range. The low end needs `p > 55%` to
break even and is very unlikely to be reachable.

Report both `EV(X)` and `EV(X)/E[time]`, and pick from the curve.

## 6. Runtime cost

Per tick:

- rolling max/min — monotonic deque, O(1) amortised
- EW features — O(1), a handful of multiply-adds
- range detection — O(1) incremental
- prediction — one dot product over ~10 features, plus a sigmoid
- full X-scan — ~20× the above

Sub-microsecond per tick. Real-time cost is a non-issue. The expensive work is
the offline labeling sweep, which runs once per refit.

## 7. Risks

- **Overlapping windows destroy effective sample size.** N anchors with horizon
  H share overlapping paths; effective N is closer to `N/H`. Naive binomial
  confidence intervals will be far too narrow. **Use block bootstrap** for every
  reported interval. With deviations this small, this is the difference between
  an edge and noise.
- **Fees dominate prediction.** At these barrier sizes the fee term is the same
  order as the payoff. A 2 pp forecasting edge is worth ~0.006%/trade; a maker
  rebate instead of a taker fee is worth ~0.2%/trade — roughly thirty times more.
  **Settle whether passive fills are achievable at the entry before investing in
  the model.** If `F` goes negative, the null itself is profitable.
- **Repeated tests weaken a level, not strengthen it.** Each touch consumes
  resting liquidity; in most measured datasets the Nth test breaks more readily
  than the first. Do not encode "the range held many times" as bullish — let the
  touch-count coefficient be fitted, and expect its sign to be unfavourable.
- **Every range looks unbreakable until it breaks**, and the break is exactly
  when the loss lands. The quantity that matters is not "has the floor held" but
  "what fraction of ranges of this age and touch count break within H" — a
  survival estimate over ranges, and it must be measured, not assumed.
- **Jump overshoot breaks the null even at zero drift.** The martingale identity
  uses the price at the moment of touching, not the barrier level. Crypto gaps
  downward harder than upward, which pushes `p` below `p₀` structurally. This is
  the deviation most likely to be real in the data, and it works against the long
  side.
- **Unconditional estimates are just volatility restated.** With no conditioning,
  this reduces to an expensive, noisy volatility estimator. All information is in
  the conditioning.

## 8. Build order

1. **Triple-barrier labeler** over 1s bins (and tick time), producing
   `(UP, DOWN, TIMEOUT)` per anchor for a grid of `(u, l)`.
2. **Null comparison**: realized `p` versus `p₀`, with block-bootstrap CIs, swept
   across span from 0.3% to 5%. Plot the deviation against the `F/(u+l)`
   requirement curve. **This single plot decides whether a tradeable region
   exists**, and it gates everything after it.
3. **X-scan** at fixed 2:1 ratio over 0.15–0.5%, confirming the `p₀ = 1/3`
   invariance empirically and exposing the pure-signal curve.
4. **Feature builder** with EW half-lives; lookback sweep to locate the inverted-U
   peak.
5. **Logistic with offset**, timeout head, calibration check (reliability
   diagram), out-of-sample validation on a held-out later period.
6. **`EV(X)` and `EV(X)/E[time]` curves** for target selection.

Validate on small isolated slices first — a few days of XBTUSD is enough for
step 2. Do not sweep the full vault to answer a question a few days can answer.
