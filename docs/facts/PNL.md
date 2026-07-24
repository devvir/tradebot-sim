# PnL Invariance over Executions

## The result

Take any set of executions that buys a total quantity $Q$ and sells the same total
quantity $Q$ — in any number of fills, of any sizes, in any order, with buys and sells
interleaved arbitrarily, including closing the position to flat and reopening it any
number of times, including flipping between long and short. Then:

1. **Order invariance.** The realized PnL depends only on the *set* of fills, never on
   their sequence.

2. **Composition invariance.** The realized PnL depends on that set only through three
   numbers: the total quantity $Q$, the average buy price $E$, and the average sell
   price $X$ — *provided the averages are weighted in the same currency the quantity
   is measured in*. Any two fill sets that agree on $(Q, E, X)$ produce exactly the
   same PnL.

3. **Two-trade reduction.** Consequently, the entire session collapses, with zero loss
   of PnL-relevant information, to a single equivalent pair:
   **buy $Q$ @ $E$, sell $Q$ @ $X$.**

4. **Partition additivity (strategy composition).** Split the fills into any disjoint
   groups — e.g. tag each fill with the strategy that generated it. The total PnL is
   the sum of each group's standalone PnL. Equivalently: any number of strategies
   trading the same instrument in the same account, each ending flat, produce exactly
   the total PnL they would have produced in separate accounts — with per-strategy
   attribution intact.

$$
\textbf{Linear: } \quad \text{PnL} = \text{Mult}\cdot Q\,(X - E)
\qquad\qquad
\textbf{Inverse: } \quad \text{PnL} = \text{Mult}\cdot Q\left(\frac{1}{E} - \frac{1}{X}\right)
$$

with PnL denominated in the settlement currency (quote for linear, base for inverse),
$Q$ in contracts, and $E, X$ the correctly-weighted average prices (Part 3 gives the
exact weighting rule — it is the one subtlety in the whole result).

**Status.** Claims 1–4 are proven below from stated premises. The premises about the
*exchange's bookkeeping* were **empirically verified on 2026-07-23** against live
BitMEX account history — 947 XBTUSD (inverse) and 462 XBTUSDT (linear) fills,
2024-09 through 2026-07: flat-to-flat episode PnL matches the formula **exactly**
(to the satoshi / micro-USDT) in 8 of 9 inverse episodes and the single linear
episode, and per-close wallet postings match the average-entry reconstruction.
Part 6 has the premises, method, and full results.

## What this enables

- **Overlapping strategies on one account + instrument.** Hedging strategies that
  kick in when a main strategy is weak, or several modest risk-averse strategies
  stacked for larger combined gains — all can share a single position that flips
  long/short/flat as they fire, with no PnL penalty versus isolated subaccounts and
  no inter-account transfers. Model premise: each strategy's fills are unchanged by
  the composition (no strategy reads the shared position, equity, or the others'
  activity, directly or indirectly). Part 5.

- **Attribution survives composition.** Because PnL is a per-fill sum, tagging each
  fill with its strategy makes each strategy's PnL exactly the sum over its own tags —
  well-defined inside the shared account regardless of what the others did around it.
  The exchange's blended average entry price and incremental realized numbers do
  *not* decompose per strategy; the per-tag sums are the real accounting.

- **Simulation and backtesting collapse.** A scalping strategy that does thousands of
  micro-fills inside a range can be scored from its per-side volume and average prices
  alone. No need to replay fill sequences to compute PnL; no need to store them beyond
  the three aggregates.

- **Path-free accounting.** Realized PnL of a flat-to-flat episode can be verified
  from aggregates, independently of the exchange's incremental (average-entry-based)
  bookkeeping. The running average entry price is a mid-flight artifact; it provably
  cancels out of the final number (Part 2).

- **Free execution scheduling.** Splitting an order into any number of child orders,
  reordering them, partially closing and reopening — none of it changes realized PnL,
  so execution can be optimized for *other* objectives (fill probability, queue
  position, impact) knowing the PnL arithmetic is indifferent.

