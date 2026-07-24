# The Average Entry Price Is Not a Decision Input

**Fact.** The state of a position's average entry price at any given moment is
irrelevant to the decision of partially or completely collecting the position —
it should not affect the decision at all. "Never sell below breakeven" is not
caution; it is an anchor to a number that has no forward meaning.

Derived from [PNL.md](PNL.md), but important enough to stand on its own: it is the
single most common way a profitable exit gets vetoed for feeling like a loss.

## Why it is true

Three results from [PNL.md](PNL.md) close every angle:

1. **Forward irrelevance.** At any instant, the PnL still to come is decided
   entirely by future fills and the current net size. The average entry $\bar p$
   is a lien on the open position — bookkeeping that says how much of the
   conserved total is parked as unrealized — and it provably cancels out of every
   flat total (PNL.md Part 2). Two positions of equal size with different average
   entries have **identical** forward payoffs on every future price path; the
   difference between them is already in the wallet, unchangeable. A decision
   rule that reads $\bar p$ is reading the past.

2. **Endpoint equivalence.** Any two strategies that end up buying and selling
   the same totals at the same correctly-weighted average prices realize the same
   money (composition invariance, PNL.md Part 3) — regardless of which of them
   "sold at a loss" along the way and which waited for breakeven.

3. **Per-pair wins compose.** Pair each sell with the specific buy it collects
   (any pairing — pairings are partitions, PNL.md Theorem 5). If each pair
   individually clears the fee spread, the session total is a win by plain
   addition — whether or not any individual sell printed below the *blended*
   average entry at the time. Selling below $\bar p$ at a profit relative to the
   paired rung is a realized gain, full stop; the exchange's per-close posting
   may even show red ink for it, and the wallet still comes out ahead.

## The canonical example: laddering a dip inside an uptrend

Prognosis: long-term trend up, short-term profitable dip expected. Safer to buy
the dip in steps (capped at $C$) than to short it — the ladder needs no stop
unless the *long-term* call is wrong.

**The naive ladder** (what a human's gut and most naive market-maker bots do):
buy every few pips down; never sell below the settled average entry; wait for
price to recover past $\bar p$; collect in profit. Every collect is a gain —
that is its whole design constraint.

**The emancipated ladder**: buy every few pips down; for every rung bought, sell
at a gain *relative to that rung* on any bounce — even well below the blended
entry; freed cap re-buys lower as the dip continues; repeat while the prognosis
holds.

The comparison, on each outcome:

- **Price recovers to the naive breakeven.** If both ladders end with the same
  totals and average prices, they realize identical money (result 2) — the naive
  bot's "every collect was a gain" bought nothing. In practice they don't end
  equal: the emancipated ladder harvested the intermediate oscillations the
  naive one sat out, and its recycled cap tends to reach the recovery with
  larger $Q$ at lower average entry. Its "losses" were rung-profits (result 3).

- **The dip turns into a real drop.** Both ladders exit at the same invalidation
  point (the price where the dip thesis dies — the stop is the *prognosis*
  failing, not a distance from $\bar p$). The naive ladder rode it with its full
  accumulated position and collected nothing on the way; same or worse loss,
  held longer, at higher exposure.

**The full case analysis** — where each ladder can come out ahead:

- **Emancipated loses less, or equal, in every losing scenario.** At invalidation
  it holds same-or-smaller size at same-or-lower average, plus banked rung
  profits. It cannot lose more: its only deviations from the naive fill set are
  completed rung round-trips (positive by rule) and rebuys at lower prices.
  Equality is the bounce-free monotone drop, where both ladders executed
  identical fills.

- **Emancipated has a chance — not a certainty — of winning more in winning
  scenarios**: oscillation harvest plus recycled cap versus the naive full-size
  ride. A bounce-free V-recovery, or a runaway rally right after a rung-sell,
  favors the naive ladder.

- **When emancipated underperforms naive, both are in profit — provably.**
  Trailing naive *requires* that rung-sells happened (each profitable by rule)
  and that the price recovered (the held rungs won too); every component of the
  underperformance scenario is positive. The emancipated ladder's worst relative
  case exists only inside absolute wins.

As a risk profile: the emancipated ladder concedes part of the right tail only in
scenarios where both approaches profit, and cuts the left tail precisely in the
scenarios where money is lost. Its underperformance is confined to where it
doesn't hurt; its outperformance concentrates where it does.

The naive constraint "never realize below breakeven" *feels* like it can only
help. What it actually does is cap the upside (bounces below $\bar p$ are
forbidden profit), extend time-at-risk, and change the final number not at all
when endpoints coincide. The gut objection — "you sold my long at a loss!" — is
the same label-anchoring fallacy quantified in [HEDGING.md](HEDGING.md): an open
position's entry price is part of the past, not of its forward risk.

## Operating rule

Exit decisions read the market, the prognosis, and the position **size** — never
the average entry price. The only inequality that exists is the session's
$S - B > f\,(S + B)$ on correctly-weighted averages, and it is indifferent to
where any individual fill sat relative to the blended entry of its moment.
