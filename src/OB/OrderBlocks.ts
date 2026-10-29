import { LightIndicator, LightIndicatorState } from '../util/indicator'
import { PivotCalculator } from '../util/pivot'
import { lastIndexOfEnum, ohlctValue } from '../util'
import { gt, gte, lt, lte } from '../util/math'
import { OHLCT } from '../types/candles'
import { OrderBlockResult } from '../types/result'

/** Which order block a condition compares the price with. */
export enum OBSideEnum {
  bullish = 'bullish',
  bearish = 'bearish',
}

/** The level of the block a condition reads. */
export enum OBLevelEnum {
  top = 'top',
  /** (top + bottom) / 2 */
  middle = 'middle',
  bottom = 'bottom',
}

/** Most bars searched back from the breaking candle for the block candle. */
export const OB_MAX_WINDOW = 500

/** Candles the factory feeds before an order-block result is used. */
export const OB_WARMUP = 1000

enum OBState {
  BAR = 0, // index of the latest bar, counted from the first candle fed (0-based)
  SWING_HIGH = 1, // price of the latest confirmed swing high, NaN when none / used
  SWING_HIGH_BAR = 2, // bar of that swing high
  SWING_LOW = 3,
  SWING_LOW_BAR = 4,
  BULL_TOP = 5,
  BULL_BOTTOM = 6,
  BULL_ID = 7,
  BEAR_TOP = 8,
  BEAR_BOTTOM = 9,
  BEAR_ID = 10,
}

/** Resolve a stored swing length to a whole number ≥ 1 (default 5). */
export const resolveOBSwingLength = (
  swingLength?: number | string | null,
): number => {
  const n = Math.floor(
    swingLength === null || swingLength === undefined || swingLength === ''
      ? NaN
      : +swingLength,
  )
  return isFinite(n) && n >= 1 ? n : 5
}

/**
 * Order Blocks
 * Type: Price Action / Market Structure (Smart Money Concepts)
 *
 * LuxAlgo-style order blocks, non-repainting:
 *
 * - **Swings** are pivots with `swingLength` (L) bars on both sides
 *   (`PivotCalculator(L, L)`: the pivot bar's high is at least every high to
 *   its left and above every high to its right; mirrored for lows), so a
 *   swing is confirmed L bars after it prints. Only the latest swing of each
 *   kind is tracked; a newer one replaces it.
 * - **Bullish block**: when a candle CLOSES above the latest confirmed swing
 *   high that has not been broken yet (bullish break of structure), the block
 *   is the candle with the lowest low between the swing-high bar and the
 *   breaking candle, both included (ties → the latest). Zone = that candle's
 *   `[low, high]`. The swing high is then used up — the next bullish block
 *   needs a new swing high.
 * - **Bearish block**: the mirror — a close below the latest unbroken swing
 *   low; the candle with the highest high in between.
 * - **Mitigation** (on close): a bullish block is removed when a candle
 *   closes below its bottom, a bearish one when a candle closes above its
 *   top. Breaker blocks are not tracked.
 * - Only the latest unmitigated block per side is kept; a new block replaces
 *   the old one. The search goes back at most `OB_MAX_WINDOW` (500) bars,
 *   breaking candle included.
 *
 * Order on each candle: confirm swings, mitigate the existing blocks against
 * the close, then look for a break (a new block can never be mitigated by
 * its own breaking candle: its close is beyond the zone).
 *
 * `*Id` is the open time `time` of the breaking candle, or its bar index
 * (0-based, from the first candle fed) when the candle has no usable time,
 * so a crossing can tell a new block from the same block. All block fields
 * are NaN while a side has no active block; `price` is the latest close.
 * The result is `null` for the first 2L candles (no swing can be confirmed
 * yet).
 *
 * Candle Input Type: OHLCT (OHLC + candle open time in ms; time optional)
 */
export class OrderBlocks extends LightIndicator<OrderBlockResult, OHLCT> {
  readonly swingLength: number
  private readonly pivotHigh: PivotCalculator
  private readonly pivotLow: PivotCalculator
  /** highs / lows / ids of the last `OB_MAX_WINDOW` bars, oldest first */
  private highs: number[] = []
  private lows: number[] = []
  private ids: number[] = []