- **Fees ride along.** With a flat per-fill fee rate $f$ on traded notional, total
  fees are also a plain sum over fills — $f \cdot \text{Mult}\sum_i |q_i|\,|\varphi(p_i)|$
  in the notation below — hence equally order-invariant and partition-additive. Net
  PnL inherits every invariance above. (One asymmetry in composition's favor: if two
  strategies fire simultaneous opposite orders and the account nets them internally
  instead of sending both, the fee on both legs is saved — a strict improvement,
  available only in the shared account.)

- **A warning that is part of the theorem.** Composition invariance *fails* if the
  averages are weighted in the wrong currency. For an inverse contract, the
  contract-weighted (arithmetic) average price does **not** determine PnL — two fill
  sets with identical $Q$ and identical arithmetic average price can yield different
  PnL (Part 3, Theorem 4). The correct statistic is the average weighted in the base
  currency — the harmonic mean — which is what exchanges report as `avgEntryPrice` on
  inverse contracts. Use the exchange's average, or compute the harmonic mean; never
  the arithmetic one.

---

## The proof

### Part 0 — Setup and notation

A session is a finite set of executions (fills) $i = 1, \dots, n$. Each fill has:

- a **signed quantity** $q_i$ in contracts — $q_i > 0$ for a buy, $q_i < 0$ for a sell;
- an execution **price** $p_i > 0$.

$\text{Mult}$ is the contract multiplier, always taken positive here. Define the
**price functional**

$$
\varphi(p) =
\begin{cases}
p & \text{linear instrument (settles in quote currency),} \\[4pt]
-\dfrac{1}{p} & \text{inverse instrument (settles in base currency).}
\end{cases}
$$

$\varphi(p)$ is, up to an additive constant, the value of one long contract in the
settlement currency: linear value grows with $p$ directly; an inverse long gains base
currency as $p$ rises, and $-1/p$ is the function that does exactly that. (Exchanges
express the same fact differently: BitMEX keeps $1/p$ and stores a *negative*
multiplier for inverse contracts — the sign lives in $\text{Mult}$ there, in $\varphi$
here.) This is the only place the two instrument types differ; everything below
treats them simultaneously through $\varphi$.

The session ends **flat**:

$$
\sum_{i=1}^{n} q_i = 0 .
$$

Attribute to each fill the settlement-currency amount

$$
c_i = -\,q_i\,\text{Mult}\,\varphi(p_i).
$$

This is the fill's accounting contribution: it trades $q_i$ contracts against
settlement value at the rate $\text{Mult}\,\varphi(p_i)$ per contract, so that
*(settlement value) + (position value)* is conserved through every fill. For a linear
contract it reads literally as cash — a buy pays $q_i\,\text{Mult}\,p_i$ out. For an
inverse contract no literal cash moves at the fill (PnL accrues on the position
instead), but the decomposition is still exact, because the session starts and ends
with zero position, so all position value flows through the $c_i$ — this is made
rigorous by the Lemma in Part 2. Sanity check: a one-contract round trip bought at
$E$ and sold at $X$ gives

$$
c_{\text{buy}} + c_{\text{sell}} = \text{Mult}\,(\varphi(X) - \varphi(E))
= \begin{cases}
\text{Mult}\,(X - E) & \text{linear} \\[4pt]
\text{Mult}\left(\dfrac{1}{E} - \dfrac{1}{X}\right) & \text{inverse}
\end{cases}
$$

— the familiar single-trade PnL formula for both instrument types, with the correct
sign (a long profits when $X > E$ in both).

### Part 1 — PnL of a flat session is a plain sum

Since the session ends flat, there is no open position left to value: every contract
bought was sold. The realized PnL is therefore the total settlement value that moved:

