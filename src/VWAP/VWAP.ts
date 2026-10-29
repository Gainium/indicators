import { LightIndicator } from '../util/indicator'
import { lastIndexOfEnum, ohlcvtValue } from '../util'
import { lineCondition, resultNumber } from '../util/condition'
import { OHLCVT } from '../types/candles'
import { VWAPResult } from '../types/result'

/** Where an anchored VWAP restarts, in UTC. */
export enum VWAPAnchorEnum {
  /** every day at 00:00 UTC */
  day = 'day',
  /** every Monday at 00:00 UTC (TradingView's weekly session for crypto) */
  week = 'week',
  /** the 1st of every month at 00:00 UTC */
  month = 'month',
}

const DAY = 86_400_000
const WEEK = 7 * DAY
/** 1970-01-05 00:00 UTC, the first Monday of the epoch */
const FIRST_MONDAY = 4 * DAY

/** Normalises a stored anchor (any case, trimmed); anything unknown = day. */
export function resolveVWAPAnchor(anchor?: string | null): VWAPAnchorEnum {
  const a = typeof anchor === 'string' ? anchor.trim().toLowerCase() : ''
  return a === VWAPAnchorEnum.week
    ? VWAPAnchorEnum.week
    : a === VWAPAnchorEnum.month
      ? VWAPAnchorEnum.month
      : VWAPAnchorEnum.day
}

/** Start (ms, UTC) of the anchor period that contains `time`. */
export function vwapPeriodStart(
  time: number,
  anchor: VWAPAnchorEnum | string,
): number {
  switch (resolveVWAPAnchor(anchor)) {
    case VWAPAnchorEnum.week:
      return FIRST_MONDAY + Math.floor((time - FIRST_MONDAY) / WEEK) * WEEK
    case VWAPAnchorEnum.month: {
      const d = new Date(time)
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
    }
    default:
      return Math.floor(time / DAY) * DAY
  }
}

/**
 * Candles `getWarmupCandles` asks for per anchor. The factory does not know
 * the candle interval, so each covers one whole period plus a candle on the
 * smallest interval that anchor is normally used with — a day of 1m candles,
 * a week of 5m candles, a 31-day month of 15m candles — which guarantees the
 * history crosses a period start and VWAP has a value from the first live
 * candle. On smaller intervals the history may start inside the current
 * period; VWAP then stays null until the next period starts (it never
 * reports a partial period).
 */
export const VWAP_WARMUP: Record<VWAPAnchorEnum, number> = {
  [VWAPAnchorEnum.day]: 1440 + 1,
  [VWAPAnchorEnum.week]: 7 * 24 * 12 + 1,
  [VWAPAnchorEnum.month]: 31 * 24 * 4 + 1,
}

enum VWAPState {
  PERIOD_START = 0, // start of the period being accumulated (NaN = none)
  FULL = 1, // 1 when that period was seen from its start
  SEEN = 2, // 1 once any timed candle was fed
  SUM_V = 3, // Σ volume
  SUM_VS = 4, // Σ volume × hlc3
  MEAN = 5, // running weighted mean of hlc3 (for the variance)
  M2 = 6, // Σ volume × (hlc3 − mean)², West's weighted update
}

/**
 * Anchored VWAP (Volume Weighted Average Price) with standard-deviation bands
 * Type: Volume / Trend
 *
 * TradingView's built-in VWAP: the volume-weighted average of hlc3
 * ((high + low + close) / 3) since the anchor, restarting at every anchor
 * boundary in UTC — `day` (00:00), `week` (Monday 00:00) or `month` (the 1st,
 * 00:00). Bands in TradingView's "Standard Deviation" mode:
 *
 * - VWAP = Σ(v × hlc3) / Σv
 * - stdev = √(Σ(v × hlc3²) / Σv − VWAP²)  (0 when rounding makes it negative)
 * - upper / lower = VWAP ± bandMultiplier × stdev
 *
 * The variance is accumulated with West's weighted update instead of the raw
 * Σ(v × hlc3²), which is the same quantity without the cancellation error of
 * squaring prices; results agree with the textbook formula to rounding.
 *
 * Decisions:
 * - **Partial first period.** The first period in the history is skipped
 *   (result `null`) unless its first candle opens exactly on the period
 *   start: a VWAP built from part of a day is not the day's VWAP. Values
 *   start with the first candle of the next period.
 * - **Candles without a time** (no finite `time`) cannot be placed in a
 *   period: they are not accumulated and leave the VWAP unchanged; the
 *   result reports their close as `price` (or stays null before the first
 *   whole period).
 * - **Volume** that is not a positive number counts as 0. While the period
 *   has no volume, `vwap`, `stdev`, `upper` and `lower` are NaN.
 * - `upper` / `lower` use this instance's `bandMultiplier`, for charts and
 *   archive reads; `vwapCondition` recomputes the bands from `vwap` and
 *   `stdev` with the condition's own multiplier, so the multiplier is not a
 *   setting of the indicator room.
 *
 * Candle Input Type: OHLCVT (OHLCV + candle open time in ms)
 */
export class VWAP extends LightIndicator<VWAPResult, OHLCVT> {
  readonly anchor: VWAPAnchorEnum
  readonly bandMultiplier: number

