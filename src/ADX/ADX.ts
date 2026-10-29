import { HLC } from '../types/candles'
import { ADXResult, PercentileResult } from '../types/result'
import {
  gt,
  hlcValue,
  lastIndexOfEnum,
  lineCondition,
  PercentileCalculator,
  resultNumber,
} from '../util'
import { LightIndicator, LightIndicatorState } from '../util/indicator'
import { WSMA } from '../WSMA/WSMA'

// Define state indices for performance and readability
enum ADXState {
  PDI = 0,
  MDI = 1,
  HIGHER_HIGH = 2,
  LOWER_LOW = 3,
  PMOVE = 4,
  MMOVE = 5,
  TRUE_RANGE = 6,
  DM_SUM = 7,
  DX_VALUE = 8,
}

/**
 * Average Directional Index (ADX) Indicator
 * Type: Trend Strength Indicator
 *
 * The ADX was developed by J. Welles Wilder Jr. and measures the strength of a trend without
 * regard to its direction. It is derived from the Directional Movement Index (DMI) which
 * includes the Plus Directional Indicator (+DI) and Minus Directional Indicator (-DI).
 *
 * ADX values range from 0 to 100. Generally, ADX readings below 20 indicate trend weakness,
 * readings above 40 indicate trend strength, and values above 50 suggest a strong trend.
 * ADX values of 75-100 signal an extremely strong trend.
 *
 * When +DI is above -DI, there is more upward pressure than downward pressure in the market.
 * When -DI is above +DI, there is more downward pressure than upward pressure.
 *
 * Formula:
 * - True Range (TR) = max(High - Low, |High - Previous Close|, |Low - Previous Close|)
 * - +DM = High - Previous High (when > 0 and > -DM), else 0
 * - -DM = Previous Low - Low (when > 0 and > +DM), else 0
 * - +DI = 100 × (Smoothed +DM / Smoothed TR)
 * - -DI = 100 × (Smoothed -DM / Smoothed TR)
 * - DX = 100 × (|+DI - -DI| / (+DI + -DI))
 * - ADX = Smoothed DX
 *
 * DMI mode (`withDI`, factory config `dmi: true`): the result also carries
 * +DI (`pdi`) and −DI (`mdi`) of the same bar — the DMI lines, same length as
 * the ADX (one length for DI and ADX smoothing, as TradingView's DMI with
 * equal "DI Length" and "ADX Smoothing"). They are reported from the first
 * bar the ADX itself has a value (DI alone would be ready ~`interval` bars
 * earlier; the ADX's warm-up is kept so its null bars do not move), and
 * `value` / `percentile` are the same numbers either way. Without `withDI`
 * the result is exactly what it was before 1.11.0. See `dmiCondition`.
 *
 * Candle Input Type: HLC (High, Low, Close)
 *
 * @see https://www.investopedia.com/terms/a/adx.asp
 * @see https://school.stockcharts.com/doku.php?id=technical_indicators:average_directional_index_adx
 */
export class ADX extends LightIndicator<PercentileResult | ADXResult, HLC> {
  // Components for DX calculation
  private readonly atrSum: WSMA
  private readonly upMoveSum: WSMA
  private readonly downMoveSum: WSMA
  private readonly adxSmoothing: WSMA

  // Percentile ranking
  private percentileCalc?: PercentileCalculator

  /**
   * Creates a new ADX indicator instance
   *
   * @param interval - The period for smoothing calculations (typically 14)
   * @param percentile - Whether to calculate percentile ranking (optional)
   * @param percentileLookback - Number of periods for percentile calculation (optional)
   * @param percentilePercentage - Percentile threshold percentage (optional)
   * @param withDI - also report +DI / −DI as `pdi` / `mdi` (DMI mode); off by
   *                 default so the plain ADX result is exactly what it was
   */
  constructor(
    interval: number,
    percentile?: boolean,
    percentileLookback?: number,
    percentilePercentage?: number,
    public readonly withDI: boolean = false,
  ) {
    /**
     * Initialize the LightIndicator parent class
     * @param historyLength - 2 (need current and previous candle for directional movement calculation)
     * @param defaultValue - hlcValue (default object with zero values, e.g., {high: 0, low: 0, close: 0})
     * @param stateSize - lastIndexOfEnum(ADXState) (size of Float64Array to store ADX calculation states)
     */
    super(2, hlcValue, lastIndexOfEnum(ADXState)) // We need 2 candles for directional movement, multiple state values

    // Initialize component indicators
    this.upMoveSum = new WSMA(interval)
    this.downMoveSum = new WSMA(interval)
    this.atrSum = new WSMA(interval)
    this.adxSmoothing = new WSMA(interval)

    // Initialize percentile calculator if needed
    if (percentile && percentileLookback) {
      this.percentileCalc = new PercentileCalculator(
        percentileLookback,
        percentilePercentage,
      )
    }
  }

  // Get +DI value
  get pdi(): number {
    return this._state[ADXState.PDI]
  }

  // Get -DI value
  get mdi(): number {
    return this._state[ADXState.MDI]
  }