$$
\text{PnL} \;=\; \sum_{i=1}^{n} c_i \;=\; -\,\text{Mult}\sum_{i=1}^{n} q_i\,\varphi(p_i).
\tag{1}
$$

This is the load-bearing observation of the whole result: **each fill contributes one
term, and that term involves no other fill.** There are no cross-terms, no running
state, no dependence on what came before or after.

Equation $(1)$ is not an assumption smuggled in: Part 2 derives it from the
exchange's own incremental bookkeeping rules, running-average entry price and all.

### Part 2 — The average-entry bookkeeping conserves the sum

The apparent obstacle to $(1)$: exchanges realize PnL incrementally, closing each
fill against a running **weighted-average entry price** $\bar p$ — and $\bar p$ *is*
order-dependent, as are the individual realized amounts booked against it. The
resolution: the average-entry mechanism only shuffles value between two pockets of a
conserved total; it cannot change the total.

The exchange maintains three state variables — net position $N$, average entry
$\bar p$, realized PnL $R$ — starting at $N = 0$, $R = 0$, and updates them per fill
by these rules:

- **(B1) Close.** A fill of signed size $q$ opposite to the position (reducing $|N|$,
  not crossing zero) books
  $\;R \mathrel{+}= -\,q\,\text{Mult}\,(\varphi(p) - \varphi(\bar p))$
  and leaves $\bar p$ unchanged. (Check the sign on a long: $N>0$, sell $q<0$, so the
  booked amount is $|q|\,\text{Mult}\,(\varphi(p)-\varphi(\bar p))$ — profit when the
  exit beats the average. The same formula covers shorts.)

- **(B2) Add.** A fill in the direction of the position (growing $|N|$) books nothing
  to $R$ and updates the average by the $\varphi$-weighted mix:

$$
N_{\text{new}}\,\varphi(\bar p_{\text{new}}) = N_{\text{old}}\,\varphi(\bar p_{\text{old}}) + q\,\varphi(p).
$$

  For linear ($\varphi = p$) this is the ordinary quantity-weighted average price.
  For inverse ($\varphi = -1/p$) the signs divide out and it is harmonic mixing:
  $N_{\text{new}}/\bar p_{\text{new}} = N_{\text{old}}/\bar p_{\text{old}} + q/p$.

- **(B3) Flip.** A fill crossing through zero is processed as a close of the entire
  position (B1 with $q = -N$) followed by an add opening the remainder at the fill
  price (B2 from $N = 0$, giving $\bar p_{\text{new}} = p$).

**Lemma (conservation).** *Under B1–B3, after every fill,*

$$
R \;=\; \underbrace{\sum_{i \le k} c_i}_{\text{settlement value moved}} \;+\; N\,\text{Mult}\,\varphi(\bar p).
\tag{2}
$$

**Proof, by induction over fills.** Base case: before any fill, all three terms are
zero. Inductive step, one case per rule, writing $\Delta$ for the change each side of
$(2)$ undergoes:

*Add (B2).* $\Delta R = 0$. On the right: the sum gains
$c = -q\,\text{Mult}\,\varphi(p)$, and by the defining property of the average update
the position term gains exactly $+\,q\,\text{Mult}\,\varphi(p)$. The two cancel:
$\Delta(\text{RHS}) = 0$. Identity preserved.

*Close (B1).* $\Delta R = -q\,\text{Mult}\,(\varphi(p) - \varphi(\bar p))$. On the
right: the sum gains $-q\,\text{Mult}\,\varphi(p)$; the position term changes by
$(N{+}q)\,\text{Mult}\,\varphi(\bar p) - N\,\text{Mult}\,\varphi(\bar p)
= q\,\text{Mult}\,\varphi(\bar p)$. Total:
$\Delta(\text{RHS}) = -q\,\text{Mult}\,(\varphi(p) - \varphi(\bar p)) = \Delta R$.
Identity preserved.

*Flip (B3).* A B1 step followed by a B2 step, each of which preserves the identity by
the two cases above. $\blacksquare$

