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
// Open-High-Low-Close interface for candle data with timestamp
export interface OHLCT extends OHLC {
  timestamp: number
}
