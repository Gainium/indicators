import { DEMA } from '../DEMA/DEMA'
import { EMA } from '../EMA/EMA'
import { CandleSourceEnum } from '../Candle/Candle'
import { SessionRuleEnum } from '../Session/Session'
import { VWAPAnchorEnum } from '../VWAP/VWAP'

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
  ote = 'OTE',
  kdj = 'KDJ',
  vwap = 'VWAP',
  candle = 'CANDLE',
  ob = 'OB',
  sqz = 'SQZ',
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
  mcginley = 'mcginley',
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

/**
 * Mix-in for the single-line oscillators whose main line can be smoothed
 * (see `SMOOTHABLE_INDICATORS`). Ignored on every other indicator type.
 */
export type Smoothing = {
  /** 'sma' | 'ema' | 'wma' | 'dema' | 'tema' | 'hma' | 'rma' (any case); anything else = off */
  smoothing?: string | null
  /** 1..1000; missing, null, 0 or out of range = off */
  smoothingLength?: number | null
}

/**
 * Mix-in for indicators that gate signals on a trend filter (MAR, and the
 * Moving Average since 1.11.0): the line now against itself
 * `trendFilterLookback` bars ago, by `trendFilterValue` percent.
 */
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
  | {
      // KDJ(9, 3, 3) by default
      type: IndicatorEnum.kdj
      kdjLength?: number
      kdjKSmooth?: number
      kdjDSmooth?: number
    }
  | {
      // Anchored VWAP. The band multiplier only shapes the result's
      // upper / lower; `vwapCondition` takes its own, so a bot's rooms
      // need only the anchor.
      type: IndicatorEnum.vwap
      vwapAnchor?: VWAPAnchorEnum | string
      vwapBandMultiplier?: number
    }
  | { type: IndicatorEnum.ote; oteLeftBars: number; oteMinLegSize: number }
  | {
      // Candle colour: regular candle or Heikin Ashi (default)
      type: IndicatorEnum.candle
      source?: CandleSourceEnum | string
    }
  | {
      // Order Blocks: pivot bars on each side of a swing (default 5)
      type: IndicatorEnum.ob
      swingLength?: number
    }
  | {
      // Squeeze Momentum (LazyBear): BB 20 × 2, KC 20 × 1.5 by default
      type: IndicatorEnum.sqz
      length?: number
      bbMult?: number
      kcLength?: number
      kcMult?: number
    }
  | {
      // Only the Price levels rule has an indicator instance; the in / out
      // rules are pure clock filters (`isInSession`) with no factory entry.
      type: IndicatorEnum.session
      sessionRule: SessionRuleEnum.levels | 'levels'
      sessionDays: number[]
      sessionStart?: string
      sessionEnd?: string
      sessionTimezone?: string
    }
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
      TrendFilter &
      Smoothing)
  | ({
      type: IndicatorEnum.mom
      interval: number
      source: string
    } & Percentile &
      Smoothing)
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
      /**
       * ADX only: DMI mode — the result also carries +DI / −DI (`pdi` /
       * `mdi`, see `dmiCondition`). Missing / false = the plain ADX result.
       */
      dmi?: boolean
    } & Percentile &
      Smoothing)
  | ({
      type: IndicatorEnum.bbw | IndicatorEnum.bb | IndicatorEnum.bbpb
      interval: number
      bbwMult?: number
      bbwMa?: MAEnum
      bbwMaLength?: number
    } & Percentile &
      Smoothing)
  | ({
      type: IndicatorEnum.kc | IndicatorEnum.kcpb
      interval: number
      multiplier?: number
      ma?: MAEnum
      range?: RangeType
      rangeLength?: number
    } & Percentile &
      Smoothing)
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
    } & Percentile &
      Smoothing)
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
    } & Percentile &
      Smoothing)
  | {
      type: IndicatorEnum.ic
      conversionPeriods: number
      basePeriods: number
      laggingSpan2Periods: number
      laggingSpan: number
    }
  | ({
      // With `trendFilter` on, `createIndicator` returns `MATrendFilter`
      // (result `{ value, trend }`); without it, the plain MA (a number).
      type: IndicatorEnum.ma
      maType: MAEnum
      interval: number
    } & TrendFilter)
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
  | ({
      type: IndicatorEnum.vo
      voShort: number
      voLong: number
    } & Percentile &
      Smoothing)
  | { type: IndicatorEnum.ecd }