**Corollary.** At any instant the position is flat, $N = 0$ annihilates the only
order-dependent term in $(2)$, and

$$
R \;=\; \sum_i c_i \;=\; -\,\text{Mult}\sum_i q_i\,\varphi(p_i),
$$

which is $(1)$. Every unit of PnL that B1 "realizes" is transferred out of the open
position's book value $N\,\text{Mult}\,\varphi(\bar p)$ into $R$; different orderings
shuffle the transfers differently, but the conserved total — and therefore the final
number at flat — is untouched. The average entry price is a lien on the open
position, not a component of the final PnL.

### Part 3 — Order invariance and composition invariance

**Theorem 1 (order).** *For any permutation $\sigma$ of $\{1,\dots,n\}$, executing the
same fills in the order $\sigma$ yields the same PnL.*

**Proof.** Executing in order $\sigma$ produces the amounts
$c_{\sigma(1)}, \dots, c_{\sigma(n)}$ — the same numbers, relabeled. By commutativity
and associativity of addition, $\sum_i c_{\sigma(i)} = \sum_i c_i$, so by $(1)$ the
PnL is unchanged. $\blacksquare$

Nothing in the argument required buys to precede sells, the position to stay on one
side, or the position to avoid returning to flat mid-session: a close-and-reopen just
means some partial sums of $q$ hit zero along the way, which changes no term of the
total.

Now the stronger claim: $(Q, E, X)$ alone determines PnL. Split the fills by side.
Let $B$ be the set of buys and $S$ the set of sells, with

$$
Q = \sum_{i \in B} q_i = \sum_{i \in S} |q_i| .
$$

By $(1)$, PnL depends on the fills only through the two side-sums

$$
\Sigma_B = \sum_{i \in B} q_i\,\varphi(p_i),
\qquad
\Sigma_S = \sum_{i \in S} |q_i|\,\varphi(p_i),
\qquad
\text{PnL} = \text{Mult}\,(\Sigma_S - \Sigma_B).
\tag{3}
$$

So the question "do $Q$, $E$, $X$ determine PnL?" reduces to: *does the average price
of a side, together with $Q$, recover that side's $\Sigma$?* The answer depends
entirely on how the average is weighted.

**The key identity.** Every fill carries two locked-together amounts: a quote-currency
amount and a base-currency amount,

$$
u_i = q_i\,p_i \;\;(\text{quote}), \qquad b_i = \frac{q_i}{p_i} \;\;(\text{base, per unit Mult}),
$$

and $\Sigma$ of a side is exactly that side's total in one of the two currencies:
$\Sigma = \sum u_i$ for linear, $\Sigma = -\sum b_i$ for inverse (the sign carried by
$\varphi$).

Compare the two possible weightings of an "average price" for a side (written for the
buys; sells are identical):

$$
\text{quote-recovering:}\quad
E_{\text{arith}} = \frac{\sum_B q_i\,p_i}{\sum_B q_i}
\;\;\Longrightarrow\;\;
\sum_B u_i = Q\,E_{\text{arith}} ,
$$

$$
\text{base-recovering:}\quad
E_{\text{harm}} = \frac{\sum_B q_i}{\sum_B q_i / p_i}
\;\;\Longrightarrow\;\;
\sum_B b_i = \frac{Q}{E_{\text{harm}}} .
$$

$E_{\text{arith}}$ is the ordinary quantity-weighted average price;
$E_{\text{harm}}$ is the quantity-weighted **harmonic** mean — equivalently, the plain
weighted average when fill sizes are measured in the base currency. Each average
recovers exactly one of the two currency totals, and *only* that one.

**Theorem 2 (linear).** *For a linear instrument, $(Q, E_{\text{arith}},
X_{\text{arith}})$ determines PnL:*

$$
\text{PnL} = \text{Mult}\,(\Sigma_S - \Sigma_B)
= \text{Mult}\,(Q X_{\text{arith}} - Q E_{\text{arith}})
= \text{Mult}\cdot Q\,(X - E). \qquad \blacksquare
$$

