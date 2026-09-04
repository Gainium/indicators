import { lastIndexOfEnum } from '../util'
import { LightIndicator } from '../util/indicator'

enum MGState {
  MG = 0,
}

/**
 * McGinley Dynamic
 * Type: Adaptive Moving Average
 *
 * A moving average that adjusts its own speed to market speed: it speeds up
 * in fast markets and slows down in flat ones, tracking price more closely
 * than a fixed-period EMA/SMA without as much whipsaw.
 *
 * Formula (matches TradingView's `ta.ema` seeding — direct source, not an
 * SMA warm-up):
 *   mg[0] = source
 *   mg[n] = mg[n-1] + (source - mg[n-1]) / (length * (source / mg[n-1]) ^ 4)
 *
 * Candle Input Type: Single Price Value (close)
 *
 * @see https://www.investopedia.com/articles/forex/09/mcginley-dynamic-indicator.asp
 */
export class McGinley extends LightIndicator<number, number> {
  constructor(private readonly length: number = 14) {
    super(1, 0, lastIndexOfEnum(MGState), NaN)
  }

  protected calculate(): number | null {
    const s = this._state
    const price = this._history.last

    if (isNaN(s[MGState.MG])) {
      s[MGState.MG] = price
      return s[MGState.MG]
    }

    const prevMg = s[MGState.MG]
    const ratio = price / prevMg
    s[MGState.MG] =
      prevMg + (price - prevMg) / (this.length * Math.pow(ratio, 4))
    return s[MGState.MG]
  }
}
