# Changelog

All notable changes to the Gainium Technical Indicators library will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-09-04

### Added

- **McGinley Dynamic** (`IndicatorEnum.mg = 'MG'`) — a self-adjusting moving
  average that speeds up in fast markets and slows down in flat ones.
  `src/McGinley/McGinley.ts`, registered in the factory
  (`create`/`warmup`/`feed`).

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