**Theorem 3 (inverse).** *For an inverse instrument, $(Q, E_{\text{harm}},
X_{\text{harm}})$ determines PnL.*

**Proof.** The side-sums are (minus) the sides' base totals, and the base-recovering
identity gives $\Sigma_B = -Q/E_{\text{harm}}$ and $\Sigma_S = -Q/X_{\text{harm}}$.
Substituting into $(3)$:

$$
\text{PnL} = \text{Mult}\left(\frac{Q}{E} - \frac{Q}{X}\right)
= \text{Mult}\cdot Q\left(\frac{1}{E} - \frac{1}{X}\right),
\qquad E = E_{\text{harm}},\; X = X_{\text{harm}}. \qquad \blacksquare
$$

**Theorem 4 (the negative result).** *For an inverse instrument, $(Q,
E_{\text{arith}}, X_{\text{arith}})$ does* **not** *determine PnL.*

**Proof (counterexample).** Two buy sets, each totaling $Q = 500$ contracts, each with
arithmetic average price exactly $160$:

| Set | Fills | $\sum q_i/p_i$ (base total) |
|-----|-------|------------------------------|
| A | $100@100,\;\; 200@150,\;\; 200@200$ | $1.0000 + 1.3333 + 1.0000 = 3.3333$ |
| B | $400@140,\;\; 100@240$ | $2.8571 + 0.4167 = 3.2738$ |

Same $Q$, same arithmetic average — different base totals, hence by $(3)$ different
inverse PnL against any common set of sells. $\blacksquare$

(Under the correct, base-weighted average the two sets separate: $500/3.3333 =
150.00$ versus $500/3.2738 = 152.73$ — the harmonic mean retains precisely the
information the arithmetic mean discards.)

**Practical note.** Exchanges report the harmonic statistic on inverse contracts:
`avgEntryPrice` is defined so that $Q/E$ equals the base-currency cost of the
position. If $E$ and $X$ are the exchange-reported averages, Theorems 2 and 3 apply
directly on both instrument types.

### Part 4 — The duality: fixing quantity in the other currency

Theorems 2–4 fix quantity in contracts. The structure is symmetric: fix quantity in
the *other* currency and everything mirrors.

Suppose on an inverse contract (XBTUSD) the session buys and sells a fixed total of
$Q$ **base currency** (BTC), each fill converted to contracts at its own execution
price, with $E, X$ the base-weighted average prices. Then per side both currency
totals are again pinned — base total $Q$ by construction, quote total $Q E$ (resp.
$Q X$) by the quote-recovering identity — and:

$$
\text{base: } +Q - Q = 0, \qquad
\text{quote: } Q X - Q E = Q\,(X - E).
$$

The session ends flat in base and its PnL is the **quote-currency** amount
$Q(X - E)$, fully determined by $(Q, E, X)$, order- and composition-invariant by the
same summation argument. Symmetrically, a linear contract traded in fixed
quote-currency amounts ends flat in quote with a determined **base-currency** PnL of
$Q\,(1/E - 1/X)$.

The complete picture:

| Quantity fixed in | Linear (e.g. XBTUSDT) | Inverse (e.g. XBTUSD) |
|---|---|---|
| **Contracts** | PnL $= \text{Mult}\,Q\,(X-E)$, in quote | PnL $= \text{Mult}\,Q\,(1/E - 1/X)$, in base |
| **The other currency** | PnL $= Q\,(1/E - 1/X)$, in base | PnL $= Q\,(X-E)$, in quote |

Every cell is invariant under reordering and recomposition of the fills, with the
averages weighted in the currency the quantity is fixed in. Each cell is an exact
amount *denominated in the stated currency* — no cell is more "real" than another: a
quote-currency profit's worth in base floats over time exactly as a base-currency
profit's worth in quote does, and converting either into anything else is a separate
exchange at a future price, outside this theorem. The only mechanical difference in
the bottom row is that the profit initially exists as an open contract position
rather than a currency balance; its amount in its own denomination is exact either
way, and closing the position is simply the act of converting it into a balance.

