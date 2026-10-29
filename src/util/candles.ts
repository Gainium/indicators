import { HL, HLC, OHLC, OHLCT, OHLCV, OHLCVT } from '../types/candles'

export const hlcValue: HLC = {
  high: 0,
  low: 0,
  close: 0,
}

export const hlValue: HL = {
  high: 0,
  low: 0,
}

export const ohlcValue: OHLC = {
  high: 0,
  low: 0,
  close: 0,
  open: 0,
}

export const ohlcvValue: OHLCV = {
  high: 0,
  low: 0,
  close: 0,
  open: 0,
  volume: 0,
}

export const ohlctValue: OHLCT = {
  high: 0,
  low: 0,
  close: 0,
  open: 0,
  time: NaN,
}

export const ohlcvtValue: OHLCVT = {
  high: 0,
  low: 0,
  close: 0,
  open: 0,
  volume: 0,
  time: NaN,
}
