// High-Low interface for candle data
export interface HL {
  high: number
  low: number
}
// High-Low-Close interface for candle data
export interface HLC extends HL {
  close: number
}
// Open-High-Low-Close interface for candle data
export interface OHLC extends HLC {
  open: number
}
// Open-High-Low-Close interface for candle data with volume
export interface OHLCV extends OHLC {
  volume: number
}
// OHLC with the candle's OPEN time (ms since epoch)
export type OHLCT = OHLC & { time: number }
// OHLCV with the candle's OPEN time (ms since epoch)
export type OHLCVT = OHLCV & { time: number }
