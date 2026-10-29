import { LightIndicator, LightIndicatorState } from '../util/indicator'
import { hlcValue, lastIndexOfEnum } from '../util'
import { HLC } from '../types/candles'
import { SqueezeResult } from '../types/result'

/** The squeeze state a Squeeze condition requires. */
export enum SqzSignalEnum {
  /** the squeeze released: previous bar on, newest bar not on */
  fired = 'fired',
  /** in a squeeze (BB inside KC) */
  on = 'on',
  /** out of a squeeze (BB outside KC) */
  off = 'off',
  /** no squeeze requirement */
  any = 'any',
}

/** The momentum requirement of a Squeeze condition. */
export enum SqzMomentumEnum {
  positive = 'positive',
  negative = 'negative',
  rising = 'rising',
  falling = 'falling',
  crossUp = 'crossUp',
  crossDown = 'crossDown',
  any = 'any',
}

enum SqzState {
  BARS = 0, // candles fed so far
  PREV_CLOSE = 1, // close of the previous candle, NaN before the first
}

const wholeLength = (v: number | string | null | undefined, d: number) => {
  const n = Math.floor(v === null || v === undefined || v === '' ? NaN : +v)
  return isFinite(n) && n >= 1 ? n : d
}

const positive = (v: number | string | null | undefined, d: number) => {
  const n = v === null || v === undefined || v === '' ? NaN : +v
  return isFinite(n) && n > 0 ? n : d
}

/** Squeeze settings as the factory resolves them. */
export const resolveSqueezeSettings = (
  length?: number | string | null,
  bbMult?: number | string | null,
  kcLength?: number | string | null,
  kcMult?: number | string | null,
) => ({
  length: wholeLength(length, 20),
  bbMult: positive(bbMult, 1.5),
  kcLength: wholeLength(kcLength, 20),
  kcMult: positive(kcMult, 1.5),
})

/**
 * Candles fed before a Squeeze result is used: `2 × max(length, kcLength)`.
 * The math has no recursion, so the first value (at candle
 * `max(length, 2 × kcLength − 1)`) is already exact; the factory asks for a
 * little more so the previous bar a `fired` / `rising` test reads exists too.
 */
export const squeezeWarmup = (length: number, kcLength: number): number =>
  2 * Math.max(length, kcLength)

/**
 * Squeeze Momentum
 * Type: Volatility / Momentum
 *
 * LazyBear's "Squeeze Momentum Indicator" (the corrected v2 linked from the
 * TradingView page), with true range always on:
 *
 * - BB: basis = sma(close, length), dev = bbMult × stdev(close, length) —
 *   population standard deviation, as Pine's `stdev`.
 * - KC: ma = sma(close, kcLength), rangema = sma(trueRange, kcLength),
 *   bands ma ± rangema × kcMult. True range of the first candle =
 *   high − low (Pine's `tr` with no previous close).
 * - squeeze 1 (on) when lowerBB > lowerKC and upperBB < upperKC; −1 (off)
 *   when lowerBB < lowerKC and upperBB > upperKC; 0 otherwise.
 * - momentum = linreg(close − avg(avg(highest(high, kcLength),
 *   lowest(low, kcLength)), sma(close, kcLength)), kcLength, 0) — the end
 *   point of the least-squares line through the last kcLength values.
 *
 * Every window is summed directly (no rolling sums), so values do not drift
 * on long streams. `null` until both the bands and the momentum exist.
 *
 * The default BB multiplier is 1.5 (since 1.14.0; 2 before): the script
 * TradingView displays has the BB multiplier stuck at 1.5 (its KC
 * multiplier), so 1.5 matches its chart. Pass `bbMult` 2 for the corrected
 * v2's own default.
 *
 * Candle Input Type: HLC
 */
export class Squeeze extends LightIndicator<SqueezeResult, HLC> {
  readonly length: number
  readonly bbMult: number
  readonly kcLength: number
  readonly kcMult: number
  private readonly closeWindow: number
  // last `closeWindow` closes and last `kcLength` highs / lows / true ranges /
  // momentum source values, oldest first
  private closes: number[] = []
  private highs: number[] = []
  private lows: number[] = []
  private trs: number[] = []
  private vals: number[] = []

