import { LightIndicator, LightIndicatorState } from '../util/indicator'
import { Float64CircularArray } from '../util/array'
import { lastIndexOfEnum, ohlcvValue } from '../util'
import { resultNumber } from '../util/condition'
import { OHLCV } from '../types/candles'
import { MATrendResult } from '../types/result'
import { TrendFilterOperatorEnum } from '../types/config'
import { VWMA } from '../VWMA/VWMA'

/**
 * Trend code of the MAR trend filter, for a series that is `current` now and
 * was `older` `lookback` bars ago, with threshold `diff` (a fraction:
 * `trendFilterValue / 100`). The same arithmetic as `MAR`:
 *
 * - `lower`: (older − current) / older ≥ diff → 1, else 0
 * - `higher`: (current − older) / current ≥ diff → 2, else 0 (note: relative
 *   to the CURRENT value, as MAR does)
 * - anything else (`between`): both of those changes < diff → 3, else 0
 */
export function trendFilterCode(
  current: number,
  older: number,
  type: TrendFilterOperatorEnum | string,
  diff: number,
): number {
  if (type === 'lower') {
    return (older - current) / older >= diff ? 1 : 0
  }
  if (type === 'higher') {
    return (current - older) / current >= diff ? 2 : 0
  }
  return (older - current) / older < diff && (current - older) / current < diff
    ? 3
    : 0
}

/** The plain moving averages the factory builds for `IndicatorEnum.ma`. */
export interface MovingAverageLike {
  next(value: never): number | null
  exportState(): LightIndicatorState
  restoreState(state: LightIndicatorState): void
}

enum MATrendState {
  TREND = 0, // latest trend code (NaN until the lookback is filled)
}

/**
 * Moving Average with the MAR trend filter — the Moving Average indicator
 * when its `trendFilter` setting is on.
 *
 * Wraps the plain moving average the factory builds for the same type and
 * length, feeds it every candle (VWMA gets the candle, every other type the
 * close, as `feedCandle` does) and reports its value unchanged as `value`,
 * plus `trend`: the MA now against the MA `lookback` bars ago, coded exactly
 * like MAR's trend filter (`trendFilterCode`, same parameter names:
 * `trendFilterLookback`, `trendFilterValue` in percent, `trendFilterType`
 * lower / higher / between). `trend` is undefined until `lookback` bars of MA
 * values exist, and stays undefined when the filter settings are incomplete
 * (no lookback ≥ 1, no numeric value, or no type), so the filter never
 * passes — as MAR.
 *
 * Without the trend filter the factory returns the plain MA instead, whose
 * result (a number) is unchanged.
 *
 * Candle Input Type: OHLCV
 */
export class MATrendFilter extends LightIndicator<MATrendResult, OHLCV> {
  private readonly history?: Float64CircularArray
  private readonly diff: number = 0
  private readonly usesCandle: boolean

  /**
   * @param inner - the plain moving average (EMA, SMA, ..., VWMA, McGinley)
   * @param trendFilterLookback - bars between the two MA values compared
   * @param trendFilterValue - threshold, percent
   * @param trendFilterType - 'lower' | 'higher' | 'between'
   */
  constructor(
    public readonly inner: MovingAverageLike,
    trendFilterLookback?: number,
    trendFilterValue?: number,
    private readonly trendFilterType?: TrendFilterOperatorEnum | string,
  ) {
    super(1, ohlcvValue, lastIndexOfEnum(MATrendState), NaN)
    this.usesCandle = inner instanceof VWMA
    const lookback = Math.floor(+(trendFilterLookback ?? NaN))
    const value =
      trendFilterValue === null || trendFilterValue === undefined
        ? NaN
        : +trendFilterValue
    if (lookback >= 1 && Number.isFinite(value) && trendFilterType) {
      this.history = new Float64CircularArray(lookback + 1)
      this.diff = value / 100
    }
  }

  protected calculate(): MATrendResult | null {
    const s = this._state
    const candle = this._history.last
    const value = (this.inner as { next(v: unknown): number | null }).next(
      this.usesCandle ? candle : candle.close,
    )
    if (value === null) {
      return null
    }
    const h = this.history
    if (h && h.add(value)) {
      s[MATrendState.TREND] = trendFilterCode(
        value,
        h.older,
        this.trendFilterType as string,
        this.diff,
      )
    }
    return {
      value,
      trend: isNaN(s[MATrendState.TREND]) ? undefined : s[MATrendState.TREND],
    }
  }

  override exportState(): LightIndicatorState {
    return {
      bin: [],
      circ: this.history ? [this.history.exportState()] : [],
      child: [this.inner.exportState()],
      parent: super.exportState(),
    }
  }

  override restoreState(state: LightIndicatorState): void {
    if (!state.parent || !state.child?.length) {
      throw new Error('Invalid state: MA trend filter state is incomplete')
    }
    this.inner.restoreState(state.child[0])
    if (this.history && state.circ?.[0]) {
      this.history.restoreState(state.circ[0])
    }
    super.restoreState(state.parent)
  }
}

export type TrendFilterConditionSettings = {
  /** 'lower' | 'higher' | 'between' */
  trendFilterType?: TrendFilterOperatorEnum | string | null
}

/**
 * The trend-filter gate of the bot engine, shared by the live engine and the
 * backtester: true when the latest result's `trend` code matches the filter
 * type — `lower` ↔ 1, `higher` ↔ 2, `between` ↔ 3 — exactly the engine's MAR
 * check. Reads any result with a `trend` (MA with the trend filter, MAR). The
 * filter is an AND gate: the condition fires when its own comparison (e.g.
 * price vs MA) is true AND this is true. False for a missing result, a
 * missing / null trend or an unknown type.
 */
export const trendFilterCondition = (
  last: { trend?: number | null } | null | undefined,
  settings: TrendFilterConditionSettings,
): boolean => {
  if (!last) {
    return false
  }
  const trend = resultNumber(last.trend)
  switch (settings.trendFilterType) {
    case TrendFilterOperatorEnum.lower:
      return trend === 1
    case TrendFilterOperatorEnum.higher:
      return trend === 2
    case TrendFilterOperatorEnum.between:
      return trend === 3
    default:
      return false
  }
}
