import { average, lastIndexOfEnum } from '../util'
import { LightIndicator } from '../util/indicator'

enum McGinleyState {
  PREVIOUS_MG = 0,
  CURRENT_MG = 1,
}

/**
 * McGinley Dynamic
 * Type: Trend-Following/Smoothing Indicator
 *
 * A moving average by John R. McGinley (1990) that adjusts its own speed to
 * the market. Each step moves the line toward price by the gap divided by
 * `interval × (price / previous)^4`: when price runs away from the line the
 * divisor shrinks and the line catches up faster than an EMA, and when price
 * sits near it the line moves about like an EMA of the same length. The fourth
 * power makes it faster in falling markets than in rising ones, since a ratio
 * below 1 shrinks the divisor.
 *
 * Seeding matches TradingView's built-in McGinley Dynamic, which takes
 * `ta.ema(source, length)` on its first bar: that is the simple average of the
 * first `interval` inputs (see EMA), so the first value arrives on the
 * `interval`-th input.
 *
 * Formula:
 * - First MD = SMA(n)
 * - MD = MD[1] + (price − MD[1]) / (n × (price / MD[1])^4)
 *
 * Gaps follow EMA's convention: a missing input shows as NaN and the line
 * starts over from a fresh `interval`-input seed. The formula is defined for a
 * positive series (price) only, so a zero or negative input is a gap too,
 * rather than an Infinity that the recursion would carry for good.
 *
 * Candle Input Type: Numeric (typically Close price)
 *
 * @see https://www.investopedia.com/terms/m/mcginley-dynamic.asp
 */
export class McGinley extends LightIndicator {
  private readonly interval: number

  /**
   * @param interval Length n, as in TradingView (default 14 there).
   */
  constructor(interval: number) {
    super(interval, 0, lastIndexOfEnum(McGinleyState), NaN)
    this.interval = interval
  }

  protected calculate(): number | null {
    const s = this._state
    const h = this._history
    if (!h.isFilled) {
      return null
    }
    if (isNaN(s[McGinleyState.CURRENT_MG])) {
      for (const v of h.array) {
        if (!(v > 0)) {
          // A gap inside the window: wait for `interval` clean inputs in a row.
          return null
        }
      }
      const seed = average(h.array)
      s[McGinleyState.CURRENT_MG] = seed
      return seed
    }
    const prev = s[McGinleyState.CURRENT_MG]
    s[McGinleyState.PREVIOUS_MG] = prev
    const price = h.last
    if (!(price > 0)) {
      s[McGinleyState.CURRENT_MG] = NaN
      return NaN
    }
    s[McGinleyState.CURRENT_MG] =
      prev + (price - prev) / (this.interval * Math.pow(price / prev, 4))
    return s[McGinleyState.CURRENT_MG]
  }
}