  /**
   * @param length - BB length (default 20)
   * @param bbMult - BB multiplier (default 1.5)
   * @param kcLength - KC length, also the momentum length (default 20)
   * @param kcMult - KC multiplier (default 1.5)
   */
  constructor(
    length: number = 20,
    bbMult: number = 1.5,
    kcLength: number = 20,
    kcMult: number = 1.5,
  ) {
    super(1, hlcValue, lastIndexOfEnum(SqzState), 0)
    const r = resolveSqueezeSettings(length, bbMult, kcLength, kcMult)
    this.length = r.length
    this.bbMult = r.bbMult
    this.kcLength = r.kcLength
    this.kcMult = r.kcMult
    this.closeWindow = Math.max(this.length, this.kcLength)
    this._state[SqzState.PREV_CLOSE] = NaN
  }

  /** Candles needed before the result is used (see `squeezeWarmup`). */
  get warmup(): number {
    return squeezeWarmup(this.length, this.kcLength)
  }

  private static push(list: number[], value: number, size: number) {
    list.push(value)
    if (list.length > size) list.shift()
  }

  protected calculate(): SqueezeResult | null {
    const s = this._state
    const c = this._history.last
    const prevClose = s[SqzState.PREV_CLOSE]
    const tr = isNaN(prevClose)
      ? c.high - c.low
      : Math.max(
          c.high - c.low,
          Math.abs(c.high - prevClose),
          Math.abs(c.low - prevClose),
        )
    s[SqzState.PREV_CLOSE] = c.close
    s[SqzState.BARS] += 1
    const kcL = this.kcLength
    Squeeze.push(this.closes, c.close, this.closeWindow)
    Squeeze.push(this.highs, c.high, kcL)
    Squeeze.push(this.lows, c.low, kcL)
    Squeeze.push(this.trs, tr, kcL)

    const closes = this.closes
    const nc = closes.length

    // momentum source value of this bar, once kcLength candles exist
    if (this.highs.length === kcL) {
      let highest = -Infinity
      let lowest = Infinity
      for (let i = 0; i < kcL; i++) {
        if (this.highs[i] > highest) highest = this.highs[i]
        if (this.lows[i] < lowest) lowest = this.lows[i]
      }
      let kcSum = 0
      for (let i = nc - kcL; i < nc; i++) kcSum += closes[i]
      const kcMa = kcSum / kcL
      Squeeze.push(
        this.vals,
        c.close - ((highest + lowest) / 2 + kcMa) / 2,
        kcL,
      )
    }
    if (nc < this.length || this.vals.length < kcL) {
      return null
    }

    // Bollinger Bands
    const len = this.length
    let sum = 0
    for (let i = nc - len; i < nc; i++) sum += closes[i]
    const basis = sum / len
    let sq = 0
    for (let i = nc - len; i < nc; i++) {
      const d = closes[i] - basis
      sq += d * d
    }
    const dev = this.bbMult * Math.sqrt(sq / len)
    const upperBB = basis + dev
    const lowerBB = basis - dev

    // Keltner Channel
    let kcSum = 0
    let trSum = 0
    for (let i = nc - kcL; i < nc; i++) kcSum += closes[i]
    for (let i = 0; i < kcL; i++) trSum += this.trs[i]
    const ma = kcSum / kcL
    const rangema = trSum / kcL
    const upperKC = ma + rangema * this.kcMult
    const lowerKC = ma - rangema * this.kcMult

    const squeeze =
      lowerBB > lowerKC && upperBB < upperKC
        ? 1
        : lowerBB < lowerKC && upperBB > upperKC
          ? -1
          : 0

    return { momentum: linregEnd(this.vals), squeeze }
  }

  override exportState(): LightIndicatorState {
    return {
      bin: [
        Float64Array.from(this.closes),
        Float64Array.from(this.highs),
        Float64Array.from(this.lows),
        Float64Array.from(this.trs),
        Float64Array.from(this.vals),
      ],
      circ: [],
      parent: super.exportState(),
    }
  }

