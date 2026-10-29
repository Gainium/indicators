import { LightIndicator } from '../util/indicator'
import { lastIndexOfEnum, ohlcValue } from '../util'
import { OHLC } from '../types/candles'
import { CandleResult } from '../types/result'

/** Which candle the colour is read from. */
export enum CandleSourceEnum {
  regular = 'regular',
  heikinAshi = 'heikinAshi',
}

/** The colour a candle condition requires. */
export enum CandleColorEnum {
  green = 'green',
  red = 'red',
}

/** When a candle condition is true. */
export enum CandleTriggerEnum {
  /** while the last N closed candles are all that colour */
  streak = 'streak',
  /** only on the N-th candle of the run (exactly N in a row), once per run */
  start = 'start',
}

/** Largest |streak| reported. */
export const CANDLE_STREAK_CAP = 1000

/**
 * Heikin Ashi candles fed before the first value. The seed's influence on
 * haOpen halves every bar, so after 30 bars it is below 2^-30 of the first
 * candle's body — the colour no longer depends on where the history starts.
 */
export const CANDLE_HA_SETTLE = 30

/** Largest `count` the bot setting offers (`candleCount` 1..50). */
export const CANDLE_MAX_COUNT = 50

/**
 * Candles needed before a candle condition is trustworthy for every
 * `count` up to `CANDLE_MAX_COUNT` and both sources: the Heikin Ashi settle
 * (30) plus `CANDLE_MAX_COUNT + 1` counted candles. With fewer, a run that
 * began before the history would be counted short: `streak >= 40` would fire
 * late and `streak === 40` (trigger `start`) on the wrong candle. With 51
 * counted candles a run longer than the history reads at least 51, which no
 * `count` up to 50 can equal.
 */
export const CANDLE_WARMUP = CANDLE_HA_SETTLE + CANDLE_MAX_COUNT + 1

enum CandleState {
  BARS = 0, // candles fed so far
  HA_OPEN = 1, // haOpen of the latest candle
  HA_CLOSE = 2, // haClose of the latest candle
  STREAK = 3, // signed run length of the latest colour
}

/** Resolve a stored source; anything unknown is Heikin Ashi (the default). */
export const resolveCandleSource = (
  source?: CandleSourceEnum | string | null,
): CandleSourceEnum =>
  source === CandleSourceEnum.regular
    ? CandleSourceEnum.regular
    : CandleSourceEnum.heikinAshi

/**
 * Candle colour
 * Type: Price Action
 *
 * The colour of the latest closed candle and how many candles in a row have
 * had it, read from the regular candle or from its Heikin Ashi transform
 * (TradingView's built-in Heikin Ashi formula):
 *
 * - haClose = (open + high + low + close) / 4
 * - haOpen = (previous haOpen + previous haClose) / 2, seeded on the first
 *   candle as (open + close) / 2
 * - haHigh = max(high, haOpen, haClose); haLow = min(low, haOpen, haClose)
 *
 * Colour: green (1) when close > open, red (−1) when close < open, 0 when
 * they are equal (a doji, which breaks every streak). Prices are compared
 * exactly — any absolute epsilon would be wrong on some symbol's scale.
 *
 * `streak` is the signed length of the current run: +3 = three green in a
 * row, −2 = two red, 0 on a doji; capped at ±`CANDLE_STREAK_CAP`.
 *
 * Decisions:
 * - Heikin Ashi emits `null` for the first `CANDLE_HA_SETTLE - 1` candles
 *   and starts counting the streak on the 30th, so no emitted value depends
 *   on the seed. The regular source has no recursion and emits from the
 *   first candle.
 * - The factory's warm-up is `CANDLE_WARMUP` (81) so that the streak is
 *   exact for every `count` the bot setting offers (see `CANDLE_WARMUP`).
 *
 * Candle Input Type: OHLC
 */
export class Candle extends LightIndicator<CandleResult, OHLC> {
  readonly source: CandleSourceEnum

