import { LightIndicator, LightIndicatorState } from '../util/indicator'
import { PercentileResult } from '../types/result'
import { OHLCV } from '../types/candles'
import { EMA } from '../EMA/EMA'
import { SMA } from '../SMA/SMA'
import { WMA } from '../WMA/WMA'
import { DEMA } from '../DEMA/DEMA'
import { TEMA } from '../TEMA/TEMA'
import { VWMA } from '../VWMA/VWMA'
import { HMA } from '../HMA/HMA'
import { RMA } from '../RMA/RMA'
import { McGinley } from '../McGinley/McGinley'
import {
  CircularArrayState,
  Float64CircularArray,
  PercentileCalculator,
  lastIndexOfEnum,
  ohlcvValue,
} from '../util'

// Define type for supported moving average indicators
type MaIndicator = EMA | SMA | WMA | DEMA | TEMA | VWMA | HMA | RMA | McGinley

// Define state indices for performance and readability
enum MARState {
  VALUE = 0, // MAR value
  TREND = 1, // Trend value (0-3)
  MA_2_VALUE = 2, // Value of the second MA (if applicable)
}

/**
 * Moving Average Ribbon (MAR)
 * Type: Trend-Following/Momentum Indicator
 *
 * The Moving Average Ribbon (MAR) is a versatile trend analysis tool that calculates the ratio
 * between two moving averages or between a moving average and price. This ratio-based approach
 * provides normalized readings that make it easier to compare trend strength across different
 * securities and timeframes, regardless of absolute price levels.
 *
 * MAR effectively transforms the relationship between two trend indicators into a single
 * oscillating value that reveals trend direction, strength, and momentum changes. By using
 * ratios instead of absolute differences, MAR provides consistent signals across various
 * market conditions and price ranges.
 *
 * The indicator supports all major moving average types (EMA, SMA, WMA, DEMA, TEMA, VWMA, HMA, RMA,
 * McGinley)
 * and can compare:
 * - Fast MA vs Slow MA (traditional ribbon analysis)
 * - MA vs Current Price (price momentum relative to trend)
 * - Any combination of different MA types for hybrid analysis
 *
 * Trading Interpretation:
 * - MAR > 1.0: Numerator (MA2/Price) above denominator (MA1), bullish condition
 * - MAR < 1.0: Numerator (MA2/Price) below denominator (MA1), bearish condition
 * - MAR rising: Strengthening upward momentum
 * - MAR falling: Weakening momentum or increasing downward pressure
 * - MAR crossing 1.0: Trend change signal (bullish above, bearish below)
 * - Distance from 1.0: Measure of trend strength and momentum
 *
 * Advanced Features:
 * - Percentile Ranking: Historical context for current readings
 * - Trend Filtering: Additional confirmation based on historical trend strength
 * - Multi-MA Support: Flexibility to combine different smoothing algorithms
 * - Price Mode: Direct price-to-MA comparison for momentum analysis
 *
 * Strategy Applications:
 * - Trend Confirmation: Validate price movements with MA relationships
 * - Momentum Analysis: Identify acceleration/deceleration in trends
 * - Mean Reversion: Trade extreme MAR readings back toward 1.0
 * - Breakout Validation: Confirm breakouts with MA momentum alignment
 *
 * Formula:
 * - MAR = MA2 / MA1 (when using two MAs)
 * - MAR = Price / MA1 (when using price mode)
 * - Values > 1.0 indicate numerator strength, < 1.0 indicate denominator strength
 *
 * Candle Input Type: OHLCV (supports VWMA calculations and provides price flexibility)
 *
 * @see https://www.investopedia.com/articles/trading/10/ribbon-candy.asp
 * @see https://school.stockcharts.com/doku.php?id=technical_indicators:moving_averages
 */
export class MAR extends LightIndicator<PercentileResult, OHLCV> {
  // Component indicators
  private readonly ma1: MaIndicator
  private readonly ma2: MaIndicator | null = null

  // State tracking
  private readonly usePrice: boolean
  private readonly percentileCalc?: PercentileCalculator
  private readonly trendHistory?: Float64CircularArray
  private readonly trendDiff: number = 0