### Part 5 — Partition additivity: composing strategies

**Theorem 5.** *Partition the fills into disjoint groups $F_1, \dots, F_m$ (e.g. by
the strategy that generated each fill), each group individually flat:
$\sum_{i \in F_j} q_i = 0$ for every $j$. Then*

$$
\text{PnL}(\text{all fills}) \;=\; \sum_{j=1}^{m} \text{PnL}(F_j),
\qquad
\text{PnL}(F_j) = -\,\text{Mult}\sum_{i \in F_j} q_i\,\varphi(p_i),
$$

*and each $\text{PnL}(F_j)$ equals exactly what group $F_j$'s fills would have
realized as a standalone session in an isolated account.*

**Proof.** The whole set is flat (a sum of zeros), so $(1)$ applies to it; each group
is flat, so $(1)$ applies to each group standalone. The claim is then the
associativity of addition — regrouping the terms of one sum:

$$
\sum_{i=1}^{n} c_i = \sum_{j=1}^{m} \sum_{i \in F_j} c_i . \qquad \blacksquare
$$

**Interpretation.** Any number of strategies trading the same instrument in the same
account — the shared position flipping long, short, flat as they independently fire —
produce, in total and per strategy, exactly the PnL of the same fills executed in
separate accounts. Attribution is preserved: tag each fill at execution time, and a
strategy's PnL is the sum over its own tags, unaffected by everything traded around
it. (What does *not* decompose is the exchange's blended $\bar p$ and its incremental
realized postings — but by Part 2 those cancel out of every flat total, group-wise
and overall.)

**Model premise, stated once.** The theorem compares *the same fill set* under two
groupings. It therefore applies exactly when composition does not alter the fills:
no strategy's signals, sizes, or timing depend — directly or indirectly — on the
shared position, the shared equity, or the other strategies' activity. A strategy
that reads account state composes into a *different* fill set, and the comparison is
then between different sessions, about which this theorem says nothing.

**Groups need not be flat simultaneously.** Each $\text{PnL}(F_j)$ is final as of the
moment group $j$ is flat, regardless of the others still holding positions; the
account's net position at any instant is the sum of the groups' nets. If evaluation
is needed while a group is open, its exact PnL-to-date is its fill sum plus its own
net marked at the current price — and these per-group marks sum to the account total,
consistently.

**Simultaneous opposite orders.** If two groups fire opposite orders at the same
moment and both are sent to market, the fill set matches the isolated-accounts case
and the theorem applies verbatim. Netting them internally instead (sending only the
difference) changes the fill set — it removes two fills — saving both legs' fees with
certainty; the price legs would have cancelled in PnL only if both fills had executed
at the same price. Internal netting is thus a fee improvement available only to the
composed account, over and above the equivalence.

### Part 6 — What is proven, and on what premises

Everything above is mathematics from stated premises; two of those premises are
*empirical facts about the exchange's bookkeeping*, assumed, standard, but not
verified within this document:

- **P1.** Closes realize $-\,q\,\text{Mult}\,(\varphi(p) - \varphi(\bar p))$ against
  the running average (rule B1).
- **P2.** The average entry updates by the $\varphi$-weighted mix (rule B2) —
  arithmetic quantity-weighted for linear, harmonic for inverse.

P2 is the load-bearing one. An exchange that updated an inverse contract's average
*arithmetically* would break the conservation Lemma at every add, and its total
realized PnL at flat would genuinely be order-dependent. The results here are of the
form: **B1–B3 $\Rightarrow$ invariance.** The math is complete; the premises are the
exchange's to satisfy.