  /** @param swingLength - pivot bars on each side of a swing (default 5) */
  constructor(swingLength: number = 5) {
    super(1, ohlctValue, lastIndexOfEnum(OBState), NaN)
    this.swingLength = Math.min(
      resolveOBSwingLength(swingLength),
      Math.floor((OB_MAX_WINDOW - 1) / 2),
    )
    this.pivotHigh = new PivotCalculator(
      this.swingLength,
      this.swingLength,
      'high',
    )
    this.pivotLow = new PivotCalculator(
      this.swingLength,
      this.swingLength,
      'low',
    )
    this._state[OBState.BAR] = -1
  }

  protected calculate(): OrderBlockResult | null {
    const s = this._state
    const c = this._history.last
    const bar = ++s[OBState.BAR]
    const id = typeof c.time === 'number' && isFinite(c.time) ? c.time : bar
    this.highs.push(c.high)
    this.lows.push(c.low)
    this.ids.push(id)
    if (this.highs.length > OB_MAX_WINDOW) {
      this.highs.shift()
      this.lows.shift()
      this.ids.shift()
    }
    const L = this.swingLength

    // 1. swings confirmed on this bar (the pivot printed L bars ago)
    const ph = this.pivotHigh.calculate(this.highs)
    if (!isNaN(ph)) {
      s[OBState.SWING_HIGH] = ph
      s[OBState.SWING_HIGH_BAR] = bar - L
    }
    const pl = this.pivotLow.calculate(this.lows)
    if (!isNaN(pl)) {
      s[OBState.SWING_LOW] = pl
      s[OBState.SWING_LOW_BAR] = bar - L
    }

    // 2. mitigation on close
    if (c.close < s[OBState.BULL_BOTTOM]) {
      s[OBState.BULL_TOP] = NaN
      s[OBState.BULL_BOTTOM] = NaN
      s[OBState.BULL_ID] = NaN
    }
    if (c.close > s[OBState.BEAR_TOP]) {
      s[OBState.BEAR_TOP] = NaN
      s[OBState.BEAR_BOTTOM] = NaN
      s[OBState.BEAR_ID] = NaN
    }

    // 3. breaks of structure → new blocks
    const n = this.highs.length
    const oldest = bar - (n - 1) // bar index of highs[0]
    if (c.close > s[OBState.SWING_HIGH]) {
      const from = Math.max(s[OBState.SWING_HIGH_BAR], oldest) - oldest
      let best = n - 1
      for (let i = n - 1; i >= from; i--) {
        if (this.lows[i] < this.lows[best]) best = i
      }
      s[OBState.BULL_TOP] = this.highs[best]
      s[OBState.BULL_BOTTOM] = this.lows[best]
      s[OBState.BULL_ID] = id
      s[OBState.SWING_HIGH] = NaN
      s[OBState.SWING_HIGH_BAR] = NaN
    }
    if (c.close < s[OBState.SWING_LOW]) {
      const from = Math.max(s[OBState.SWING_LOW_BAR], oldest) - oldest
      let best = n - 1
      for (let i = n - 1; i >= from; i--) {
        if (this.highs[i] > this.highs[best]) best = i
      }
      s[OBState.BEAR_TOP] = this.highs[best]
      s[OBState.BEAR_BOTTOM] = this.lows[best]
      s[OBState.BEAR_ID] = id
      s[OBState.SWING_LOW] = NaN
      s[OBState.SWING_LOW_BAR] = NaN
    }

    if (bar < 2 * L) {
      return null
    }
    return {
      bullishTop: s[OBState.BULL_TOP],
      bullishBottom: s[OBState.BULL_BOTTOM],
      bullishId: s[OBState.BULL_ID],
      bearishTop: s[OBState.BEAR_TOP],
      bearishBottom: s[OBState.BEAR_BOTTOM],
      bearishId: s[OBState.BEAR_ID],
      price: c.close,
    }
  }

  override exportState(): LightIndicatorState {
    return {
      bin: [
        Float64Array.from(this.highs),
        Float64Array.from(this.lows),
        Float64Array.from(this.ids),
      ],
      circ: [],
      parent: super.exportState(),
    }
  }

