# Changelog

All notable changes to the Gainium Technical Indicators library will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-10-24

### Added

- **Discount / Premium OTE Levels (`OTELevels`, `IndicatorEnum.ote`).**
  Tracks the latest valid price leg between a swing low and a swing high
  (TradingView pivots: `oteLeftBars` to the left, one bar to the right) that
  is at least `oteMinLegSize` percent long, re-anchoring on the remaining
  swings when price trades through the leg's extreme. The result is the leg
  (`high`, `low`, `direction`: 1 bullish, -1 bearish, NaN without a leg)
  plus `price`. `oteLevelPrice(result, level)` gives the price of a
  retracement level (0 = the leg's end, 1 = its origin, 0.705 = the OTE
  sweet spot). Registered in `createIndicator`, `getWarmupCandles` (1000)
  and `feedCandle` (OHLC).

## [1.6.0] - 2026-10-23

### Added

- **Session hours.** `isInSession(timestamp, days, rule, hours?)` takes an
  optional `{ start, end, timezone }` window: local `HH:MM` times in an IANA
  time zone (default `UTC`), so a session keeps its local clock across
  daylight saving. `end` before `start` is an overnight session whose
  after-midnight part belongs to the day it opened, and the weekday is read
  in the session's zone. Without hours (or with invalid or equal times) the
  whole day counts, exactly as before. An unknown zone falls back to UTC.
- `parseSessionTime` and `zonedDayAndMinutes` helpers.

## [1.5.0] - 2026-10-12

### Added

