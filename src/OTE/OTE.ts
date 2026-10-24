import { LightIndicator, LightIndicatorState } from '../util/indicator'
import { PivotCalculator } from '../util/pivot'
import { lastIndexOfEnum, ohlcValue } from '../util'
import { OHLC } from '../types/candles'
import { OTEResult } from '../types/result'

enum OTEState {
  BAR = 0, // index of the current bar, counted from the first candle fed
}

/** A confirmed swing high or low: its price and the bar it was confirmed on. */
type Swing = { price: number; bar: number }

/** A leg between an opposite swing high and swing low. */
type Leg = { start: number; bull: boolean; low: number; high: number }

/**
 * Discount / Premium OTE Levels
 * Type: Price Action / Market Structure Indicator
 *
 * Tracks the most recent valid price leg — a move between a swing low and a
 * swing high that is at least `minLegSize` percent long — so its Fibonacci
 * retracement levels (the "optimal trade entry" zone around 0.618–0.79, the
 * 0.5 equilibrium, discount below it and premium above it) can be read at any
 * bar. Ported from the "Discount/Premium OTE Levels" TradingView script.
 *
 * - A **bullish** leg runs from a swing low up to a later swing high.
 * - A **bearish** leg runs from a swing high down to a later swing low.
 * - When price trades through the extreme of the latest leg (above its high
 *   or below its low), that leg is invalidated and rebuilt from the
 *   remaining swings, the same way the original script re-anchors.
 *
 * Swings are TradingView pivots with `leftBars` to the left and one bar to
 * the right, so a swing is confirmed one bar after it prints.
 *
 * Differences from the original script:
 * - `minLegSize` is a percentage of the leg's low instead of absolute price
 *   points, so one setting works across symbols of any price.
 * - Swing and leg history is capped (`MAX_SWINGS` / `MAX_LEGS`, oldest
 *   dropped) to keep memory bounded on long streams.
 *
 * The result reports the leg itself (`high`, `low`, `direction`); a level at
 * retracement `r` is `high - r * (high - low)` for a bullish leg and
 * `low + r * (high - low)` for a bearish one (see `oteLevelPrice`).
 *
 * Candle Input Type: OHLC
 */
export class OTELevels extends LightIndicator<OTEResult, OHLC> {
  static MAX_SWINGS = 1000
  static MAX_LEGS = 100

  private readonly rightBars = 1
  private readonly minLegSize: number
  private readonly pivotHigh: PivotCalculator
  private readonly pivotLow: PivotCalculator
  private readonly windowSize: number

  private highWindow: number[] = []
  private lowWindow: number[] = []
  private highs: Swing[] = []
  private lows: Swing[] = []
  private legs: Leg[] = []

  /**
   * @param leftBars - bars to the left a swing must dominate (default 10)
   * @param minLegSize - minimum leg size, in percent of the leg's low (default 1)
   */
  constructor(leftBars: number = 10, minLegSize: number = 1) {
    super(1, ohlcValue, lastIndexOfEnum(OTEState))
    const left = Math.max(1, Math.floor(leftBars))
    this.minLegSize = Math.max(0, minLegSize)
    this.pivotHigh = new PivotCalculator(left, this.rightBars, 'high')
    this.pivotLow = new PivotCalculator(left, this.rightBars, 'low')
    this.windowSize = left + this.rightBars + 1
    this._state[OTEState.BAR] = -1
  }

  private isLeg(a: number, b: number): boolean {
    const low = Math.min(a, b)
    return low > 0 && ((Math.max(a, b) - low) / low) * 100 >= this.minLegSize
  }

  private pushLeg(leg: Leg) {
    this.legs.push(leg)
    if (this.legs.length > OTELevels.MAX_LEGS) {
      this.legs.shift()
    }
  }

  private pushSwing(list: Swing[], swing: Swing) {
    list.push(swing)
    if (list.length > OTELevels.MAX_SWINGS) {
      list.shift()
    }
  }

  /** A new swing: record it and try to build a leg ending at it. */
  private processSwing(price: number, bull: boolean, bar: number) {
    const source = bull ? this.highs : this.lows
    const opposite = bull ? this.lows : this.highs
    this.pushSwing(source, { price, bar })

    // The newest opposite swing far enough away starts the leg. Index 0 is
    // never considered, as in the original script.
    let op: Swing | undefined
    for (let i = opposite.length - 1; i > 0; i--) {
      if (this.isLeg(price, opposite[i].price)) {
        op = opposite[i]
        break
      }
    }
    if (!op) {
      return
    }
    const last = this.legs[this.legs.length - 1]
    if (last && op.bar <= last.start) {
      return
    }
    this.pushLeg(
      bull
        ? { start: op.bar, bull, low: op.price, high: price }
        : { start: op.bar, bull, low: price, high: op.price },
    )
  }

