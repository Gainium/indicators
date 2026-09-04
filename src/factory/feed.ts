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
 *                              ATR, PriorPivot, ADR, ATH
 *   - `{open, high, low, close}` → BullBear, MOM, ECD, DonchianChannels,
 *                                  OBFVG, LongWick
 *   - `{open, high, low, close, volume}` → VWMA, TVTA, MFI, BBW, BB, KC,
 *                                          KCPB, BBWP, BBPB, MAR, DIV, PC
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
import { DEMA } from '../DEMA/DEMA'
import { DIV } from '../DIV/DIV'
import { DonchianChannels } from '../DC/DonchianChannels'
import { ECD } from '../ECD/ECD'
import { EMA } from '../EMA/EMA'
import { HMA } from '../HMA/HMA'
import { IchimokuCloud } from '../Ichimoku/IC'
import { KeltnerChannel } from '../KC/KC'
import { KeltnerChannelPB } from '../KCPB/KCPB'
import { LongWick } from '../LongWick/LongWick'
import { MACD } from '../MACD/MACD'
import { MAR } from '../MAR/MAR'
import { McGinley } from '../McGinley/McGinley'
import { MFI } from '../MFI/MFI'
import { MOM } from '../MOM/MOM'
import { OBFVG } from '../OBFVG/OBFVG'
import { PC } from '../PC/PC'
import { PSAR } from '../PSAR/PSAR'
import { PriorPivot } from '../PriorPivot/PP'
import { QFL } from '../QFL/QFL'
import { RMA } from '../RMA/RMA'
import { RSI } from '../RSI/RSI'
import { SMA } from '../SMA/SMA'
import { StochasticOscillator } from '../STOCH/StochasticOscillator'
import { StochasticRSI } from '../STOCH/StochasticRSI'
import { SuperTrend } from '../SuperTrend/SuperTrend'
import { SupportResistance } from '../SupportResistance/SupportResistance'
import { TEMA } from '../TEMA/TEMA'
import { TVTA } from '../TVTA/TVTA'
import { UltimateOscillator } from '../UO/UO'
import { VO } from '../VO/VO'
import { VWMA } from '../VWMA/VWMA'
import { WMA } from '../WMA/WMA'
import { WilliamsR } from '../WR/WR'

/** OHLCV candle — the superset of every indicator input shape we support. */
export interface FeedCandle {
  o: number
  h: number
  l: number
  c: number
  v: number
}

/**
 * Dispatches `candle` into `indicator` using the shape the indicator expects.
 * No-op + returns undefined when the instance is null or the shape is
 * unknown; the caller should then check `indicator.result` separately.
 */

export function feedCandle(indicator: any, candle: FeedCandle): void {
  if (!indicator) return

  // Volume-only
  if (indicator instanceof VO) {
    indicator.next(candle.v)
    return
  }

  // Close-only (numeric)
  if (
    indicator instanceof RSI ||
    indicator instanceof MACD ||
    indicator instanceof EMA ||
    indicator instanceof DEMA ||
    indicator instanceof TEMA ||
    indicator instanceof RMA ||
    indicator instanceof SMA ||
    indicator instanceof WMA ||
    indicator instanceof HMA ||
    indicator instanceof McGinley
  ) {
    indicator.next(candle.c)
    return
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
    indicator instanceof ATH
  ) {
    indicator.next({ high: candle.h, low: candle.l, close: candle.c })
    return
  }

  // OHLC
  if (
    indicator instanceof BullBear ||
    indicator instanceof MOM ||
    indicator instanceof ECD ||
    indicator instanceof DonchianChannels ||
    indicator instanceof OBFVG ||
    indicator instanceof LongWick
  ) {
    indicator.next({
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
    })
    return
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
    indicator instanceof PC
  ) {
    indicator.next({
      open: candle.o,
      high: candle.h,
      low: candle.l,
      close: candle.c,
      volume: candle.v,
    })
    return
  }

  // HL
  if (indicator instanceof AO) {
    indicator.next({ high: candle.h, low: candle.l })
    return
  }

  // Unknown shape — do nothing. Caller will see `indicator.result` stay null.
}
