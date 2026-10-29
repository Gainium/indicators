import { LightIndicator, LightIndicatorState } from '../util/indicator'
import { Float64CircularArray } from '../util/array'
import { hlcValue, lastIndexOfEnum } from '../util'
import { lineCondition, resultNumber } from '../util/condition'
import { HLC } from '../types/candles'
import { KDJResult } from '../types/result'

enum KDJState {
  RSV = 0, // latest raw stochastic value (NaN until the window is full)
  K = 1,
  D = 2,
  UPDATES = 3, // number of K/D updates so far
}

/** K and D start here before the first update (the classic KDJ seed). */
export const KDJ_SEED = 50

/** Largest seed error the warm-up allows in K, D and J. */
const SEED_TOLERANCE = 1e-6

/**
 * Number of K/D updates after which the seed's weight in K, D and J is below
 * 1e-6 (of a 0..100 scale), for smoothing lengths `kSmooth` and `dSmooth`.
 * Before that `KDJ` emits nothing, so no value a condition reads depends on
 * where the history happened to start.
 */
export function kdjSettleBars(kSmooth: number, dSmooth: number): number {
  const rk = (kSmooth - 1) / kSmooth
  const rd = (dSmooth - 1) / dSmooth
  // worst-case seed errors: K and D start at most 100 away from the value
  // they would have had with infinite history
  let eK = 100
  let eD = 100
  let t = 1
  for (; t < 1_000_000; t++) {
    eK = rk * eK
    eD = rd * eD + eK / dSmooth
    if (3 * eK + 2 * eD < SEED_TOLERANCE) {
      break
    }
  }
  return t
}

/**
 * KDJ
 * Type: Momentum Oscillator
 *
 * A Stochastic variant with a third line J. Matches TradingView's popular
 * open-source "KDJ Indicator" script, which uses the "bcwsma" smoothing
 * common in Asian charting packages:
 *
 * - RSV = 100 × (close − lowest(low, n)) / (highest(high, n) − lowest(low, n))
 * - K = (1 × RSV + (kSmooth − 1) × K[1]) / kSmooth
 * - D = (1 × K + (dSmooth − 1) × D[1]) / dSmooth
 * - J = 3K − 2D
 *
 * Defaults KDJ(9, 3, 3). The script has one "signal" length for both
 * smoothings; it is exposed here as two (`kSmooth`, `dSmooth`) — set both to
 * the script's signal to reproduce it.
 *
 * Decisions:
 * - **Seed.** K and D start at 50 (`KDJ_SEED`, the classic definition; the
 *   script starts at 0). The seed fades geometrically, and the indicator
 *   emits `null` until its weight is below 1e-6 in K, D and J
 *   (`kdjSettleBars`: 55 updates for 3/3, so KDJ(9,3,3) warms up in 63
 *   candles), so the values match the script's
 *   to that precision whatever the seed, and no emitted value depends on
 *   where the history starts. Warm-up = `n − 1 + kdjSettleBars(...)`.
 * - **Flat range.** When the highest high equals the lowest low over the
 *   window, RSV is undefined (0/0). The previous RSV is kept (50 if there is
 *   none yet), so K and D hold their course instead of being poisoned by NaN.
 *   (The script turns the bar into na, which resets its smoothing to 0 on the
 *   next bar.)
 * - J is not clamped: it leaves 0..100 when K runs away from D.
 *
 * Candle Input Type: HLC
 */
export class KDJ extends LightIndicator<KDJResult, HLC> {
  readonly n: number
  readonly kSmooth: number
  readonly dSmooth: number
  /** K/D updates needed before the first value (see `kdjSettleBars`) */
  readonly settle: number
  private readonly highs: Float64CircularArray
  private readonly lows: Float64CircularArray