  override restoreState(state: LightIndicatorState): void {
    if (!state.parent || !state.bin || state.bin.length < 3) {
      throw new Error('Invalid state: OrderBlocks state is incomplete')
    }
    this.highs = Array.from(state.bin[0])
    this.lows = Array.from(state.bin[1])
    this.ids = Array.from(state.bin[2])
    super.restoreState(state.parent)
  }
}

export type OrderBlockConditionSettings = {
  /** 'bullish' | 'bearish'; missing = bullish */
  side?: OBSideEnum | string | null
  /** 'top' | 'middle' | 'bottom'; missing = top */
  level?: OBLevelEnum | string | null
  /** 'cu' | 'cd' | 'gt' | 'lt'; missing = 'cd' */
  condition?: string | null
}

const num = (v: number | null | undefined): number =>
  v === null || v === undefined ? NaN : +v

/** The level `level` of the `side` block in `result`; NaN when it has none. */
export const orderBlockLevel = (
  result: Partial<OrderBlockResult> | null | undefined,
  side: OBSideEnum | string,
  level: OBLevelEnum | string,
): number => {
  if (!result) {
    return NaN
  }
  const bull = side === OBSideEnum.bullish
  if (!bull && side !== OBSideEnum.bearish) {
    return NaN
  }
  const top = num(bull ? result.bullishTop : result.bearishTop)
  const bottom = num(bull ? result.bullishBottom : result.bearishBottom)
  switch (level) {
    case OBLevelEnum.top:
      return top
    case OBLevelEnum.bottom:
      return bottom
    case OBLevelEnum.middle:
      return (top + bottom) / 2
    default:
      return NaN
  }
}

/** The id of the `side` block in `result`; NaN when it has none. */
const orderBlockId = (
  result: Partial<OrderBlockResult>,
  side: OBSideEnum | string,
): number =>
  num(side === OBSideEnum.bullish ? result.bullishId : result.bearishId)

/**
 * The bot-condition decision of Order Blocks, shared by the live engine and
 * the backtester so both fire on the same bars. Compares the close (`price`)
 * with a level of the latest active block of one side:
 *
 * - No active block on `last` → false.
 * - `gt` / `lt`: the close above / below the level on `last`.
 * - `cu` / `cd`: need `prev` with the SAME block id (a new block jumping the
 *   level is never a crossing), then `prev < level && last >= level` (cu) /
 *   `prev > level && last <= level` (cd) — touching counts on `last`.
 *
 * Default (bullish, top, cd) = the close drops into a bullish block, the
 * retest long. Comparisons use the package's epsilon helpers. A missing
 * result or value is false (JSON nulls accepted); unknown settings are false.
 */
export const orderBlockCondition = (
  last: Partial<OrderBlockResult> | null | undefined,
  prev: Partial<OrderBlockResult> | null | undefined,
  settings: OrderBlockConditionSettings = {},
): boolean => {
  if (!last) {
    return false
  }
  const side = settings.side ?? OBSideEnum.bullish
  const level = settings.level ?? OBLevelEnum.top
  const condition = settings.condition ?? 'cd'
  const lastLevel = orderBlockLevel(last, side, level)
  const lastPrice = num(last.price)
  if (isNaN(lastLevel) || isNaN(lastPrice)) {
    return false
  }
  if (condition === 'gt') {
    return gt(lastPrice, lastLevel)
  }
  if (condition === 'lt') {
    return lt(lastPrice, lastLevel)
  }
  if (condition !== 'cu' && condition !== 'cd') {
    return false
  }
  if (!prev) {
    return false
  }
  const lastId = orderBlockId(last, side)
  const prevId = orderBlockId(prev, side)
  if (isNaN(lastId) || lastId !== prevId) {
    return false
  }
  const prevLevel = orderBlockLevel(prev, side, level)
  const prevPrice = num(prev.price)
  if (isNaN(prevLevel) || isNaN(prevPrice)) {
    return false
  }
  return condition === 'cu'
    ? lt(prevPrice, prevLevel) && gte(lastPrice, lastLevel)
    : gt(prevPrice, prevLevel) && lte(lastPrice, lastLevel)
}
