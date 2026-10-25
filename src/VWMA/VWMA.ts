import { SMA } from '../SMA/SMA'
import { eq } from '../util/math'
import { LightIndicator, LightIndicatorState } from '../util/indicator'
import { OHLCV } from '../types/candles'
import { ohlcvValue } from '../util'

/**
 * Volume Weighted Moving Average (VWMA)
 * Type: Trend-Following / Volume-Weighted
 *
 * The Volume Weighted Moving Average (VWMA) is a sophisticated trend-following indicator
 * that assigns proportionally greater weight to price movements occurring on higher
 * trading volume. Unlike traditional moving averages that treat all price points equally,
 * the VWMA recognizes that high-volume price movements carry more significance and
 * should have greater influence on the trend calculation.
 *
 * This indicator was developed to address the limitation of simple moving averages
 * which ignore volume information entirely. The VWMA provides a more realistic
 * representation of price trends by incorporating the conviction behind price
 * movements as measured by trading volume. When large institutional traders
 * or significant market participants move prices on high volume, these movements
 * are given appropriate weight in the trend calculation.
 *
 * The VWMA is particularly effective during periods of varying volume patterns,
 * where it can distinguish between meaningful price movements (high volume) and
 * less significant fluctuations (low volume). This makes it especially valuable
 * for identifying genuine trend changes versus temporary price noise.
 *
 * Key Characteristics:
 * - Volume-weighted trend calculation with adaptive sensitivity
 * - Emphasizes high-volume price movements over low-volume fluctuations
 * - More responsive to institutional and significant market activity
 * - Reduces the impact of low-volume, potentially misleading price movements
 * - Provides smoother trend representation in volatile, mixed-volume conditions
 *
 * Trading Interpretation:
 * - Rising VWMA: Bullish trend supported by volume, strong upward momentum
 * - Falling VWMA: Bearish trend supported by volume, strong downward momentum
 * - Price above VWMA: Bullish bias, volume-supported uptrend
 * - Price below VWMA: Bearish bias, volume-supported downtrend
 * - Steepening VWMA slope: Accelerating trend with volume confirmation
 * - Flattening VWMA slope: Decelerating trend, potential consolidation
 * - VWMA convergence with price: Strong trend continuation signal
 *
 * Volume-Weight Analysis:
 * - High-volume periods: VWMA closely follows price action
 * - Low-volume periods: VWMA maintains previous trend direction
 * - Volume spikes: Rapid VWMA adjustment to new price levels
 * - Volume decline: VWMA smooths out price volatility
 * - Institutional activity: VWMA captures large player movements
 *
 * Advanced Analysis Techniques:
 * - Trend Strength Assessment: Compare VWMA slope with price momentum
 * - Volume Confirmation: Validate breakouts with VWMA direction changes
 * - Support/Resistance: VWMA acts as dynamic support in uptrends, resistance in downtrends
 * - Divergence Analysis: Price vs. VWMA divergences signal potential reversals
 * - Multiple Timeframes: Use VWMA across timeframes for trend hierarchy
 *
 * Strategy Applications:
 * - Trend Following: Enter positions in VWMA direction with volume support
 * - Breakout Trading: Confirm breakouts when price moves decisively above/below VWMA
 * - Swing Trading: Use VWMA as dynamic support/resistance for entry/exit points
 * - Position Trading: VWMA direction determines overall market bias
 * - Risk Management: Exit positions when price moves significantly against VWMA
 * - Entry Timing: Enter near VWMA in trending markets for better risk/reward
 *
 * Market Condition Adaptations:
 * - High Volume Markets: VWMA provides excellent trend definition
 * - Low Volume Markets: VWMA may lag, combine with other indicators
 * - Trending Markets: VWMA serves as reliable trend-following tool
 * - Sideways Markets: VWMA helps identify when trends are weakening
 * - Volatile Markets: VWMA smooths volatility while preserving volume-based moves
 * - News-driven Markets: VWMA quickly adapts to volume-confirmed news reactions
 *
 * Parameter Guidelines:
 * - Short-term: 10-20 periods (responsive, good for active trading)
 * - Medium-term: 21-50 periods (balanced approach, swing trading)
 * - Long-term: 50+ periods (smooth trends, position trading)
 * - Shorter periods: More responsive to volume changes, faster signals
 * - Longer periods: Smoother trends, less noise, better for major trend identification
 *
 * Advantages:
 * - Incorporates volume information for more meaningful trend analysis
 * - Reduces impact of low-volume price noise and false signals
 * - Adapts to market participation levels automatically
 * - Excellent for identifying institutional and significant market activity
 * - Provides more reliable support/resistance levels than simple moving averages
 * - Works well across different market conditions and timeframes
 *
 * Limitations:
 * - Requires reliable volume data (may be limited in some markets)
 * - Can be slower to respond in consistently low-volume conditions
 * - May give false signals during artificial volume spikes
 * - Less effective in markets where volume doesn't correlate with price significance
 * - Can be whipsawed during erratic volume patterns
 *
 * Formula: VWMA = Σ(Price × Volume) / Σ(Volume)
 * Input Type: OHLCV (uses Close price and Volume)
 *
 * @see https://www.investopedia.com/articles/trading/11/trading-with-vwap-mvwap.asp
 * @see https://stockcharts.com/school/doku.php?id=chart_school:technical_indicators:volume_by_price
 * @see https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/vwma
 */
