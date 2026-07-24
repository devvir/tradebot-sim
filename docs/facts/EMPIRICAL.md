# Empirically Verified BitMEX Facts

Facts about BitMEX's actual behavior, each established by direct measurement against
real account data — not from documentation, not from memory. Each entry states what
was measured, on what data, and any gotchas needed to reproduce the measurement.
Extend this file as new facts are verified; a fact belongs here only with the
measurement that backs it.

Verification data referenced throughout: live account REST pulls of 2026-07-23 —
947 XBTUSD (inverse) trade fills spanning 2024-09-04 → 2026-07-10 and 462 XBTUSDT
(linear) trade fills spanning 2026-07-04 → 2026-07-10, with the corresponding
`user/walletHistory` and `position` records. Both positions were flat at fetch time.

## PnL bookkeeping (the premises of [PNL.md](PNL.md), all confirmed)

- **Flat-to-flat episode PnL equals the per-fill sum.** Wallet totals per episode
  match $-\text{Mult}\sum q_i\varphi(p_i) - \text{fees}$ exactly: 8 of 9 inverse
  episodes to the satoshi (4–328 fills each, one ending in a liquidation), the
  single 462-fill linear episode to the micro-USDT. Full method and results:
  [PNL.md](PNL.md) Part 6.

- **Average entry is harmonic on inverse, arithmetic on linear.** Reconstructing the
  running average with harmonic (inverse) / arithmetic (linear) mixing and integer
  cost bookkeeping reproduces the exchange's individual per-close wallet postings:
  210/210 linear postings exact, 413/435 inverse exact (residual ±satoshis
  consistent with per-fill integer rounding).

- **Closes realize against the average; flips decompose.** Each posting equals
  $-q_c\,\text{Mult}\,(\varphi(p)-\varphi(\bar p))$ minus that fill's fee. 9 organic
  long↔short flips in the inverse history reconcile under close-then-reopen
  decomposition. (No linear flip occurred in the window; manufacturable on testnet.)

## Fees

- **Flat 0.05% per fill, maker == taker.** All 929 fills across both instruments,
  2024-09 → 2026-07, carry `commission = 0.0005` — market, limit, stop-limit, and
  liquidation fills alike. `execComm = 0.0005 · |execCost|`, in settlement-currency
  raw units. No rebate and no maker/taker differential anywhere in the data;
  rebate-era reasoning (e.g. avoiding stop orders on fee grounds) is obsolete.

- **Liquidations are ordinary fills.** The 2026-07-10 liquidation appears in
  `execution/tradeHistory` as `execType: "Trade"`, `ordType: "StopLimit"`,
  `text: "Liquidation"` — normal fee, normal `execCost`, part of the fill set like
  any other execution.

## Wallet history semantics

- **`RealisedPNL` postings are per closing fill,** timestamped ~50 ms after the
  execution, with `amount` **net of fee** and the fee repeated in the `fee` field
  (equal to the closing fill's `execComm`).

- **Filter by `address == symbol`.** Postings from all instruments settling in the
  same currency interleave in one wallet stream — concurrent XBTZ24 futures
  positions polluted XBTUSD episode sums until filtered.

- **Funding posts separately from trade PnL** (`transactType: "Funding"`,
  aggregated — far fewer wallet entries than funding executions). One measured
  exception: a 2024-09 episode's wallet total differed from the trade-only formula
  by exactly that episode's funding payment, so the posting policy at that date
  folded funding into `RealisedPNL`; every episode from 2024-10 onward reconciles
  with funding fully separate.

- **Raw units:** XBt amounts are satoshis ($10^{-8}$ XBT); USDt amounts are
  micro-USDT ($10^{-6}$).

## Execution record semantics

- **`execCost` on `Trade` rows** is the exchange's per-fill integer cost:
  inverse $\approx \pm\,\mathrm{round}(10^8\, q/p)$ satoshis, negative for buys
  (matches recomputation from `lastQty`/`lastPx` to ±1 sat per fill); linear
  $q \cdot p$ in micro-USDT (one XBTUSDT contract = $10^{-6}$ XBT).

- **`Funding` rows are not fills.** Their `execCost` is the position *notional*
  (e.g. `lastQty/lastPx` in satoshis), and the actual funding payment is
  `execComm` (funding rate in `commission`; negative `execComm` = received).
  Including funding `execCost` in any PnL sum produces errors of position-notional
  magnitude. Filter the fill set to `execType == "Trade"`.

- **Episode segmentation that works:** cumulative signed `lastQty` over `Trade`
  fills, anchored at the current position verified via `/position` (walking a
  truncated window without the anchor mis-places every flat boundary). Pagination:
  `reverse=true&start=N` pages are contiguous; de-duplicate by `execID`.

## Access method

Signed REST GETs via the bouncer service (`localhost:1337`, `POST /sign/rest` with
the target verb/path/expiry; token in the tradebot `.env`): the caller sends
`api-key` / `api-expires` / `api-signature` headers, secrets never leave bouncer.
Signature path must include the query string.