  /** @param source - 'regular' or 'heikinAshi' (default) */
  constructor(source: CandleSourceEnum | string = CandleSourceEnum.heikinAshi) {
    super(1, ohlcValue, lastIndexOfEnum(CandleState), 0)
    this.source = resolveCandleSource(source)
    this._state[CandleState.HA_OPEN] = NaN
    this._state[CandleState.HA_CLOSE] = NaN
  }

  protected calculate(): CandleResult | null {
    const s = this._state
    const c = this._history.last
    s[CandleState.BARS] += 1
    let open = c.open
    let high = c.high
    let low = c.low
    let close = c.close
    if (this.source === CandleSourceEnum.heikinAshi) {
      const prevOpen = s[CandleState.HA_OPEN]
      const prevClose = s[CandleState.HA_CLOSE]
      close = (c.open + c.high + c.low + c.close) / 4
      open = isNaN(prevOpen)
        ? (c.open + c.close) / 2
        : (prevOpen + prevClose) / 2
      high = Math.max(c.high, open, close)
      low = Math.min(c.low, open, close)
      s[CandleState.HA_OPEN] = open
      s[CandleState.HA_CLOSE] = close
      if (s[CandleState.BARS] < CANDLE_HA_SETTLE) {
        return null
      }
    }
    const color = close > open ? 1 : close < open ? -1 : 0
    const prev = s[CandleState.STREAK]
    let streak: number
    if (color === 0) {
      streak = 0
    } else if (Math.sign(prev) === color) {
      streak = Math.min(Math.abs(prev) + 1, CANDLE_STREAK_CAP) * color
    } else {
      streak = color
    }
    s[CandleState.STREAK] = streak
    return { color, streak, open, high, low, close }
  }
}

export type CandleConditionSettings = {
  /** 'green' | 'red'; missing = green */
  color?: CandleColorEnum | string | null
  /** N candles in a row; missing / invalid / below 1 = 1 */
  count?: number | string | null
  /** 'streak' | 'start'; missing = streak */
  trigger?: CandleTriggerEnum | string | null
}

/** A stored candle count: a whole number ≥ 1, anything else 1. */
export const resolveCandleCount = (
  count: number | string | null | undefined,
): number => {
  const n = Math.floor(
    count === null || count === undefined || count === '' ? NaN : +count,
  )
  return isFinite(n) && n >= 1 ? n : 1
}

/**
 * The bot-condition decision of Candle colour, shared by the live engine and
 * the backtester so both fire on the same bars. Reads the newest bar only
 * (`prev` is accepted for a uniform signature and ignored):
 *
 * - `streak`: green → `streak >= N`, red → `streak <= −N`.
 * - `start`: green → `streak === N`, red → `streak === −N` (once per run).
 *
 * The colour of `last` must also be the required one, so a doji (colour 0,
 * streak 0) never fires. A missing result or value is false (JSON nulls
 * accepted); an unknown colour or trigger is false.
 */
export const candleCondition = (
  last: Partial<CandleResult> | null | undefined,
  _prev: Partial<CandleResult> | null | undefined,
  settings: CandleConditionSettings = {},
): boolean => {
  if (!last) {
    return false
  }
  const colorSetting = settings.color ?? CandleColorEnum.green
  const sign =
    colorSetting === CandleColorEnum.green
      ? 1
      : colorSetting === CandleColorEnum.red
        ? -1
        : 0
  if (sign === 0) {
    return false
  }
  const color =
    last.color === null || last.color === undefined ? NaN : +last.color
  const streak =
    last.streak === null || last.streak === undefined ? NaN : +last.streak
  if (color !== sign || !isFinite(streak)) {
    return false
  }
  const n = resolveCandleCount(settings.count)
  const trigger = settings.trigger ?? CandleTriggerEnum.streak
  if (trigger === CandleTriggerEnum.streak) {
    return sign * streak >= n
  }
  if (trigger === CandleTriggerEnum.start) {
    return sign * streak === n
  }
  return false
}