  override restoreState(state: LightIndicatorState): void {
    if (!state.parent || !state.bin || state.bin.length < 5) {
      throw new Error('Invalid state: Squeeze state is incomplete')
    }
    this.closes = Array.from(state.bin[0])
    this.highs = Array.from(state.bin[1])
    this.lows = Array.from(state.bin[2])
    this.trs = Array.from(state.bin[3])
    this.vals = Array.from(state.bin[4])
    super.restoreState(state.parent)
  }
}

/**
 * End point of the least-squares line through `values` (oldest first) —
 * Pine's `linreg(src, length, 0)` with length = `values.length`: the fitted
 * value at the newest bar, x = 0 … n − 1.
 */
export const linregEnd = (values: ArrayLike<number>): number => {
  const n = values.length
  if (n === 0) return NaN
  if (n === 1) return values[0]
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    const y = values[i]
    sx += i
    sy += y
    sxx += i * i
    sxy += i * y
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  const intercept = (sy - slope * sx) / n
  return intercept + slope * (n - 1)
}

export type SqueezeConditionSettings = {
  /** 'fired' | 'on' | 'off' | 'any'; missing = fired */
  signal?: SqzSignalEnum | string | null
  /** see `SqzMomentumEnum`; missing = positive */
  momentum?: SqzMomentumEnum | string | null
}

const num = (v: number | null | undefined): number =>
  v === null || v === undefined ? NaN : +v

/**
 * The bot-condition decision of Squeeze Momentum, shared by the live engine
 * and the backtester so both fire on the same bars. True when the signal AND
 * the momentum requirement hold:
 *
 * - signal: `fired` = prev.squeeze is 1 and last.squeeze is not 1; `on` =
 *   last.squeeze is 1; `off` = last.squeeze is −1; `any` = true.
 * - momentum: `positive` last > 0; `negative` last < 0; `rising` last >
 *   prev; `falling` last < prev; `crossUp` prev ≤ 0 and last > 0;
 *   `crossDown` prev ≥ 0 and last < 0; `any` = true.
 * - Both `any` → false (never fires). Anything needing `prev` without one
 *   → false. Plain comparisons (no epsilon: momentum is a price difference
 *   and its scale depends on the symbol). A missing result or value is
 *   false (JSON nulls accepted); unknown settings are false.
 */
export const squeezeCondition = (
  last: Partial<SqueezeResult> | null | undefined,
  prev: Partial<SqueezeResult> | null | undefined,
  settings: SqueezeConditionSettings = {},
): boolean => {
  if (!last) {
    return false
  }
  const signal = settings.signal ?? SqzSignalEnum.fired
  const momentum = settings.momentum ?? SqzMomentumEnum.positive
  if (signal === SqzSignalEnum.any && momentum === SqzMomentumEnum.any) {
    return false
  }
  const sq = num(last.squeeze)
  const prevSq = prev ? num(prev.squeeze) : NaN
  let signalOk: boolean
  switch (signal) {
    case SqzSignalEnum.fired:
      signalOk = prevSq === 1 && !isNaN(sq) && sq !== 1
      break
    case SqzSignalEnum.on:
      signalOk = sq === 1
      break
    case SqzSignalEnum.off:
      signalOk = sq === -1
      break
    case SqzSignalEnum.any:
      signalOk = true
      break
    default:
      return false
  }
  if (!signalOk) {
    return false
  }
  const m = num(last.momentum)
  const pm = prev ? num(prev.momentum) : NaN
  switch (momentum) {
    case SqzMomentumEnum.positive:
      return m > 0
    case SqzMomentumEnum.negative:
      return m < 0
    case SqzMomentumEnum.rising:
      return m > pm
    case SqzMomentumEnum.falling:
      return m < pm
    case SqzMomentumEnum.crossUp:
      return pm <= 0 && m > 0
    case SqzMomentumEnum.crossDown:
      return pm >= 0 && m < 0
    case SqzMomentumEnum.any:
      return true
    default:
      return false
  }
}