- **Optional smoothing of single-line oscillators.** The configs of `RSI`,
  `CCI`, `MFI`, `WilliamsR` (`WR`), `UltimateOscillator` (`UO`), `MOM`,
  `AO`, `ADX`, `BBPB`, `KeltnerChannelPB` (`KCPB`), `BollingerBandsWidth`
  (`BBW`), `VO` and `MAR` accept `smoothing` (`'sma' | 'ema' | 'wma' |
  'dema' | 'tema' | 'hma' | 'rma'`, case-insensitive) and `smoothingLength`
  (1 to 1000). When both are set, `createIndicator` returns a
  `SmoothedIndicator`: the oscillator, built without percentile, feeds its
  `value` through that moving average (the library's own classes). The
  result's `value` is the smoothed line, the new `raw` field is the
  oscillator's own value on the same bar, percentile mode ranks the smoothed
  line, and a `trend` reported by the oscillator (MAR trend filter) is passed
  through. Nothing is emitted until the average has warmed up. A missing,
  `'none'`, `'vwma'`, `'price'` or unrecognised type, or a missing, zero or
  out-of-range length, leaves smoothing off. Other indicator types ignore
  the fields.
- `getWarmupCandles` adds the average's run-up for those types: one length
  for SMA/EMA/WMA/RMA, two for DEMA, three for TEMA,
  `length + ceil(length / 2) + ceil(sqrt(length))` for HMA.
- `feedCandle` feeds a `SmoothedIndicator` the input of the oscillator it
  wraps.
- New exports: `SmoothedIndicator`, `SmoothedResult`, `Smoothing`,
  `SmoothingType`, `SmoothingConfig`, `SMOOTHING_TYPES`,
  `SMOOTHING_MAX_LENGTH`, `SMOOTHABLE_INDICATORS`, `isSmoothableIndicator()`,
  `resolveSmoothing()`, `getSmoothingWarmup()`, `createSmoother()` and
  `unwrapSmoothed()`.

### Unchanged

- With smoothing off, `createIndicator` returns the same oscillator as
  before; output series, exported state and warm-up are identical (pinned by
  golden results recorded from 1.4.0 for every type above). The oscillator
  classes themselves are not modified.

## [1.4.0] - 2026-09-19

### Fixed

- `EMA` and `RMA` seeded their first value from one input too few. Both
  are seeded with the simple average of their first `interval` inputs,
  but the running total that average was built from was only updated
  while the history buffer was *not yet* full — and the input that fills
  the buffer is the `interval`-th one. So the total held `interval - 1`
  inputs and was still divided by `interval`, starting the average low
  by a factor of `(interval - 1) / interval` for a positive series. The
  seed is now the average of the filled buffer, which includes that last
  input. `EMA(3)` of a constant series of 10s is now `10` from its first
  value; it used to start at `6.67`.
- `EMA(1)` and `RMA(1)` returned `NaN` for every input, because the
  buffer fills on the very first one and the running total was never
  initialised. They now return the input, which is what `alpha = 1`
  means.
- A missing value (`NaN`) inside the first window no longer poisons the
  average permanently. The first value now simply arrives once
  `interval` clean inputs are in a row. A `NaN` after the first value is
  still `NaN` for that bar, and the average then restarts the same way
  instead of silently continuing from its stale previous value.

### Changed

- **Indicator values in the first bars after a start change, and so do
  backtest results over short windows.** Those were the wrong ones. The
  error was largest at the first value (`1 / interval` in relative
  terms — about 11 % at `interval = 9`, 0.5 % at 200) and decayed over
  roughly the average's own time constant, so how much of it an
  indicator ever showed depended on how much history was loaded in front
  of it. Anything with a long warm-up had decayed to nothing before its
  first output; a start on a short history had not.
- Affected, because they are built on `EMA` or `RMA`: `ATR` and the
  ATR-based settings, `MACD`, `DEMA`, `TEMA`, `SuperTrend`, Bollinger
  and Keltner channels on an EMA basis, `MAR` on an EMA/RMA basis, the
  volume oscillator, the divergence indicator and the TradingView-style
  technical-analysis rating.
- **Not** affected, confirmed value-for-value against the previous
  release: `SMA`, `WMA`, `HMA`, `CCI`, and — despite being Wilder
  indicators — `RSI` and `ADX`, which smooth with `WSMA`. `WSMA` seeds
  itself from a real `SMA` instance and was always correct.

## [1.3.2] - 2026-09-03

### Added

- CI now runs a real `npm test` (mocha) on every PR. The `"test"` script
  was previously the default npm placeholder that always failed;
  `test/placeholder.spec.ts` is a stand-in until real coverage lands.

## [1.3.1] - 2026-06-11

### Fixed
- DIV indicator logic

## [1.2.1] - 2026-04-06

### Changed
- Long Wick logic

## [1.2.0] - 2026-04-03

### Added
- Long Wick
- Session

## [1.1.0] - 2025-10-09

### Added
- Order Blocks & Fair Value Gaps (FVG only)

## [1.0.10] - 2025-09-23

### Fixed
- QFL history

## [1.0.9] - 2025-09-05

### Fixed
- QFL highest high

## [1.0.8] - 2025-08-19

### Fixed
- Donchian Channels offset

## [1.0.7] - 2025-07-02

### Changed
- Updated all dependencies to their latest versions
- Updated package-lock.json with latest dependency versions

## [1.0.6] - 2025-06-30

### Changed
- Migrated package manager from Yarn to npm
- Removed yarn.lock in favor of package-lock.json

## [1.0.2] - 2025-06-02

### Fixed
- **RSI**: Fixed percentile calculation by properly passing `percentilePercentage` parameter to PercentileCalculator constructor
- RSI percentile calculations now use the correct percentage value instead of defaulting to 50th percentile

## [1.0.1] - 2025-05-30

### Fixed
- **PriorPivot**: Optimized `pivotHigh` and `pivotLow` methods to remove blocking `while` loops
- Replaced `while` loops with efficient `for` loops to prevent event blocking
- Improved performance and reliability of pivot point calculations

## [1.0.0] - 2025-05-29

### Added
- Initial open source release
- 45+ comprehensive technical indicators
- LightIndicator base class architecture
- Complete TypeScript support with detailed type definitions
- State management system for persistence
- Comprehensive JSDoc documentation for all indicators
- High-performance implementation with circular buffers
- Real-time streaming data support

### Indicators Included

#### Trend Following
- Simple Moving Average (SMA)
- Exponential Moving Average (EMA)
- Weighted Moving Average (WMA)
- Volume Weighted Moving Average (VWMA)
- Hull Moving Average (HMA)
- Triple Exponential Moving Average (TEMA)
- Double Exponential Moving Average (DEMA)
- Wilder's Smoothed Moving Average (WSMA)
- Running Moving Average (RMA)

#### Momentum & Oscillators
- Relative Strength Index (RSI)
- Stochastic Oscillator (STOCH)
- Stochastic RSI (StochasticRSI)
- Commodity Channel Index (CCI)
- Williams %R (WR)
- Ultimate Oscillator (UO)
- Awesome Oscillator (AO)
- Momentum (MOM)
- Money Flow Index (MFI)

#### Volatility
- Average True Range (ATR)
- True Range (TR)
- Bollinger Bands (BBANDS)
- Bollinger Bands Width (BBW)
- Bollinger Bands Width Percentile (BBWP)
- Bollinger Bands %B (BBPB)
- Keltner Channels (KC)
- Keltner Channels %B (KCPB)
- Donchian Channels (DC)

#### Trend & Signal
- Moving Average Convergence Divergence (MACD)
- Average Directional Index (ADX)
- SuperTrend
- Parabolic SAR (PSAR)
- Ichimoku Cloud
- Bull/Bear Power (BullBear)

#### Volume
- Volume Oscillator (VO)
- Rolling Sum (Sum)

#### Support/Resistance & Levels
- Support/Resistance (SupportResistance)
- Prior Pivot Points (PriorPivot)
- All Time High (ATH)
- Extremum detection

#### Composite & Utility
- TradingView Technical Analysis (TVTA)
- Quickfingersluc Base Finder (QFL)
- Median Absolute Deviation (MAD)
- Moving Average Ratio (MAR)
- Divergence Detection (DIV)
- Price Channel (PC)
- Elder Channel Divergence (ECD)
- Average Daily Range (ADR)

### Features
- Memory-efficient circular buffer implementation
- O(1) complexity for most operations
- Complete state serialization/deserialization
- TypeScript-first with comprehensive type safety
- Professional-grade documentation
- Battle-tested in production trading systems

### Performance
- Optimized for real-time trading applications
- Minimal memory footprint with circular buffers
- Efficient Float64Array usage for internal state
- Handles thousands of instruments simultaneously

### Documentation
- Comprehensive README with usage examples
- Detailed contributing guidelines
- Complete API documentation with JSDoc
- Trading interpretation for each indicator
- Performance characteristics and best practices