  /**
   * Creates a new Moving Average Ribbon (MAR) indicator
   *
   * @param ma1Type Type of first moving average ('EMA', 'SMA', 'WMA', 'DEMA', 'TEMA', 'VWMA', 'HMA', 'RMA',
   *                'MCGINLEY'), in either case.
   *                This becomes the denominator in the ratio calculation. Typically the longer-period MA.
   * @param ma1Interval Period for first moving average (typically 20-50 for longer-term trend).
   *                    Common values: 21, 26, 50 for different trend timeframes.
   * @param ma2Type Type of second moving average or 'price' to use current price directly.
   *                When using 'price', creates price-to-MA momentum indicator.
   *                This becomes the numerator in the ratio calculation.
   * @param ma2Interval Period for second moving average (typically 5-20 for shorter-term trend).
   *                    Common values: 9, 12, 21 for faster trend following. Ignored when ma2Type is 'price'.
   * @param percentile Whether to calculate percentile ranking of MAR values for historical context.
   *                   Useful for identifying extreme readings relative to historical data.
   * @param percentileLookback Number of periods for percentile calculation (typically 50-200).
   *                           Larger values provide more stable percentile rankings.
   * @param percentilePercentage Percentile level to use for ranking (default: 50 for median).
   *                            Common values: 25, 50, 75, 90 for different threshold analysis.
   * @param trendFilter Whether to apply additional trend filtering based on historical trend strength.
   *                    Adds confirmation layer to reduce false signals.
   * @param trendFilterLookback Lookback period for trend filtering analysis (typically 10-30).
   *                            Period over which to evaluate trend consistency.
   * @param trendFilterValue Threshold percentage for trend filtering (0-100).
   *                         Higher values require stronger trend confirmation.
   * @param trendFilterType Type of trend filter ('higher', 'lower', or 'neutral').
   *                        Determines direction bias for trend confirmation.
   */
  constructor(
    private readonly ma1Type: string,
    ma1Interval: number,
    private readonly ma2Type: string,
    ma2Interval: number,
    percentile?: boolean,
    percentileLookback?: number,
    percentilePercentage?: number,
    trendFilter?: boolean,
    trendFilterLookback?: number,
    trendFilterValue?: number,
    private readonly trendFilterType?: string,
  ) {
    /**
     * Initializes the parent LightIndicator with:
     * @param historyLength 1 - Only needs current candle since MAs handle historical processing
     * @param defaultValue ohlcvValue - Function to extract OHLCV candle data for MA calculations
     * @param stateSize lastIndexOfEnum(MARState) - Storage for value, trend, old_value, ma_2_value (4 elements)
     * @param fillValue NaN - Returns NaN during MA initialization until both components are ready
     */
    super(1, ohlcvValue, lastIndexOfEnum(MARState), NaN)

    // Check if we're using price instead of a second MA
    this.usePrice = ma2Type.toLowerCase() === 'price'

    // Create first moving average indicator
    this.ma1 = this.createMaIndicator(ma1Type, ma1Interval)

    // Create second moving average indicator if not using price
    if (!this.usePrice) {
      this.ma2 = this.createMaIndicator(ma2Type, ma2Interval)
    }

    // Initialize percentile calculator if needed
    if (percentile && percentileLookback) {
      this.percentileCalc = new PercentileCalculator(
        percentileLookback,
        percentilePercentage,
      )
    }

    // Initialize trend filtering if needed
    if (trendFilter && trendFilterLookback && trendFilterValue !== undefined) {
      this.trendHistory = new Float64CircularArray(trendFilterLookback + 1)
      this.trendDiff = trendFilterValue / 100
    }
  }

  /**
   * Create a moving average indicator based on type string
   */
  private createMaIndicator(type: string, interval: number): MaIndicator {
    switch (type.toUpperCase()) {
      case 'EMA':
        return new EMA(interval)
      case 'SMA':
        return new SMA(interval)
      case 'WMA':
        return new WMA(interval)
      case 'DEMA':
        return new DEMA(interval)
      case 'TEMA':
        return new TEMA(interval)
      case 'VWMA':
        return new VWMA(interval)
      case 'HMA':
        return new HMA(interval)
      case 'RMA':
        return new RMA(interval)
      case 'MCGINLEY':
        return new McGinley(interval)
      default:
        return new EMA(interval)
    }
  }

