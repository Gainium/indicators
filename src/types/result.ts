export interface PercentileResult {
  percentile?: number
  value: number
  trend?: number
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

export type OBFVGResult = {
  bullishFVGHigh: number
  bullishFVGLow: number
  bullishFVGMiddle: number
  bearishFVGHigh: number
  bearishFVGLow: number
  bearishFVGMiddle: number
  price: number
}

export type SessionsResult = {
  inSession: boolean
  sessionHigh: number
  sessionLow: number
  price: number
}