  /**
   * @param n - RSV window: highest high / lowest low over the last n candles (default 9)
   * @param kSmooth - K smoothing length (default 3)
   * @param dSmooth - D smoothing length (default 3)
   */
  constructor(n: number = 9, kSmooth: number = 3, dSmooth: number = 3) {
    super(1, hlcValue, lastIndexOfEnum(KDJState), NaN)
    this.n = Math.max(1, Math.floor(+n || 9))
    this.kSmooth = Math.max(1, Math.floor(+kSmooth || 3))
    this.dSmooth = Math.max(1, Math.floor(+dSmooth || 3))
    this.settle = kdjSettleBars(this.kSmooth, this.dSmooth)
    this.highs = new Float64CircularArray(this.n, NaN)
    this.lows = new Float64CircularArray(this.n, NaN)
    this._state[KDJState.K] = KDJ_SEED
    this._state[KDJState.D] = KDJ_SEED
    this._state[KDJState.UPDATES] = 0
  }

  /** Candles needed before the first value. */
  get warmup(): number {
    return this.n - 1 + this.settle
  }

  protected calculate(): KDJResult | null {
    const s = this._state
    const candle = this._history.last
    this.highs.add(candle.high)
    if (!this.lows.add(candle.low)) {
      return null
    }
    let highest = -Infinity
    let lowest = Infinity
    const highs = this.highs.array
    const lows = this.lows.array
    for (let i = 0; i < this.n; i++) {
      if (highs[i] > highest) highest = highs[i]
      if (lows[i] < lowest) lowest = lows[i]
    }
    const range = highest - lowest
    if (range > 0) {
      s[KDJState.RSV] = (100 * (candle.close - lowest)) / range
    } else if (isNaN(s[KDJState.RSV])) {
      s[KDJState.RSV] = KDJ_SEED
    }
    const ks = this.kSmooth
    const ds = this.dSmooth
    s[KDJState.K] = (s[KDJState.RSV] + (ks - 1) * s[KDJState.K]) / ks
    s[KDJState.D] = (s[KDJState.K] + (ds - 1) * s[KDJState.D]) / ds
    s[KDJState.UPDATES] += 1
    if (s[KDJState.UPDATES] < this.settle) {
      return null
    }
    return {
      k: s[KDJState.K],
      d: s[KDJState.D],
      j: 3 * s[KDJState.K] - 2 * s[KDJState.D],
    }
  }

  override exportState(): LightIndicatorState {
    return {
      bin: [],
      circ: [this.highs.exportState(), this.lows.exportState()],
      parent: super.exportState(),
    }
  }

  override restoreState(state: LightIndicatorState): void {
    if (!state.parent || !state.circ || state.circ.length < 2) {
      throw new Error('Invalid state: KDJ state is incomplete')
    }
    this.highs.restoreState(state.circ[0])
    this.lows.restoreState(state.circ[1])
    super.restoreState(state.parent)
  }
}

/** A KDJ line a condition can read. */
export enum KDJLineEnum {
  k = 'k',
  d = 'd',
  j = 'j',
}

/** Zone filter of a KDJ condition — the same choices as Stochastic. */
export enum KDJZoneEnum {
  lower = 'lower',
  upper = 'upper',
  both = 'both',
  none = 'none',
}

export type KDJConditionSettings = {
  /** the indicator side (Stochastic's `rsiValue`); missing = k */
  line?: KDJLineEnum | string
  /**
   * what it is compared with (Stochastic's `rsiValue2`): another line, or
   * `'custom'` for the fixed `level`; missing = d
   */
  compareTo?: KDJLineEnum | 'custom' | string
  /** the fixed level for `compareTo: 'custom'` (`valueInsteadof`); missing = 1, as the engine */
  level?: number | string | null
  /** 'cd' | 'cu' | 'gt' | 'lt'; missing = 'cu' */
  condition?: string
  /** zone filter (`stochRange`); missing = none */
  zone?: KDJZoneEnum | string | null
  /** stored `stochUpper`, read the way the Stochastic condition reads it */
  stochUpper?: number | string | null
  /** stored `stochLower`, read the way the Stochastic condition reads it */
  stochLower?: number | string | null
}