  /**
   * @param anchor - where the VWAP restarts: 'day' (default), 'week', 'month'
   * @param bandMultiplier - band width in standard deviations (default 1)
   */
  constructor(
    anchor: VWAPAnchorEnum | string = VWAPAnchorEnum.day,
    bandMultiplier: number = 1,
  ) {
    super(1, ohlcvtValue, lastIndexOfEnum(VWAPState), NaN)
    this.anchor = resolveVWAPAnchor(anchor)
    const m = +bandMultiplier
    this.bandMultiplier = Number.isFinite(m) ? m : 1
    this._state[VWAPState.FULL] = 0
    this._state[VWAPState.SEEN] = 0
    this.reset()
  }

  private reset() {
    const s = this._state
    s[VWAPState.SUM_V] = 0
    s[VWAPState.SUM_VS] = 0
    s[VWAPState.MEAN] = 0
    s[VWAPState.M2] = 0
  }

  protected calculate(): VWAPResult | null {
    const s = this._state
    const candle = this._history.last
    const time = candle.time
    if (typeof time === 'number' && Number.isFinite(time)) {
      const start = vwapPeriodStart(time, this.anchor)
      if (start !== s[VWAPState.PERIOD_START]) {
        s[VWAPState.FULL] = s[VWAPState.SEEN] === 1 || time === start ? 1 : 0
        s[VWAPState.PERIOD_START] = start
        this.reset()
      }
      s[VWAPState.SEEN] = 1
      const v = candle.volume > 0 ? +candle.volume : 0
      if (v > 0) {
        const src = (candle.high + candle.low + candle.close) / 3
        const w = s[VWAPState.SUM_V]
        const total = w + v
        const delta = src - s[VWAPState.MEAN]
        const r = (delta * v) / total
        s[VWAPState.MEAN] += r
        s[VWAPState.M2] += w * delta * r
        s[VWAPState.SUM_V] = total
        s[VWAPState.SUM_VS] += v * src
      }
    }
    if (s[VWAPState.FULL] !== 1 || isNaN(s[VWAPState.PERIOD_START])) {
      return null
    }
    const sumV = s[VWAPState.SUM_V]
    const vwap = sumV > 0 ? s[VWAPState.SUM_VS] / sumV : NaN
    const stdev =
      sumV > 0 ? Math.sqrt(Math.max(0, s[VWAPState.M2] / sumV)) : NaN
    const band = this.bandMultiplier * stdev
    return {
      vwap,
      stdev,
      upper: vwap + band,
      lower: vwap - band,
      price: candle.close,
      periodStart: s[VWAPState.PERIOD_START],
    }
  }
}

/** A VWAP line a condition can compare the close with. */
export enum VWAPLineEnum {
  vwap = 'vwap',
  upper = 'upper',
  lower = 'lower',
}

export type VWAPConditionSettings = {
  /** missing = vwap */
  line?: VWAPLineEnum | string
  /** band width in standard deviations for upper / lower; missing = 1 */
  bandMultiplier?: number | string | null
  /** 'cd' | 'cu' | 'gt' | 'lt'; missing = 'cu' */
  condition?: string
}

/**
 * Price of `line` in a VWAP result: the VWAP, or VWAP ± `bandMultiplier` ×
 * stdev for a band (computed from `vwap` and `stdev`, never from the
 * result's own `upper` / `lower`). NaN when there is no value.
 */
export const vwapLineValue = (
  result: Partial<VWAPResult> | null | undefined,
  line: VWAPLineEnum | string = VWAPLineEnum.vwap,
  bandMultiplier: number | string | null = 1,
): number => {
  if (!result) {
    return NaN
  }
  const vwap = resultNumber(result.vwap)
  if (line === VWAPLineEnum.vwap) {
    return vwap
  }
  const m =
    bandMultiplier === null || bandMultiplier === '' ? 1 : +bandMultiplier
  const band = m * resultNumber(result.stdev)
  return line === VWAPLineEnum.upper
    ? vwap + band
    : line === VWAPLineEnum.lower
      ? vwap - band
      : NaN
}

/**
 * The bot-condition decision of VWAP, shared by the live engine and the
 * backtester so both fire on the same bars: the close (`price`) against the
 * chosen line (`vwapLineValue`), through `lineCondition` — the engine's own
 * rule, as for Bollinger / Keltner bands vs price:
 *
 * - `gt` / `lt`: the close is above / below the line on `last`.
 * - `cu` / `cd`: the close is above / below the line on `last` and was at or
 *   below / at or above it on `prev` — and only when both bars belong to the
 *   SAME anchor period. At a period start the VWAP restarts from the new
 *   period's first candle, and that jump is not a crossing.
 *
 * A missing result or value is false (JSON nulls accepted).
 */
export const vwapCondition = (
  last: Partial<VWAPResult> | null | undefined,
  prev: Partial<VWAPResult> | null | undefined,
  settings: VWAPConditionSettings = {},
): boolean => {
  if (!last) {
    return false
  }
  const line = settings.line ?? VWAPLineEnum.vwap
  const m = settings.bandMultiplier ?? 1
  const condition = settings.condition ?? 'cu'
  const price = resultNumber(last.price)
  const level = vwapLineValue(last, line, m)
  if (condition !== 'cu' && condition !== 'cd') {
    return lineCondition(condition, price, level)
  }
  if (
    !prev ||
    isNaN(resultNumber(last.periodStart)) ||
    resultNumber(prev.periodStart) !== resultNumber(last.periodStart)
  ) {
    return false
  }
  return lineCondition(
    condition,
    price,
    level,
    resultNumber(prev.price),
    vwapLineValue(prev, line, m),
  )
}
