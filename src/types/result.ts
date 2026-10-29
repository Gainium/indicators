export interface PercentileResult {
  percentile?: number
  value: number
  trend?: number
}

/**
 * Result of `ADX` in DMI mode (`withDI`, config `dmi: true`). `value` (and
 * `percentile` in percentile mode) is the ADX line, the same number as
 * without DMI mode; `pdi` / `mdi` are the +DI / −DI lines the ADX is derived
 * from, on the same bar and with the same length (Wilder smoothing, as
 * TradingView's DMI). Both are 0 on a bar whose smoothed true range is 0.
 * Without DMI mode `ADX` returns a plain `PercentileResult`, unchanged.
 */
export interface ADXResult extends PercentileResult {
  pdi: number
  mdi: number
}

export interface BandsResult {
  lower: number
  middle: number
  upper: number
}

export interface MACDResult {
  histogram: number
  macd: number
  signal: number
  rank?: number
}

export interface StochasticResult {
  stochD: number
  stochK: number
}

export type DCResult = {
  high: number
  low: number
  basis: number
  price: number
}

export type DIVResult = {
  posdivergencehidden: number
  negdivergencehidden: number
  posdivergence: number
  negdivergence: number
}

export interface IchimokuCloudResult {
  conversionLine: number
  baseLine: number
  price: number
  leadLine1: number
  leadLine2: number
}

export interface ExtremumResult {
  highest: number
  lowest: number
}

export type PCResult = {
  up: boolean
  down: boolean
}

export type QFLResult = {
  action: boolean
  base: number
}

export type SuperTrendResult = {
  value: number
  direction: number
  all: {
    up: number
    down: number
  }
}

export type PivotResult = {
  high: number
  low: number
  price: number
}

export type LinesResult = {
  hh: number
  hl: number
  ll: number
  lh: number
  sl: number
  wl: number
  sh: number
  wh: number
}

export type PriorPivotResult = LinesResult & {
  all: LinesResult
  price: number
  sBullBoS: boolean
  sBearBoS: boolean
  sBullCHoCH: boolean
  sBearCHoCH: boolean
  iBullBoS: boolean
  iBullCHoCH: boolean
  iBearBoS: boolean
  iBearCHoCH: boolean
  market: 'bull' | 'bear' | null
}

export type LongWickResult = {
  bull: number
  bear: number
  price: number
}

/**
 * The latest valid leg of `OTELevels`. `direction` is 1 for a bullish leg
 * (swing low up to swing high), -1 for a bearish one; all three are NaN
 * until a leg exists.
 */
export type OTEResult = {
  high: number
  low: number
  direction: number
  price: number
}

/**
 * Session levels of `SessionLevels` after the latest candle. Every field is a
 * number, NaN where there is no value: the `prev*` levels until a session has
 * been seen from its first candle to its end, `curOpen`, `curMid` and
 * `sessionKey` outside a session. `curMid` is the midpoint of the highest
 * high and lowest low of the session in progress so far, latest candle
 * included. `inSession` is 1 when the latest candle opened inside
 * the session window, 0 otherwise. Session keys are `yyyymmdd` of the local
 * day the session opened (see `sessionKey`).
 */
export type SessionLevelsResult = {
  prevOpen: number
  prevHigh: number
  prevMid: number
  prevLow: number
  prevClose: number
  curOpen: number
  curMid: number
  price: number
  inSession: number
  sessionKey: number
  prevSessionKey: number
}

export type OBFVGResult = {
  bullishFVGHigh: number
  bullishFVGLow: number
  bullishFVGMiddle: number
  bearishFVGHigh: number
  bearishFVGLow: number
  bearishFVGMiddle: number
  price: number
}

/**
 * KDJ lines of `KDJ`: K and D (0..100) and J = 3K − 2D (may leave 0..100).
 */
export type KDJResult = {
  k: number
  d: number
  j: number
}

/**
 * Anchored VWAP of `VWAP` after the latest candle. `vwap` is the
 * volume-weighted average of hlc3 since the anchor (`periodStart`, ms, UTC),
 * `stdev` the volume-weighted standard deviation of hlc3 around it, and
 * `upper` / `lower` = vwap ± bandMultiplier × stdev with the instance's
 * multiplier. `vwap`, `stdev`, `upper` and `lower` are NaN while the period
 * has no volume yet. `price` is the latest close.
 */
export type VWAPResult = {
  vwap: number
  stdev: number
  upper: number
  lower: number
  price: number
  periodStart: number
}

/**
 * A Moving Average with the trend filter on (`MATrendFilter`). `value` is the
 * moving average, bit-identical to the plain MA of the same type and length.
 * `trend` is the MAR-style trend code of the MA against its value `lookback`
 * bars ago: 1 (falling, filter `lower`), 2 (rising, `higher`), 3 (flat,
 * `between`) when the move meets the filter, 0 when it does not, undefined
 * until `lookback` bars of MA values exist.
 */
export type MATrendResult = {
  value: number
  trend?: number
}

/**
 * Candle colour of `Candle` after the latest candle. `color` is 1 (green,
 * close > open), −1 (red, close < open) or 0 (doji); `streak` the signed
 * length of the current run (+3 = three green in a row, 0 on a doji, capped
 * at ±1000). open / high / low / close are the candle the colour is read
 * from — the Heikin Ashi values for the heikinAshi source.
 */
export type CandleResult = {
  color: number
  streak: number
  open: number
  high: number
  low: number
  close: number
}

/**
 * Latest unmitigated order block per side of `OrderBlocks`. Zone fields are
 * NaN when a side has no active block; `*Id` is the open time (or bar index
 * without a time) of the candle that broke structure and formed the block —
 * a different id is a different block. `price` is the latest close.
 */
export type OrderBlockResult = {
  bullishTop: number
  bullishBottom: number
  bullishId: number
  bearishTop: number
  bearishBottom: number
  bearishId: number
  price: number
}

/**
 * Squeeze Momentum of `Squeeze`: `momentum` is the linreg end point of the
 * momentum source, `squeeze` 1 (BB inside KC: on), −1 (BB outside KC: off)
 * or 0 (neither).
 */
export type SqueezeResult = {
  momentum: number
  squeeze: number
}