export class VWMA extends LightIndicator<number, OHLCV> {
  // Component SMAs
  private readonly _volumePriceSMA: SMA
  private readonly _volumeSMA: SMA

  /**
   * Creates a Volume Weighted Moving Average indicator
   *
   * @param interval The lookback period for volume-weighted calculation (typically 10-50)
   *                 - Short-term: 10-20 (responsive, active trading)
   *                 - Medium-term: 21-30 (balanced, swing trading)
   *                 - Long-term: 50+ (smooth, position trading)
   */
  constructor(public readonly interval: number) {
    // Initialize with historyLength=1 (only needs current candle),
    // defaultValue as ohlcvValue function for OHLCV input processing,
    // stateSize=0 (no internal state array needed - uses child SMAs)
    super(1, ohlcvValue, 0)
    this._volumePriceSMA = new SMA(interval)
    this._volumeSMA = new SMA(interval)
  }

  /**
   * Calculate VWMA based on current history
   */
  protected calculate(): number | null {
    const l = this._history.last
    const vp = this._volumePriceSMA
    const v = this._volumeSMA
    // Update the volume-price and volume SMAs on every bar: returning
    // after the first one while it warms up left the volume SMA a full
    // window behind, so VWMA took twice its length to give a value
    const volumePrice = vp.next(l.close * l.volume)
    const volume = v.next(l.volume)
    if (volumePrice === null || volume === null) {
      return null
    }

    // Prevent division by zero
    if (eq(v.result!, 0)) {
      return vp.result!
    }

    // Calculate and return the VWMA
    return vp.result! / v.result!
  }

  /**
   * Export the state of this indicator for persistence
   */
  exportState(): LightIndicatorState {
    return {
      bin: [],
      circ: [],
      child: [
        this._volumePriceSMA.exportState(),
        this._volumeSMA.exportState(),
      ],
      parent: super.exportState(),
    }
  }

  /**
   * Restore the state of this indicator from a previously exported state
   */
  restoreState(state: LightIndicatorState): void {
    if (!state.parent) {
      throw new Error('Invalid state: parent state is missing')
    }
    if (!state.child || state.child.length < 2) {
      throw new Error('Invalid state: child states are missing')
    }

    this._volumePriceSMA.restoreState(state.child[0])
    this._volumeSMA.restoreState(state.child[1])

    super.restoreState(state.parent)
  }
}
