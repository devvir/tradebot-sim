# Trading Principles

Far-reaching design decisions for automated trading in this project, each with its
rationale and the proof or measurement that backs it. These are not preferences —
each principle is either mathematically proven, empirically verified, or explicitly
marked as a judgment. Strategy code, simulators, and reviews are expected to conform;
a change to any principle belongs here first, with the argument.

Foundations: [facts/PNL.md](../facts/PNL.md) (the invariance theorems, proven and
verified against live account data), [facts/HEDGING.md](../facts/HEDGING.md) (hedge
mode analysis), [facts/EMPIRICAL.md](../facts/EMPIRICAL.md) (measured BitMEX facts).

## 1. Never freeze a position with an opposing position

Opening or enlarging an opposing position on the **same instrument** to "protect"
an existing one is a no-op with costs. The moment exposures net to zero the book is
frozen — every unit the original leg recovers, the opposing leg pays — so the
gain/loss as of that moment is fully incurred, merely displayed as unrealized
instead of realized. The trader still faces the identical decision (direction,
price, size) they faced before "hedging," now with margin posted on both legs and
liquidation exposure on a book that cannot earn. Proven as a corollary of fill-set
invariance; the full argument, including why the "stuck" leg is economically a
fresh position at the current price, is [facts/HEDGING.md](../facts/HEDGING.md).

This rules out BitMEX hedge mode entirely: it is a relabeling of the same fills
into two named positions — identical PnL, fees, and equity at every instant —
whose only products are margin consumption and a misleading display.

Stated at full strength: hedging has **no place in any automated strategy as a
means of affecting gain or loss** — it provably cannot affect a session's
performance in either direction. If it ever earns a place it will be for some
other, non-performance reason; none is currently known.

## 2. One net position per instrument; strategies compose on it

Any number of strategies trading the same instrument share a single account and a
single net position. Proven (PNL.md Theorem 5, partition additivity): the total
PnL of the combined fill stream equals the sum of each strategy's standalone PnL,
and equity matches the separate-accounts alternative at every instant — through
long/short/flat swings, positions closing and reopening, individual fills
"losing." Attribution is preserved by tagging each fill with its strategy: a
strategy's PnL is the sum over its own tags, regardless of what traded around it.

Requirement this imposes: strategies must not read the shared position, shared
equity, or each other's activity — a strategy whose fills depend on account state
produces a *different* fill set when composed, and the equivalence is void.
Strategies size from their own signals and their own virtual book only.

Boundary: the equivalence is proven per instrument. Long instrument A + short
correlated instrument B is formally a **basis position** — trade-by-trade its
price and funding differentials are nonzero. But where those differentials
empirically cancel over time (measured for XBTUSD/XBTUSDT: no permanent basis or
funding drift in either same- or opposite-direction trading), the pair behaves as
one instrument and inherits Principle 1 in full: an opposing position across such
a pair is a frozen book paying margin on two legs — hedge mode improvised across
two tickers. The collapsed form is a single net position on the more liquid leg;
the only real residual choice is settlement denomination (PNL.md Part 4), which
changes what currency accumulates, never how much.

Horizon scoping of that equivalence: an inverse contract's payoff is convex in
price (return $r/(1{+}r)$ on a move $r$, vs $r$ linear), so modeling it as linear
carries a relative error of about $r$ itself. For scalping-sized moves
(0.1–0.5%) the error is 0.1–0.5% *of the PnL* — negligible, and the two
instruments are interchangeable. For long-horizon positions riding 10%+ moves the
error reaches ~10% of the PnL, asymmetric between longs and shorts, and an
equal-notional inverse-vs-linear pair is not frozen but a convexity position.
Treat the pair-as-one-instrument rule as a small-move approximation, exact in the
scalping regime this project targets.

## 3. Position structure is not for humans