**The decisive test** is cheap and empirical: take one real flat-to-flat episode with
several partial fills at different prices — fills $(q_i, p_i)$ from execution history
and the exchange's reported realized PnL for the episode — and compare the report
against $-\,\text{Mult}\sum_i q_i\,\varphi(p_i)$. A match to the smallest currency
unit confirms P1 and P2 simultaneously (a deviation in either rule would surface as a
discrepancy). One multi-fill episode on an *inverse* contract is the strongest single
check, since that is where the wrong-average failure mode would bite.

#### Empirical verification — results (live BitMEX account, run 2026-07-23)

**Method.** Signed REST GETs against the live account (`execution/tradeHistory`,
`user/walletHistory`, `position`): 947 XBTUSD trade fills (2024-09-04 → 2026-07-10)
and 462 XBTUSDT trade fills (2026-07-04 → 2026-07-10). Both positions flat at fetch
time, so history decomposes into flat-to-flat episodes. Wallet `RealisedPNL`
postings are per-closing-fill, `amount` **net of fee**, and must be filtered by
`address == symbol` (concurrent XBTZ24 futures otherwise pollute the sums).

1. **Decisive combined test (P1 + P2) — ✅ CONFIRMED.** Per flat episode, reported
   wallet total vs $-\,\text{Mult}\sum_i q_i\,\varphi(p_i) - \text{fees}$:
   - **Inverse (XBTUSD), 9 episodes** (4–328 fills each, including one ending in a
     liquidation): **8 of 9 EXACT to the satoshi**. The one exception (2024-09-26,
     35 fills) differs by −377 sat = exactly that episode's funding payment — a
     funding-*posting* policy artifact at that date, not a formula deviation
     (funding posts separately from trade PnL everywhere else in the data).
   - **Linear (XBTUSDT), 1 episode of 462 fills: EXACT to the micro-USDT.**

2. **P2 — average update — ✅ CONFIRMED.** Reconstructing $\bar p$ per B1–B3 with
   harmonic (inverse) / arithmetic (linear) mixing and integer cost bookkeeping
   reproduces the exchange's individual per-close postings: 413/435 matched
   inverse postings exact to the satoshi, **210/210 linear postings exact** to the
   micro-USDT (residual inverse ±sats consistent with per-fill integer rounding).

3. **P1 — realization rule — ✅ CONFIRMED.** Same evidence: each posting equals
   $-q_c\,\text{Mult}\,(\varphi(p)-\varphi(\bar p))$ minus that fill's fee.

4. **B3 — flip through zero — ✅ CONFIRMED on inverse** (9 flips in history;
   episodes containing them reconcile exactly). No linear flip occurred in the
   window — manufacturable on testnet if ever needed.

5. **Fee premise — ✅ CONFIRMED.** All 929 fills across both instruments carry
   `commission = 0.0005` flat (maker and taker alike, market/limit/stop/
   liquidation), `execComm = 0.0005 · |execCost|`.

6. **Episode boundaries — ✅ CONFIRMED.** Cumulative signed `lastQty` over
   `execType == 'Trade'` fills, anchored at the verified current flat position,
   yields boundaries whose wallet sums reconcile exactly (see 1).

**Data-handling notes for reproduction.** `execCost` is the exchange's per-fill
integer cost: inverse $\approx \pm\,\mathrm{round}(10^8 q/p)$ satoshis (matches
$(q_i, p_i)$ recomputation to ±1 sat/fill), linear $q \cdot p$ in micro-USDT.
On `execType == 'Funding'` rows, `execCost` is the position *notional* — the actual
funding payment is `execComm`; funding is excluded from the fill set and posts to
the wallet separately from trade PnL.

### Part 7 — Why it all works, in one sentence

PnL of a flat session is a **linear functional of the fill set** — a sum of
independent per-fill terms with no cross-terms — so it is automatically invariant
under reordering, splits over any partition of the fills, and factors through each
side's two currency totals, which is exactly the information a correctly-weighted
average price preserves.