  /** Price traded above the latest leg's high: re-anchor on the swings left. */
  private invalidateUp(high: number) {
    while (this.highs.length) {
      const h = this.highs.pop() as Swing
      if (h.price > high) {
        this.highs.push(h)
        break
      }
    }
    this.legs.pop()
    const hi = this.highs[this.highs.length - 1]
    if (!hi) {
      return
    }
    // The OLDEST low after `hi` that is far enough away.
    let lo: Swing | undefined
    for (let i = this.lows.length - 1; i > 0; i--) {
      const l = this.lows[i]
      if (hi.bar > l.bar) {
        break
      }
      if (this.isLeg(hi.price, l.price)) {
        lo = l
      }
    }
    if (lo) {
      this.pushLeg({
        start: lo.bar,
        bull: false,
        low: lo.price,
        high: hi.price,
      })
    }
  }

  /** Price traded below the latest leg's low: re-anchor on the swings left. */
  private invalidateDown(low: number) {
    while (this.lows.length) {
      const l = this.lows.pop() as Swing
      if (l.price < low) {
        this.lows.push(l)
        break
      }
    }
    this.legs.pop()
    const lo = this.lows[this.lows.length - 1]
    if (!lo) {
      return
    }
    // The OLDEST high after `lo` that is far enough away.
    let hi: Swing | undefined
    for (let i = this.highs.length - 1; i > 0; i--) {
      const h = this.highs[i]
      if (lo.bar > h.bar) {
        break
      }
      if (this.isLeg(lo.price, h.price)) {
        hi = h
      }
    }
    if (hi) {
      this.pushLeg({ start: hi.bar, bull: true, low: lo.price, high: hi.price })
    }
  }

  protected calculate(): OTEResult | null {
    const candle = this._history.last
    const bar = ++this._state[OTEState.BAR]

    while (this.legs.length) {
      if (candle.high > this.legs[this.legs.length - 1].high) {
        this.invalidateUp(candle.high)
      } else {
        break
      }
    }
    while (this.legs.length) {
      if (candle.low < this.legs[this.legs.length - 1].low) {
        this.invalidateDown(candle.low)
      } else {
        break
      }
    }

    this.highWindow.push(candle.high)
    this.lowWindow.push(candle.low)
    if (this.highWindow.length > this.windowSize) {
      this.highWindow.shift()
      this.lowWindow.shift()
    }

    const swingLow = this.pivotLow.calculate(this.lowWindow)
    if (!isNaN(swingLow)) {
      this.processSwing(swingLow, false, bar)
    }
    const swingHigh = this.pivotHigh.calculate(this.highWindow)
    if (!isNaN(swingHigh)) {
      this.processSwing(swingHigh, true, bar)
    }

    const leg = this.legs[this.legs.length - 1]
    return {
      high: leg ? leg.high : NaN,
      low: leg ? leg.low : NaN,
      direction: leg ? (leg.bull ? 1 : -1) : NaN,
      price: candle.close,
    }
  }

  override exportState(): LightIndicatorState {
    const swings = (list: Swing[]) =>
      Float64Array.from(list.flatMap((s) => [s.price, s.bar]))
    return {
      bin: [
        Float64Array.from(this.highWindow),
        Float64Array.from(this.lowWindow),
        swings(this.highs),
        swings(this.lows),
        Float64Array.from(
          this.legs.flatMap((l) => [l.start, l.bull ? 1 : 0, l.low, l.high]),
        ),
      ],
      circ: [],
      parent: super.exportState(),
    }
  }

  override restoreState(state: LightIndicatorState): void {
    if (!state.parent) {
      throw new Error('Invalid state: parent state is missing')
    }
    const [highWindow, lowWindow, highs, lows, legs] = state.bin
    const swings = (a: Float64Array) => {
      const out: Swing[] = []
      for (let i = 0; i + 1 < a.length; i += 2) {
        out.push({ price: a[i], bar: a[i + 1] })
      }
      return out
    }
    this.highWindow = Array.from(highWindow ?? [])
    this.lowWindow = Array.from(lowWindow ?? [])
    this.highs = swings(highs ?? new Float64Array())
    this.lows = swings(lows ?? new Float64Array())
    this.legs = []
    const l = legs ?? new Float64Array()
    for (let i = 0; i + 3 < l.length; i += 4) {
      this.legs.push({
        start: l[i],
        bull: l[i + 1] === 1,
        low: l[i + 2],
        high: l[i + 3],
      })
    }
    super.restoreState(state.parent)
  }
}

/**
 * Price of retracement level `level` of a leg: 0 is the leg's end (the swing
 * it was built to), 1 its origin, 0.5 the equilibrium. NaN without a leg.
 */
export const oteLevelPrice = (
  result: Pick<OTEResult, 'high' | 'low' | 'direction'>,
  level: number,
): number => {
  const { high, low, direction } = result
  if (isNaN(high) || isNaN(low) || isNaN(level) || !direction) {
    return NaN
  }
  const size = high - low
  return direction > 0 ? high - level * size : low + level * size
}
