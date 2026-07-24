import type { AccountParams, AccountSnapshot, AccountState, PositionLeg, Side } from '../types';

/**
 * In-memory two-way (hedge mode) account for XBTUSD — exact inverse-contract
 * arithmetic, XBT-denominated wallet.
 *
 * - PnL of a long reduced at price p: size × (1/entry − 1/p) XBT.
 * - Entry blending on adds is harmonic (contracts are USD, value is size/price).
 * - Fees: takerFee × notional (size/price) XBT on every fill, both directions.
 * - Margin is charged gross per leg at initMargin (conservative reading of the
 *   unresolved hedge-mode gross-vs-net question, MECHANICS.md §6).
 *
 * Invariant worth knowing (tested): a balanced pair's uPnL is
 * S × (1/entryLong − 1/entryShort), independent of price.
 */
export class Account {
  private state: AccountState;

  constructor(private params: AccountParams, initialWallet: number) {
    this.state = {
      wallet: initialWallet,
      long: { size: 0, avgEntry: 0 },
      short: { size: 0, avgEntry: 0 },
      realized: 0,
      feesPaid: 0,
    };
  }

  /**
   * Open or add to a leg: `size` contracts at `price`. Charges the taker fee
   * and blends the average entry harmonically.
   */
  open(side: Side, size: number, price: number): void {
    assertPositive(size, price);

    const leg = this.leg(side);
    const total = leg.size + size;

    leg.avgEntry = leg.size === 0 ? price : total / (leg.size / leg.avgEntry + size / price);
    leg.size = total;

    this.chargeFee(size, price);
  }

  /**
   * Reduce a leg by `size` contracts at `price`, realizing PnL into the
   * wallet. Charges the taker fee. Returns the realized PnL (fee excluded).
   */
  reduce(side: Side, size: number, price: number): number {
    assertPositive(size, price);

    const leg = this.leg(side);

    if (size > leg.size + 1e-9) {
      throw new Error(`reduce ${size} > ${side} size ${leg.size}`);
    }

    const direction = side === 'long' ? 1 : -1;
    const pnl = direction * size * (1 / leg.avgEntry - 1 / price);

    leg.size -= size;

    if (leg.size <= 1e-9) {
      leg.size = 0;
      leg.avgEntry = 0;
    }

    this.state.wallet += pnl;
    this.state.realized += pnl;

    this.chargeFee(size, price);

    return pnl;
  }

  /** uPnL of one leg at `price`, in XBT. */
  uPnl(side: Side, price: number): number {
    const leg = this.leg(side);

    if (leg.size === 0) {
      return 0;
    }

    const direction = side === 'long' ? 1 : -1;

    return direction * leg.size * (1 / leg.avgEntry - 1 / price);
  }

  /** Full accounting snapshot at `price`. */
  snapshot(price: number): AccountSnapshot {
    const uPnlLong = this.uPnl('long', price);
    const uPnlShort = this.uPnl('short', price);
    const uPnl = uPnlLong + uPnlShort;
    const positionMargin = ((this.state.long.size + this.state.short.size) / price) * this.params.initMargin;
    const equity = this.state.wallet + uPnl;

    return {
      ...structuredClone(this.state),
      price,
      uPnlLong,
      uPnlShort,
      uPnl,
      positionMargin,
      availableMargin: equity - positionMargin,
      equity,
    };
  }

  private leg(side: Side): PositionLeg {
    return side === 'long' ? this.state.long : this.state.short;
  }

  private chargeFee(size: number, price: number): void {
    const fee = this.params.takerFee * (size / price);

    this.state.wallet -= fee;
    this.state.feesPaid += fee;
  }
}

function assertPositive(size: number, price: number): void {
  if (size <= 0 || price <= 0) {
    throw new Error(`invalid size/price: ${size} @ ${price}`);
  }
}