  protected calculate(): PercentileResult | ADXResult | null {
    const h = this._history

    if (!h.isFilled) {
      return null
    }
    const s = this._state
    const last = h.last
    const prev = h.prev
    const atr = this.atrSum
    const upMoveSum = this.upMoveSum
    const downMoveSum = this.downMoveSum
    const adxSmoothing = this.adxSmoothing

    s[ADXState.TRUE_RANGE] = Math.max(
      last.high - last.low,
      Math.abs(last.high - prev.close),
      Math.abs(last.low - prev.close),
    )

    // Calculate directional movement
    s[ADXState.HIGHER_HIGH] = last.high - prev.high
    s[ADXState.LOWER_LOW] = prev.low - last.low

    // Plus Directional Movement (+DM)
    s[ADXState.PMOVE] =
      gt(s[ADXState.HIGHER_HIGH], 0) &&
      gt(s[ADXState.HIGHER_HIGH], s[ADXState.LOWER_LOW])
        ? s[ADXState.HIGHER_HIGH]
        : 0

    // Minus Directional Movement (-DM)
    s[ADXState.MMOVE] =
      gt(s[ADXState.LOWER_LOW], 0) &&
      gt(s[ADXState.LOWER_LOW], s[ADXState.HIGHER_HIGH])
        ? s[ADXState.LOWER_LOW]
        : 0

    // If we don't have enough data yet, return null
    atr.next(s[ADXState.TRUE_RANGE])
    upMoveSum.next(s[ADXState.PMOVE])
    downMoveSum.next(s[ADXState.MMOVE])
    if (
      atr.result === null ||
      upMoveSum.result === null ||
      downMoveSum.result === null
    ) {
      return null
    }

    // Calculate +DI and -DI
    if (atr.result === 0) {
      s[ADXState.PDI] = 0
      s[ADXState.MDI] = 0
      s[ADXState.DX_VALUE] = 0
    } else {
      s[ADXState.PDI] = (upMoveSum.result! / atr.result) * 100
      s[ADXState.MDI] = (downMoveSum.result! / atr.result) * 100

      // Calculate DX
      s[ADXState.DM_SUM] = s[ADXState.PDI] + s[ADXState.MDI]

      if (s[ADXState.DM_SUM] === 0) {
        s[ADXState.DX_VALUE] = 0
      } else {
        s[ADXState.DX_VALUE] =
          (Math.abs(s[ADXState.PDI] - s[ADXState.MDI]) / s[ADXState.DM_SUM]) *
          100
      }
    }

    if (adxSmoothing.next(s[ADXState.DX_VALUE]) === null) {
      return null
    }

    // Handle percentile calculation if needed
    if (this.percentileCalc) {
      if (this.percentileCalc.insert(adxSmoothing.result!)) {
        return this.withDI
          ? {
              value: adxSmoothing.result!,
              percentile: this.percentileCalc.getPercentile(),
              pdi: s[ADXState.PDI],
              mdi: s[ADXState.MDI],
            }
          : {
              value: adxSmoothing.result!,
              percentile: this.percentileCalc.getPercentile(),
            }
      }
    }

    return this.withDI
      ? {
          value: adxSmoothing.result!,
          pdi: s[ADXState.PDI],
          mdi: s[ADXState.MDI],
        }
      : { value: adxSmoothing.result! }
  }

  override exportState(): LightIndicatorState {
    return {
      bin: [],
      circ: [],
      parent: super.exportState(),
      child: [
        this.atrSum.exportState(),
        this.upMoveSum.exportState(),
        this.downMoveSum.exportState(),
        this.adxSmoothing.exportState(),
      ],
      percentile: this.percentileCalc?.exportState(),
    }
  }

  override restoreState(state: LightIndicatorState): void {
    if (!state.parent) {
      throw new Error('Invalid state: parent state is missing')
    }
    if (!state.child?.length) {
      throw new Error('Invalid state: child state is missing')
    }
    this.atrSum.restoreState(state.child[0])
    this.upMoveSum.restoreState(state.child[1])
    this.downMoveSum.restoreState(state.child[2])
    this.adxSmoothing.restoreState(state.child[3])
    if (this.percentileCalc && state.percentile) {
      this.percentileCalc.restoreState(state.percentile)
    }
    super.restoreState(state.parent)
  }
}

/** What a DMI condition compares: +DI against −DI. */
export type DMIConditionSettings = {
  /**
   * The bot's `indicatorCondition`, read as "+DI ... −DI":
   * `cu` +DI crosses above −DI, `cd` +DI crosses below −DI,
   * `gt` +DI above −DI, `lt` +DI below −DI. Missing = `cu`.
   */
  condition?: string
}

/**
 * The bot-condition decision of the ADX indicator's DMI mode (+DI vs −DI),
 * shared by the live engine and the backtester so both fire on the same bars.
 * `last` is the newest ADX result, `prev` the one before it (only needed for
 * crossings). Results that went through JSON (NaN → null) are accepted.
 *
 * +DI is the indicator side and −DI the line it is compared with, through
 * `lineCondition` — the engine's own crossing rule: `cu` = +DI above −DI now
 * and at or below it on `prev`; `cd` = +DI below −DI now and at or above it
 * on `prev`; `gt` / `lt` read `last` only. A missing result or DI value is
 * false — as for an ADX built without `withDI`. It reads only `pdi` / `mdi`:
 * the indicator room needs the ADX length and `dmi: true`; smoothing and
 * percentile do not affect the DI lines.
 */
export const dmiCondition = (
  last: Partial<ADXResult> | null | undefined,
  prev: Partial<ADXResult> | null | undefined,
  settings: DMIConditionSettings = {},
): boolean => {
  if (!last) {
    return false
  }
  return lineCondition(
    settings.condition ?? 'cu',
    resultNumber(last.pdi),
    resultNumber(last.mdi),
    resultNumber(prev?.pdi),
    resultNumber(prev?.mdi),
  )
}