Splitting exposure across instruments, accounts, or labeled positions because the
result is "easier to follow" is a human-legibility concern, and no automated
component has it. A bot follows a tagged fill stream and a per-strategy ledger
perfectly, whatever the outward position looks like. Any structural complexity
must buy something measurable — execution, margin efficiency, an actual payoff
difference — or it goes. Display considerations never justify extra legs, extra
margin, or extra accounts.

## 4. Order type is chosen on execution quality, never fees

BitMEX charges a flat 0.05% per fill, maker and taker alike — measured across 929
real fills spanning 2024–2026, including stops and a liquidation
([facts/EMPIRICAL.md](../facts/EMPIRICAL.md)). The rebate era that once justified
avoiding stop orders is long over. Stop losses, market orders, limit orders — all
fee-identical; choose on fill certainty, slippage, and queue position only.

## 5. PnL is path-independent; survival is not

Realized PnL of a flat-to-flat fill set is a plain sum — win rate, loss streaks,
and drawdown order are irrelevant to it. A strategy losing 90% of its trades wins
if the set sums positive. The **only** path-dependent quantity is margin adequacy:
liquidation is not a large loss but a forced mutation of the fill set (fills not
chosen, at prices not chosen), after which the sum being computed is a different,
worse session's. Risk management for an automated system therefore reduces to one
invariant: the margin path must never touch liquidation. Everything else about the
path is noise.

## 6. Funding is ignored in the scalping regime

Scalping earns on quantity, not quality: many small, short-lived positions. Funding
is a three-times-daily event, typically around 0.01% of whatever position happens
to straddle the timestamp — sometimes a charge, sometimes a rebate. Against a
strategy whose positions are small and mostly *not* open at funding timestamps, it
is negligible noise with no persistent sign (measured across XBTUSD/XBTUSDT in
both same- and opposite-direction trading: no drift). Strategy models and
backtests for this regime carry no funding term. This is a regime-scoped judgment:
a strategy that deliberately holds size across funding timestamps must revisit it.

## 7. The whole problem is one inequality

The preceding principles compound into the project's central simplification. Since
strategies compose on one net position (2), opposing and cross-instrument
structures add nothing (1, 2), position structure owes nothing to legibility (3),
order types are fee-identical (4), the path doesn't matter while margin holds (5),
and funding drops out (6) — every exploratory strategy, however intricate its
signals, reduces to exactly this: **one instrument, one net position, and the
choice of where and how much to buy and sell.** Its entire performance is decided
by the theorem's three aggregates $(Q, B, S)$ — total quantity, average buy price,
average sell price (averages weighted per PNL.md: arithmetic for linear, harmonic
for inverse). With the flat fee $f = 0.0005$ on each side's notional — which the
correctly-weighted averages recover exactly — the session's net PnL is

$$
\text{Linear: } \text{Mult}\,Q\,\big[(S-B) - f(B+S)\big]
\qquad
\text{Inverse: } \text{Mult}\,Q\,\Big[\Big(\tfrac{1}{B}-\tfrac{1}{S}\Big) - f\Big(\tfrac{1}{B}+\tfrac{1}{S}\Big)\Big]
$$

and multiplying the inverse condition by $BS$ shows both instruments share **one
winner inequality**:

$$
\boxed{\;S - B \;>\; f\,(S + B)\;}
\qquad\Longleftrightarrow\qquad
\frac{S}{B} > \frac{1+f}{1-f} \approx 1.001
$$

$Q$, Mult, and the instrument type all drop out of the boundary: a session of ten
thousand fills wins under exactly the condition a single buy+sell wins — the
average sell must clear the average buy by $f$ of their sum, ≈ 0.1% of price.
Nothing else exists. Every idea whose value
proposition is structural — more positions, more instruments, hedges, legs,
overlays — is answered before it is coded: if it doesn't move average buy below
average sell by more than the fees it adds, it is noise. Experiments spend their
complexity budget on the only question with any payoff: *where to buy, where to
sell, and how much.*

Trading multiple instruments can still be worthwhile — for capacity, liquidity,
or genuinely independent opportunities — but never as a device to make a
one-instrument strategy's arithmetic work. A strategy that fails this inequality
on its own instrument fails it everywhere.

