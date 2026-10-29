/**
 * feedCandle — dispatches a candle into an indicator in the exact shape it
 * expects. Lifted from the instanceof-chain in the main app's indicator
 * service (`updateValue`). Sharing this here means the archive service
 * (historical on-demand eval) and the live indicator service stay bit-for-
 * bit consistent without re-implementing the same 10-clause switch.
 *
 * Input-shape taxonomy (matching the live service):
 *   - `number` (volume)     → VO
 *   - `number` (close)       → RSI, MACD, EMA, DEMA, TEMA, RMA, SMA, WMA, HMA,
 *                              McGinley
 *   - `{high, low, close}`   → ADX, Stoch, CCI, StochRSI, WR, UO, IC,
 *                              SupportResistance, QFL, PSAR, SuperTrend,
 *                              ATR, PriorPivot, ADR, ATH, KDJ, Squeeze
 *   - `{open, high, low, close}` → BullBear, MOM, ECD, DonchianChannels,
 *                                  OBFVG, LongWick, OTELevels, Candle
 *   - `{open, high, low, close, time}` → SessionLevels (`time` = `t`; a
 *                                        candle without `t` is not grouped
 *                                        into any session), OrderBlocks
 *                                        (`time` = block id; without `t`
 *                                        the bar index is the id)
 *   - `{open, high, low, close, volume}` → VWMA, TVTA, MFI, BBW, BB, KC,
 *                                          KCPB, BBWP, BBPB, MAR, DIV, PC,
 *                                          MATrendFilter (MA + trend filter)
 *   - `{open, high, low, close, volume, time}` → VWAP (`time` = `t`; a
 *                                                candle without `t` is not
 *                                                accumulated)
 *   - `{high, low}`          → AO
 *
 * Anything else gets a permissive OHLCV cast — safe for indicators whose
 * input type is a superset of OHLCV (most of them).
 */

import { ADR } from '../ADR/ADR'
import { ADX } from '../ADX/ADX'
import { AO } from '../AO/AO'
import { ATH } from '../ATH/ATH'
import { ATR } from '../ATR/ATR'
import { BBPB } from '../BBPB/BBPB'
import { BBWP } from '../BBWP/BBWP'
import { BollingerBands } from '../BBANDS/BollingerBands'
import { BollingerBandsWidth } from '../BBW/BollingerBandsWidth'
import { BullBear } from '../BullBear/BullBear'
import { CCI } from '../CCI/CCI'
import { Candle } from '../Candle/Candle'
import { DEMA } from '../DEMA/DEMA'
import { DIV } from '../DIV/DIV'
import { DonchianChannels } from '../DC/DonchianChannels'
import { ECD } from '../ECD/ECD'
import { EMA } from '../EMA/EMA'
import { HMA } from '../HMA/HMA'
import { IchimokuCloud } from '../Ichimoku/IC'
import { KeltnerChannel } from '../KC/KC'
import { KDJ } from '../KDJ/KDJ'
import { KeltnerChannelPB } from '../KCPB/KCPB'
import { LongWick } from '../LongWick/LongWick'
import { MACD } from '../MACD/MACD'
import { MAR } from '../MAR/MAR'
import { MATrendFilter } from '../MATrend/MATrend'
import { MFI } from '../MFI/MFI'
import { MOM } from '../MOM/MOM'
import { OBFVG } from '../OBFVG/OBFVG'
import { OTELevels } from '../OTE/OTE'
import { OrderBlocks } from '../OB/OrderBlocks'
import { PC } from '../PC/PC'
import { PSAR } from '../PSAR/PSAR'
import { PriorPivot } from '../PriorPivot/PP'
import { QFL } from '../QFL/QFL'
import { RMA } from '../RMA/RMA'
import { McGinley } from '../McGinley/McGinley'
import { RSI } from '../RSI/RSI'
import { SMA } from '../SMA/SMA'
import { SessionLevels } from '../Session/Session'
import { Squeeze } from '../SQZ/Squeeze'
import { StochasticOscillator } from '../STOCH/StochasticOscillator'
import { StochasticRSI } from '../STOCH/StochasticRSI'
import { SuperTrend } from '../SuperTrend/SuperTrend'
import { SupportResistance } from '../SupportResistance/SupportResistance'
import { TEMA } from '../TEMA/TEMA'
import { TVTA } from '../TVTA/TVTA'
import { UltimateOscillator } from '../UO/UO'
import { VO } from '../VO/VO'
import { VWAP } from '../VWAP/VWAP'
import { VWMA } from '../VWMA/VWMA'
import { WMA } from '../WMA/WMA'
import { WilliamsR } from '../WR/WR'
import { unwrapSmoothed } from '../Smoothing/Smoothing'

