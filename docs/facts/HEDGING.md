# Hedge Mode Is a Relabeling

**Claim.** Holding simultaneous long and short positions on the same instrument
("hedge mode", as offered by BitMEX and others) is economically identical — fill for
fill, instant by instant — to trading the net position. It changes what the account
*displays*, never what it *earns*. Its real effects are strictly negative: extra
margin consumption and a distorted decision frame.

This document exists to settle the question once, so that strategy design never
budgets complexity for hedge mode, and so that "hedge the position instead of
closing" is recognized as a no-op with costs whenever it resurfaces.

## The basis (see [PNL.md](PNL.md) for the theorems and proofs)

Everything here rests on one result, proven in full in [PNL.md](PNL.md):

> The realized PnL of any flat-to-flat set of fills is a plain sum of independent
> per-fill terms. It is therefore invariant under reordering of the fills
> (Theorem 1) and additive over any partition of them into groups (Theorem 5).
> The running average entry price is bookkeeping that provably cancels out of every
> flat total (Part 2 Lemma). Premises about exchange bookkeeping and their
> verification status are in PNL.md Part 6.

Hedge mode is exactly a **partition**: the same fills, split into two groups labeled
"the long" and "the short". By Theorem 5, the labels change attribution, never the
total.

## The fill-set identity

Long $Q$ from price $E$; price moves against it at $P_1$; the trader either hedges or
closes; unwinds at $P_2$; final exit at $P_3$:

```
Hedge mode:  buy Q@E   sell Q@P1 (open short)   buy Q@P2 (close short)   sell Q@P3 (close long)
Net mode:    buy Q@E   sell Q@P1 (close long)   buy Q@P2 (reopen long)   sell Q@P3 (close)
```

Identical fill multiset: `{buy@E, sell@P1, buy@P2, sell@P3}`. Same fees (same fills).
Same PnL, to the smallest currency unit.

The equivalence is stronger than equal endpoints: **net exposure matches at every
instant** — $Q$ before $P_1$, zero between $P_1$ and $P_2$, $Q$ after — so equity
matches at every tick. No measurement at any moment distinguishes the two accounts
except the labels on the positions.

## The frozen book

The moment both legs are on, net position is zero and total PnL is **frozen**: every
unit the long "recovers" is paid out by the short, one for one. "Holding the long
through the dip while the short earns" is not a strategy state — it is being flat,
with extra steps. The loss as of $P_1$ is fully incurred at $P_1$; hedge mode parks
it in the long leg's unrealized column instead of the wallet, and unrealized PnL on a
net-zero book is not unrealized in any meaningful sense — it cannot change until the
symmetry is broken, which is exactly the decision (direction, price, size) that was
on the table at $P_1$.

## The "stuck long" is not stuck

Suppose the price kept falling and the short is closed with profit at $P_2$, leaving
"a big long from $E$, deep underwater." Compare against the net trader who closed at
$P_1$ and opens a fresh long at $P_2$:

- Both are long $Q$ from $P_2$ onward — identical exposure, identical risk,
  identical PnL on every future price path.
- Equities are equal (Theorem 5); the difference between "realized short profit +
  large negative uPnL" and "realized loss + clean position" is already locked either
  way and is pure display.

Holding the long-from-$E$ *is* a fresh long opened at $P_2$, plus a wallet difference
that no future action can affect. The felt asymmetry — "adding to my underwater long
is risky" versus "opening a long while flat is safe" — compares two identical
exposures and calls one of them risky. **An open position's entry price is not part
of its forward risk; it is part of the past.**

## What hedge mode actually costs

1. **Margin.** Both legs post position and maintenance margin for a book whose value
   cannot move, adding deleveraging and liquidation exposure with zero offsetting
   earning capacity.
2. **A poisoned reference point.** The displayed entry anchors every later decision:
   the underwater leg reads as "can't close, I'd realize the loss" — the same
   fallacy that motivated the hedge, now compounding at exactly the moments when
   decisions resume.
3. **Nothing gained.** Not a fee, not a satoshi, at any instant.

The payoff structure to the trader's judgment: pleasant when nothing can happen (the
frozen stretch), corrosive when something can (the unwind). The product being sold
is the feeling of not having lost; the theorem says the wallet cannot tell the
difference.

## Scope

The equivalence compares *the same fills* under two labelings; that is the theorem's
content and its limit. If holding two labeled legs changes what the trader does
later — and the feature is designed to do exactly that — the fill sets diverge and
the comparison is between different sessions. That difference is behavioral, not
mechanical, and the reference-point distortion above says which way it usually cuts.

**Consequence for strategy design:** any behavior expressible with hedge mode is
expressible identically (same fills, same fees, same equity path) against a single
net position. Simulators, accounting, and strategy code need only model net
positions; per-strategy attribution in a shared account is by fill tags, per
[PNL.md](PNL.md) Part 5 — not by exchange-side position labels.

## Never in automated trading

Hedge mode's legitimate uses are all preferences of a human: managing a position on
someone else's mandate (their display, their constraints), knowingly buying
psychological comfort, or fee asymmetries from the maker-rebate era (long gone —
maker and taker are a flat, equal fee; order type has zero fee consequence). An
algorithm has none of these: no display to manage, no comfort to buy, no fee
asymmetry to exploit. Its entire benefit column is empty by construction while the
margin cost remains — **dominated, not sometimes-worse**: no market condition,
signal, or regime exists under which hedge mode earns anything the net position
does not.

The complementary principle that makes this safe to rely on:

- **PnL is path-independent** ([PNL.md](PNL.md)). Win rate, loss streaks, drawdown
  order — irrelevant. A strategy losing 90% of its trades wins if the fill set sums
  positive.
- **Survival is path-dependent** — the only place paths matter. Liquidation is not
  a large loss; it is a forced mutation of the fill set (fills not chosen, at prices
  not chosen), after which the theorem computes the sum of a different, worse
  session. "No liquidation" is the condition under which the fill set remains the
  strategy's own.

So the single path-dependent resource an automated system must manage is margin
adequacy — and hedge mode spends margin, that exact resource, to purchase display,
the one thing an algorithm does not have.