const kdjLine = (r: Partial<KDJResult>, line: string): number =>
  line === KDJLineEnum.d
    ? resultNumber(r.d)
    : line === KDJLineEnum.j
      ? resultNumber(r.j)
      : line === KDJLineEnum.k
        ? resultNumber(r.k)
        : NaN

/**
 * The bot-condition decision of KDJ, shared by the live engine and the
 * backtester so both fire on the same bars. It offers what the Stochastic
 * condition offers, with J as a third line:
 *
 * - `line` (K / D / J) against `compareTo` (another line, or the fixed
 *   `level` with `'custom'`), by `condition`, through `lineCondition` — the
 *   engine's own rule (`cu` / `cd` crossings need `prev`; touching counts on
 *   the previous bar; `gt` / `lt` read `last` only). The same line on both
 *   sides is never true.
 * - Zone filter, applied like Stochastic's (after the comparison, and not for
 *   a `'custom'` level): all four compared values (both lines on both bars)
 *   must be strictly above the upper band or strictly below the lower band
 *   (without `prev`, only the two `last` values are tested). `upper` keeps
 *   only the upper-band test, `lower` only the lower-band one, `both` either,
 *   `none` / missing no filter. The bands come from the stored Stochastic
 *   keys exactly as that condition reads them: a single-band zone reads its
 *   band from the OTHER key (`lower` reads `stochUpper`, `upper` reads
 *   `stochLower`); `both` reads `stochLower` as the lower and `stochUpper` as
 *   the upper band. A missing / non-numeric band makes the zone test false.
 *   Unlike Stochastic, the "other side" of a single-band zone is not tested
 *   against 0 / 100: J leaves that range, and `lower` must mean "below the
 *   lower band" only.
 *
 * A missing result or value is false (JSON nulls accepted).
 */
export const kdjCondition = (
  last: Partial<KDJResult> | null | undefined,
  prev: Partial<KDJResult> | null | undefined,
  settings: KDJConditionSettings = {},
): boolean => {
  if (!last) {
    return false
  }
  const line = settings.line ?? KDJLineEnum.k
  const compareTo = settings.compareTo ?? KDJLineEnum.d
  const condition = settings.condition ?? 'cu'
  const custom = compareTo === 'custom'
  if (line === compareTo) {
    return false
  }
  const a = kdjLine(last, line)
  const prevA = prev ? kdjLine(prev, line) : NaN
  let b: number
  let prevB: number
  if (custom) {
    const level =
      settings.level === null ||
      settings.level === undefined ||
      settings.level === ''
        ? 1
        : +settings.level
    b = level
    prevB = level
  } else {
    b = kdjLine(last, compareTo)
    prevB = prev ? kdjLine(prev, compareTo) : NaN
  }
  if (!lineCondition(condition, a, b, prevA, prevB)) {
    return false
  }
  const zone = settings.zone ?? KDJZoneEnum.none
  if (custom || zone === KDJZoneEnum.none) {
    return true
  }
  const band = (v: number | string | null | undefined) =>
    v === null || v === undefined || v === '' ? NaN : +v
  const upper =
    zone === KDJZoneEnum.lower
      ? Infinity
      : zone === KDJZoneEnum.upper
        ? band(settings.stochLower)
        : band(settings.stochUpper)
  const lower =
    zone === KDJZoneEnum.upper
      ? -Infinity
      : zone === KDJZoneEnum.lower
        ? band(settings.stochUpper)
        : band(settings.stochLower)
  if (isNaN(upper) || isNaN(lower)) {
    return false
  }
  const values = prev ? [a, b, prevA, prevB] : [a, b]
  return values.every((v) => v > upper) || values.every((v) => v < lower)
}