## 8. No entry without an exit, atomically

A strategy never places an entry order without securing its exit in the same
atomic action (BitMEX supports OCO orders). A strategy may well plan to follow
the price for a better exit in either direction — but from the instant a position
exists, a safe stop exists with it. The stop bounds each position's worst case to
a small, fixed, configurable fraction of the wallet (on the order of 3%): extreme
slippage may stretch that number, but never to the neighborhood of liquidation.
This is Principle 5 made mechanical — the margin path is protected per order, by
construction, not by monitoring.

## 9. One bot, one account, complete isolation

Hard rule: a bot trades alone. No cross-margin between independent bots, no
manual trading on a bot's account — ever. The reason is not margin (that is
Principle 8's job) but epistemics: a bot's backtests and training are statements
about *its* fill stream; any foreign order on the same account makes historical
results meaningless as predictors.

The isolated unit is the **bot**, not the strategy. Internally a bot may be many
strategies — separate signal engines, each with its own algorithms and triggers —
sharing one wallet, one instrument, one net position, and coordinating through
shared state (e.g. a conservative accumulator that de-facto pauses whenever a
rare high-conviction engine has taken the position beyond its cap, resuming when
that engine resolves). PNL.md Theorem 5 is what makes this architecture free:
merging strategies onto one position can never cost anything in the g/l
arithmetic, and each engine's contribution remains an exact, tagged sum. When
strategies cannot be combined, the reason is always behavioral incompatibility —
never the accounting.

The theorem's guarantee splits in two, and both halves matter: attribution and
PnL arithmetic are exact for any interleaving, unconditionally; equivalence *to
the standalone runs* additionally requires the parts to be blind to each other.
For fully blind parts the reduction is total: there are no g/l questions to
answer at all, and the entire composition problem collapses to one static check —
does margin survive all parts at their maximum exposures simultaneously.

The deepest payoff is the strategies this admits that intuition would veto. A
blind part may "sell another part's long at a loss," leaving the position short
under a part that still behaves as if long — a coordination disaster to any human
reading the tape. It is nothing: fills do not interact, each part's tagged sum is
its own, and profitable parts compose into a profitable whole under every
interleaving — not by luck surviving the collisions, but because there are no
collisions. Position labels on the way to flat carry no information. The only
live questions are always the same two: is each part +EV on its own fills, and
does margin survive the worst simultaneous exposure (note: interleaving can swing
the net position far beyond any single part's cap — the margin check is real even
when the PnL question is void).
A composite whose parts react to shared state — usually the point of combining
them — is therefore a new strategy, and what gets backtested, promoted, and
trusted is the composite itself, not its parts separately. Seen from outside,
every bot is one strategy; the composition happens behind the black box.

The same epistemics drive the promotion pipeline: the PoC simulator is a basic
first filter. Strategies that pass it graduate to the realistic environment (in
the tradebot repo), where a bot trades against historical data, testnet, or live
through the *identical* interface — an emulated WS + REST server reproducing
disconnects, lag, account management, and funding. A strategy's results are
trusted only at the level it has actually been tested at.

## 10. Something new can always happen

Twelve years of historical data give reasonable confidence that the simulations
have seen every market regime — and that confidence must never become the
assumption that nothing unseen remains. Two standing defenses:

- **Ratchet the capital out.** Reinvest only part of the gains and cash out
  periodically. Once the original investment has been withdrawn, total loss is
  structurally impossible, whatever happens after.

- **Statistical circuit breakers.** Every strategy carries expected-loss
  statistics from its own backtests. When live losses exceed them — a supposed
  1-in-3 winner dropping 5 in a row — the bot pauses; on resume, further losses
  pause it longer (exponential backoff), escalating to a flag a human must
  eventually see and act on, up to shutting the bot down until the cause is
  explained. This one mechanism covers both failure modes at once: a bad
  algorithm, and a market event (serious news, structural change) the algorithm
  was never built to understand.