/** OHLCV candle — the superset of every indicator input shape we support. */
export interface FeedCandle {
  o: number
  h: number
  l: number
  c: number
  v: number
  /**
   * Candle OPEN time, ms since epoch. `SessionLevels` reads it to group
   * candles into sessions (without it the candle updates the latest price
   * but belongs to no session) and `VWAP` to find the anchor period (without
   * it the candle is not accumulated). Callers that have the time must pass
   * it.
   */
  t?: number
}

/**
 * Dispatches `candle` into `indicator` using the shape the indicator expects.
 * No-op + returns undefined when the instance is null or the shape is
 * unknown; the caller should then check `indicator.result` separately.
 */

export function feedCandle(indicator: any, candle: FeedCandle): void {
  if (!indicator) return
  // A smoothed oscillator takes the input of the oscillator it wraps.
  const input = candleInput(unwrapSmoothed(indicator), candle)
  if (input !== undefined) {
    indicator.next(input)
  }
}

/** The input `indicator` expects for `candle`, or undefined if unknown. */
function candleInput(indicator: any, candle: FeedCandle): unknown {
  // Volume-only
  if (indicator instanceof VO) {
    return candle.v
  }

  // Close-only (numeric)
  if (
    indicator instanceof RSI ||
    indicator instanceof MACD ||
    indicator instanceof EMA ||
    indicator instanceof DEMA ||
    indicator instanceof TEMA ||
    indicator instanceof RMA ||
    indicator instanceof McGinley ||
    indicator instanceof SMA ||
    indicator instanceof WMA ||
    indicator instanceof HMA
  ) {
    return candle.c
  }

  // HLC
  if (
    indicator instanceof ADX ||
    indicator instanceof StochasticOscillator ||
    indicator instanceof CCI ||
    indicator instanceof StochasticRSI ||
    indicator instanceof WilliamsR ||
    indicator instanceof UltimateOscillator ||
    indicator instanceof IchimokuCloud ||
    indicator instanceof SupportResistance ||
    indicator instanceof QFL ||
    indicator instanceof PSAR ||
    indicator instanceof SuperTrend ||
    indicator instanceof ATR ||
    indicator instanceof PriorPivot ||
    indicator instanceof ADR ||
    indicator instanceof ATH ||
    indicator instanceof KDJ ||
    indicator instanceof Squeeze
  ) {
    return { high: candle.h, low: candle.l, close: candle.c }
  }

  // OHLC
  if (
    indicator instanceof BullBear ||
    indicator instanceof MOM ||
    indicator instanceof ECD ||
    indicator instanceof DonchianChannels ||
    indicator instanceof OBFVG ||
    indicator instanceof LongWick ||
    indicator instanceof OTELevels ||
    indicator instanceof Candle
  ) {
    return {
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
    }
  }

  // OHLC + open time
  if (indicator instanceof SessionLevels || indicator instanceof OrderBlocks) {
    return {
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
      time: candle.t ?? NaN,
    }
  }

  // OHLCV
  if (
    indicator instanceof VWMA ||
    indicator instanceof TVTA ||
    indicator instanceof MFI ||
    indicator instanceof BollingerBandsWidth ||
    indicator instanceof BollingerBands ||
    indicator instanceof KeltnerChannel ||
    indicator instanceof KeltnerChannelPB ||
    indicator instanceof BBWP ||
    indicator instanceof BBPB ||
    indicator instanceof MAR ||
    indicator instanceof DIV ||
    indicator instanceof PC ||
    indicator instanceof MATrendFilter
  ) {
    return {
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
      volume: candle.v,
    }
  }

  // OHLCV + open time
  if (indicator instanceof VWAP) {
    return {
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
      volume: candle.v,
      time: candle.t ?? NaN,
    }
  }

  // HL
  if (indicator instanceof AO) {
    return { high: candle.h, low: candle.l }
  }

  // Unknown shape — do nothing. Caller will see `indicator.result` stay null.
  return undefined
}
