import { LightIndicator } from '../util/indicator'
import { PCResult } from '../types/result'
import { OHLC } from '../types/candles'
import { ohlcValue } from '../util'

/**
 * Price Channel (PC)
 * Type: Volatility/Breakout Detection Indicator
 *
 * The Price Channel indicator is a volatility-based breakout detection tool that monitors
 * intraday price movements relative to the opening price. It signals when price has moved
 * beyond specified percentage thresholds in either direction, making it valuable for
 * identifying volatility spikes, breakouts from consolidation, and significant intraday moves.
 *
 * This indicator is particularly useful for intraday trading strategies where detecting
 * significant moves early in the session can provide profitable opportunities. By comparing
 * the high and low of each period to the opening price, it captures the full range of
 * price action within each candle.
 *
 * The indicator works by calculating percentage moves from the opening price and triggering
 * boolean signals when these moves exceed predefined thresholds. This approach normalizes
 * volatility detection across different price levels and securities, making it adaptable
 * to various markets and timeframes.
 *
 * Trading Interpretation:
 * - Up Signal (true): High price has moved above open by more than upward threshold
 * - Down Signal (true): Low price has moved below open by more than downward threshold
 * - Both Signals false: Price remains within acceptable volatility range
 * - Both Signals true: Exceptional volatility with wide intraday range
 *
 * Use Cases:
 * - Breakout Detection: Identify when price breaks significant percentage levels
 * - Volatility Filtering: Screen for periods of abnormal price movement
 * - Gap Analysis: Detect significant intraday moves after market opens
 * - Risk Management: Set alerts for excessive volatility in positions
 * - Entry Timing: Wait for volatility confirmation before entering trades
 *
 * Strategy Applications:
 * - Momentum Trading: Enter trades when volatility thresholds are breached
 * - Range Trading: Avoid trading when excessive volatility is detected
 * - News Trading: Detect market reactions to economic announcements
 * - Consolidation Breakouts: Identify exits from sideways price action
 *
 * Formula:
 * - Up Signal = (High - Open) / Open * 100 > upThreshold
 * - Down Signal = (Open - Low) / Open * 100 > downThreshold
 * - Percentage calculations normalize for different price levels
 *
 * Candle Input Type: OHLC (requires Open for baseline, High/Low for range measurement)
 *
 * @see https://www.investopedia.com/terms/v/volatility.asp
 * @see https://www.investopedia.com/terms/b/breakout.asp
 */
export class PC extends LightIndicator<PCResult, OHLC> {
  /**
   * Creates a new Price Channel indicator
   *
   * @param upThreshold Percentage threshold for upward price movement (typically 1-10%).
   *                    When (High - Open) / Open * 100 exceeds this value, up signal triggers.
   *                    Common values: 1-2% (sensitive), 3-5% (moderate), 5-10% (conservative).
   * @param downThreshold Percentage threshold for downward price movement (typically 1-10%).
   *                      When (Open - Low) / Open * 100 exceeds this value, down signal triggers.
   *                      Should match upThreshold for symmetric volatility detection.
   */
  constructor(
    private readonly upThreshold: number,
    private readonly downThreshold: number,
  ) {
    /**
     * Initializes the parent LightIndicator with:
     * @param historyLength 1 - Only needs current candle for intraday range analysis
     * @param defaultValue ohlcValue - Function to extract OHLC candle data for price calculations
     * @param stateSize 0 - No internal state storage needed, calculates directly from candle
     * @param fillValue undefined - Uses default fill behavior, always returns result
     */
    super(1, ohlcValue, 0)
  }

  /**
   * Calculate Price Channel values
   */
  protected calculate(): PCResult | null {
    const l = this._history.last
    const upPct = Math.abs((l.high - l.open) / l.open) * 100
    const downPct = Math.abs((l.open - l.low) / l.open) * 100

    return {
      up: upPct > this.upThreshold,
      down: downPct > this.downThreshold,
      upPct,
      downPct,
    }
  }
}

/**
 * How the candle's move is compared with the setting value(s).
 * Missing = `gt` (the only behaviour before 1.13.0).
 */
export enum PCCompareEnum {
  /** move > |value| */
  gt = 'gt',
  /** move < |value| */
  lt = 'lt',
  /** min(|value|, |value2|) < move < max(|value|, |value2|) */
  bw = 'bw',
}

export type PriceChangeConditionSettings = {
  /** Threshold in %; its sign picks the move: > 0 = up (open→high), otherwise down (open→low). Missing = '5'. */
  value?: string | number | null
  /** Second bound for `bw`, same sign as `value`. */
  value2?: string | number | null
  /** Missing / null / unknown = `gt`. */
  compare?: PCCompareEnum | string | null
}

/** `+v`, with `undefined` / `null` → the legacy default '5'. */
const pcNumber = (v: string | number | null | undefined, fallback?: string) =>
  v === undefined || v === null
    ? fallback === undefined
      ? NaN
      : +fallback
    : +v

/**
 * The Price Change bot condition on the latest candle — shared by main-app
 * and the backtester.
 *
 * Direction is the sign of `value` (> 0 = up move, otherwise the down move —
 * exactly the pre-1.13.0 rule, so `'0'` / `''` read as down). Comparisons are
 * strict:
 * - `gt` (also missing / null / unknown): move > |value|
 * - `lt`: move < |value|
 * - `bw`: lo < move < hi with lo / hi = min / max of |value|, |value2|; both
 *   values must be non-zero with the same sign, else false.
 *
 * Results from before 1.13.0 (or after a JSON hop that turned NaN into null)
 * carry no `upPct` / `downPct`: `gt` then returns the stored boolean (the room
 * computed it with the same |value|), `lt` / `bw` return false.
 */
export const priceChangeCondition = (
  last: PCResult | null | undefined,
  settings: PriceChangeConditionSettings = {},
): boolean => {
  if (!last) {
    return false
  }
  const v1 = pcNumber(settings.value, '5')
  const up = v1 > 0
  const pct = up ? last.upPct : last.downPct
  const hasPct = typeof pct === 'number' && !Number.isNaN(pct)
  const compare = settings.compare
  if (compare === PCCompareEnum.lt) {
    return hasPct && pct < Math.abs(v1)
  }
  if (compare === PCCompareEnum.bw) {
    const v2 = pcNumber(settings.value2)
    const sameSign = (v1 > 0 && v2 > 0) || (v1 < 0 && v2 < 0)
    if (!hasPct || !sameSign) {
      return false
    }
    const lo = Math.min(Math.abs(v1), Math.abs(v2))
    const hi = Math.max(Math.abs(v1), Math.abs(v2))
    return pct > lo && pct < hi
  }
  if (!hasPct) {
    return !!(up ? last.up : last.down)
  }
  return pct > Math.abs(v1)
}
