import { DEMA } from '../DEMA/DEMA'
import { EMA } from '../EMA/EMA'

// ─── Existing: MACDConfig (kept for backwards compatibility with earlier
//     consumers that imported it directly) ─────────────────────────────────

export type MACDConfig = {
  indicator: typeof EMA | typeof DEMA
  longInterval: number
  shortInterval: number
  signalInterval: number
}

// ─── Unified IndicatorConfig — consumed by createIndicator() ────────────────
//
// The indicator service in the main app carries a 400-line switch that maps
// a config object to a constructed indicator instance and the minimum
// candles needed to warm it up. The same mapping is needed by the
// market-archive (historical on-demand compute) and by any future consumer
// that wants to pin-point-evaluate an indicator. Rather than duplicate the
// switch in each service, it lives here — the indicators package owns the
// full configuration contract.

/** Stable string id per indicator type, used as `config.type`. */
export enum IndicatorEnum {
  rsi = 'RSI',
  adx = 'ADX',
  bbw = 'BBW',
  bb = 'BB',
  macd = 'MACD',
  stoch = 'Stoch',
  cci = 'CCI',
  ao = 'AO',
  stochRSI = 'StochRSI',
  wr = 'WR',
  bullBear = 'BullBear',
  uo = 'UO',
  ic = 'IC',
  tv = 'TV',
  ma = 'MA',
  sr = 'SR',
  qfl = 'QFL',
  mfi = 'MFI',
  psar = 'PSAR',
  vo = 'VO',
  mom = 'MOM',
  bbwp = 'BBWP',
  ecd = 'ECD',
  xo = 'XO',
  mar = 'MAR',
  bbpb = 'BBPB',
  div = 'DIV',
  st = 'ST',
  pc = 'PC',
  atr = 'ATR',
  pp = 'PP',
  adr = 'ADR',
  ath = 'ATH',
  kc = 'KC',
  kcpb = 'KCPB',
  unpnl = 'UNPNL',
  dc = 'DC',
  obfvg = 'OBFVG',
  session = 'SESSION',
  lw = 'LW',
  mg = 'MG',
}

/** Moving-average variants. Consumed by `ma` / `bb` / `bbw` / `mar` / `kc`. */
export enum MAEnum {
  ema = 'ema',
  sma = 'sma',
  wma = 'wma',
  price = 'price',
  dema = 'dema',
  tema = 'tema',
  vwma = 'vwma',
  hma = 'hma',
  rma = 'rma',
}

/** Range calculation for Keltner Channels. */
export enum RangeType {
  atr = 'ATR',
  tr = 'TR',
  r = 'R',
}

/** Percentile operators used by TrendFilter. */
export enum TrendFilterOperatorEnum {
  lower = 'lower',
  higher = 'higher',
  between = 'between',
}

/** Mix-in for indicators that expose percentile ranking of their output. */
export type Percentile = {
  percentile?: boolean
  percentileLookback?: number
  percentilePercentage?: number
}

/** Mix-in for indicators that gate signals on a trend filter. */
export type TrendFilter = {
  trendFilter?: boolean
  trendFilterLookback?: number
  trendFilterType?: TrendFilterOperatorEnum
  trendFilterValue?: number
}

/** Oscillators that DIV can analyse for divergence. */
export type DivergenceOscillators =
  | IndicatorEnum.adx
  | IndicatorEnum.cci
  | IndicatorEnum.mfi
  | IndicatorEnum.rsi
  | IndicatorEnum.wr
  | IndicatorEnum.macd
  | IndicatorEnum.uo
  | IndicatorEnum.ao
  | IndicatorEnum.mom
  | IndicatorEnum.bbw
  | IndicatorEnum.vo
  | IndicatorEnum.bbpb
  | IndicatorEnum.stoch

// ─── IndicatorConfig — discriminated union over `type` ──────────────────────

export type IndicatorConfig =
  | { type: IndicatorEnum.lw; lwThreshold: number; lwMaxDuration: number }
  | { type: IndicatorEnum.mg; mgLength: number }
  | { type: IndicatorEnum.obfvg }
  | { type: IndicatorEnum.dc; length: number }
  | {
      type: IndicatorEnum.pc
      pcUp: number
      pcDown: number
    }
  | {
      type: IndicatorEnum.ath
      lookback: number
    }
  | {
      type: IndicatorEnum.pp
      ppHighLeft: number
      ppHighRight: number
      ppLowLeft: number
      ppLowRight: number
      ppMult: number
    }
  | { type: IndicatorEnum.st; factor: number; atrLength: number }
  | {
      type: IndicatorEnum.div
      oscillators: DivergenceOscillators[]
      leftBars?: number
      rightBars?: number
      rangeLower?: number
      rangeUpper?: number
    }
  | {
      type: IndicatorEnum.tv
      checkLevel?: number
      useAsEntryExitPoints?: boolean
    }
  | ({
      type: IndicatorEnum.mar
      mar1type: MAEnum
      mar1length: number
      mar2type: MAEnum
      mar2length: number
    } & Percentile &
      TrendFilter)
  | ({
      type: IndicatorEnum.mom
      interval: number
      source: string
    } & Percentile)
  | {
      type: IndicatorEnum.bbwp
      interval: number
      lookback: number
      source: string
    }
  | ({
      type:
        | IndicatorEnum.rsi
        | IndicatorEnum.adx
        | IndicatorEnum.cci
        | IndicatorEnum.wr
        | IndicatorEnum.bullBear
        | IndicatorEnum.mfi
        | IndicatorEnum.atr
        | IndicatorEnum.adr
      interval: number
    } & Percentile)
  | ({
      type: IndicatorEnum.bbw | IndicatorEnum.bb | IndicatorEnum.bbpb
      interval: number
      bbwMult?: number
      bbwMa?: MAEnum
      bbwMaLength?: number
    } & Percentile)
  | ({
      type: IndicatorEnum.kc | IndicatorEnum.kcpb
      interval: number
      multiplier?: number
      ma?: MAEnum
      range?: RangeType
      rangeLength?: number
    } & Percentile)
  | ({
      type: IndicatorEnum.macd
      longInterval: number
      shortInterval: number
      signalInterval: number
      maSource?: MAEnum
      maSignal?: MAEnum
    } & Percentile)
  | {
      type: IndicatorEnum.stoch
      k: number
      ksmooth: number
      dsmooth: number
    }
  | ({
      type: IndicatorEnum.ao
    } & Percentile)
  | {
      type: IndicatorEnum.stochRSI
      interval: number
      k: number
      ksmooth: number
      dsmooth: number
    }
  | ({
      type: IndicatorEnum.uo
      fast: number
      middle: number
      slow: number
    } & Percentile)
  | {
      type: IndicatorEnum.ic
      conversionPeriods: number
      basePeriods: number
      laggingSpan2Periods: number
      laggingSpan: number
    }
  | {
      type: IndicatorEnum.ma
      maType: MAEnum
      interval: number
    }
  | {
      type: IndicatorEnum.sr
      leftBars: number
      rightBars: number
    }
  | {
      type: IndicatorEnum.qfl
      basePeriods: number
      pumpPeriods: number
      pump: number
      baseCrack: number
    }
  | {
      type: IndicatorEnum.psar
      start: number
      inc: number
      max: number
    }
  | ({ type: IndicatorEnum.vo; voShort: number; voLong: number } & Percentile)
  | { type: IndicatorEnum.ecd }