  /**
   * Calculate Moving Average Ribbon value
   */
  protected calculate(): PercentileResult | null {
    const s = this._state
    const l = this._history.last
    const ma1 = this.ma1
    const ma2 = this.ma2
    const th = this.trendHistory

    // Try different update methods based on indicator type
    // the type arrives in either case (bot settings send 'vwma'); VWMA reads
    // the candle's volume, the other averages the close
    if (this.ma1Type.toUpperCase() === 'VWMA') {
      ;(ma1 as VWMA).next(l)
    } else {
      ;(ma1 as any).next(l.close)
    }

    if (ma1.result === null) {
      return null
    }

    if (this.usePrice) {
      s[MARState.MA_2_VALUE] = l.close
    } else if (ma2) {
      // Try different update methods based on indicator type
      if (this.ma2Type.toUpperCase() === 'VWMA') {
        ;(ma2 as VWMA).next(l)
      } else {
        ;(ma2 as any).next(l.close)
      }

      if (ma2?.result === null) {
        return null
      }
      s[MARState.MA_2_VALUE] = ma2.result
    } else {
      return null
    }

    // Calculate MAR value (ratio of MA2 to MA1)
    s[MARState.VALUE] = s[MARState.MA_2_VALUE] / ma1.result

    if (th && this.trendFilterType) {
      // Store current value in trend history
      // Calculate trend if we have enough data
      if (th.add(s[MARState.VALUE])) {
        // Calculate trend based on filter type
        if (this.trendFilterType === 'lower') {
          // Downtrend: old value is higher by threshold percentage
          s[MARState.TREND] =
            (th.older - s[MARState.VALUE]) / th.older >= this.trendDiff ? 1 : 0
        } else if (this.trendFilterType === 'higher') {
          // Uptrend: current value is higher by threshold percentage
          s[MARState.TREND] =
            (s[MARState.VALUE] - th.older) / s[MARState.VALUE] >= this.trendDiff
              ? 2
              : 0
        } else {
          // Neutral: change is less than threshold percentage in either direction
          s[MARState.TREND] =
            (th.older - s[MARState.VALUE]) / th.older < this.trendDiff &&
            (s[MARState.VALUE] - th.older) / s[MARState.VALUE] < this.trendDiff
              ? 3
              : 0
        }
      }
    }

    // Handle percentile calculation if enabled
    if (this.percentileCalc) {
      if (this.percentileCalc.insert(s[MARState.VALUE])) {
        return {
          value: s[MARState.VALUE],
          percentile: this.percentileCalc.getPercentile(),
          trend: isNaN(s[MARState.TREND]) ? undefined : s[MARState.TREND],
        }
      }
    }

    return {
      value: s[MARState.VALUE],
      trend: isNaN(s[MARState.TREND]) ? undefined : s[MARState.TREND],
    }
  }

  /**
   * Exports the state of the indicator for restoration later
   */
  override exportState(): LightIndicatorState {
    return {
      bin: [],
      circ: [
        this.trendHistory?.exportState() ||
          ({} as CircularArrayState<any, any>),
      ],
      child: [
        this.ma1.exportState(),
        this.ma2?.exportState() || ({} as LightIndicatorState),
      ],
      parent: super.exportState(),
      percentile: this.percentileCalc?.exportState(),
    }
  }

  /**
   * Restores the state of the indicator
   * @param state Previously exported state
   */
  override restoreState(state: LightIndicatorState): void {
    if (!state.parent) {
      throw new Error('Invalid state: parent state is missing')
    }

    if (!state.child) {
      throw new Error('Invalid state: child states are missing')
    }

    // Restore first MA
    this.ma1.restoreState(state.child[0])

    // Restore second MA if applicable
    if (!this.usePrice && this.ma2) {
      this.ma2.restoreState(state.child[1])
    }

    // Restore trend history if applicable
    if (this.trendHistory && state.circ) {
      this.trendHistory.restoreState(state.circ[1])
    }

    // Restore percentile calculator if applicable
    if (this.percentileCalc && state.percentile) {
      this.percentileCalc.restoreState(state.percentile)
    }

    // Restore parent state
    super.restoreState(state.parent)
  }
}
