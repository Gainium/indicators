# Changelog

All notable changes to the Gainium Technical Indicators library will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.14.0] - 2026-10-29

### Changed

- **Session Price levels: crossing on the first candle after the session.**
  With `active` `outside` or `always`, `sessionLevelsCondition` now also
  decides a `cu` / `cd` crossing on the first candle after a session ends
  (`prev` inside the session that `last` reports as `prevSessionKey`), when
  one operand is `price` and the other a `prev*` level: both closes are
  compared with the level the newest candle sees. Before, no crossing could
  fire on that candle, so a Monday range broken on the first hour of Tuesday
  was missed. The level jump cannot fake a crossing: the session's last close
  is within the session's high / low (and equals `prevClose`). Every other
  pairing, and `active` `session` / missing (the default), decide exactly as
  in 1.13.0.
- **Squeeze Momentum: default BB multiplier 1.5 (was 2).**
  `resolveSqueezeSettings`, the `Squeeze` constructor and the factory now
  default `bbMult` to 1.5, which matches the Squeeze Momentum chart
  TradingView displays. A config that passes `bbMult` is unchanged.

## [1.13.0] - 2026-10-29

### Added

- **Price Change range.** `PCResult` gains `upPct` = (high − open) / open · 100
  and `downPct` = (open − low) / open · 100 (both ≥ 0) next to the unchanged
  `up` / `down` booleans; the room config (`pcUp` / `pcDown`) is unchanged.
  New `PCCompareEnum` (`gt` | `lt` | `bw`) and the shared bot decision
  `priceChangeCondition(last, { value, value2, compare })`: the sign of
  `value` picks the move (> 0 = up, otherwise down, as before); `gt` = move >
  |value|, `lt` = move < |value|, `bw` = lo < move < hi with lo / hi the
  min / max of |value| and |value2| (both non-zero, same sign; strict at both
  bounds). A missing, null or unknown `compare` is `gt` and decides exactly as
  before 1.13.0 on every candle. Results without the pct fields (older data)
  fall back to the stored boolean for `gt`; `lt` / `bw` are false there.

## [1.12.0] - 2026-10-29

### Added

- **Candle colour (`Candle`, `IndicatorEnum.candle = 'CANDLE'`).** The colour
  of the latest closed candle — regular or Heikin Ashi (TradingView's
  built-in formula: haClose = ohlc4, haOpen = average of the previous
  haOpen / haClose, seeded on the first candle as (open + close) / 2) — and
  a signed streak (+3 = three green in a row, −2 = two red, 0 on a doji;
  capped at ±1000). Green = close > open, red = close < open, equal = doji
  (compared exactly). Config `{ type: 'CANDLE', source? }` (`regular` |
  `heikinAshi`, default heikinAshi). Result `CandleResult { color, streak,
  open, high, low, close }` — the candle the colour is read from. Heikin Ashi
  is null for the first 29 candles (seed weight below 2^-30) and counts the
  streak from the 30th. Factory warm-up `CANDLE_WARMUP` = 81 (30 to settle +
  51 counted candles, so the streak is exact for every count up to 50).
  Shared decision `candleCondition(last, prev, { color, count, trigger })`:
  `streak` → streak ≥ N (green) / ≤ −N (red); `start` → exactly N, once per
  run; a doji never fires; missing / invalid count = 1.
- **Order Blocks (`OrderBlocks`, `IndicatorEnum.ob = 'OB'`).** LuxAlgo-style,
  non-repainting: swings are pivots with `swingLength` bars on both sides
  (confirmed that many bars later); a close above the latest unbroken swing
  high forms a bullish block = the lowest-low candle from the swing bar to
  the breaking candle (ties → latest), zone `[low, high]`, and uses the swing
  up; bearish is the mirror. A block is mitigated by a close beyond it (below
  a bullish bottom, above a bearish top); only the latest unmitigated block
  per side is kept, and the search reaches back at most 500 bars. Config
  `{ type: 'OB', swingLength? }` (default 5). Result `OrderBlockResult
  { bullishTop, bullishBottom, bullishId, bearishTop, bearishBottom,
  bearishId, price }` — NaN without an active block; the id is the breaking
  candle's open time (bar index without `t`). Input OHLC + time: `feedCandle`
  passes `t`. Explicit exportState / restoreState. Warm-up `OB_WARMUP` =
  1000. Shared decision `orderBlockCondition(last, prev, { side, level,
  condition })`: close vs top / middle / bottom of the bullish / bearish
  block; `cu` / `cd` only when both bars carry the same block id. Helper
  `orderBlockLevel`.
- **Squeeze Momentum (`Squeeze`, `IndicatorEnum.sqz = 'SQZ'`).** LazyBear's
  corrected v2 with true range on: BB = sma ± bbMult × population stdev, KC =
  sma ± kcMult × sma(true range) (first bar TR = high − low); squeeze 1 (BB
  inside KC), −1 (BB outside KC), 0 otherwise; momentum = linreg end point of
  close − avg(avg(highest, lowest), sma) over kcLength. Every window is
  summed directly (no rolling-sum drift); cross-checked against an
  array-based transcription of the Pine script. Config `{ type: 'SQZ',
  length?, bbMult?, kcLength?, kcMult? }` (default 20 / 2 / 20 / 1.5). Result
  `SqueezeResult { momentum, squeeze }`. Warm-up 2 × max(length, kcLength).
  Shared decision `squeezeCondition(last, prev, { signal, momentum })`:
  `fired` / `on` / `off` / `any` AND `positive` / `negative` / `rising` /
  `falling` / `crossUp` / `crossDown` / `any`; both `any` never fires.
  Helper `linregEnd`.
- **Session Price levels outside the session.** `sessionLevelsCondition`
  settings take `active` (`SessionLevelsActiveEnum`: `session` | `outside` |
  `always`). `outside` / `always` also evaluate candles outside the session,
  where the previous-session levels are those of the last completed session
  and the current-session levels are absent (false if read). A crossing needs
  both candles to see the same previous session and be in the same place —
  the same session, or both outside. Missing / unknown `active` is
  byte-identical to 1.11.0 (proved against the old function on a random
  walk). Enables the Monday range: days = Monday, Price levels, active
  outside, price crossing up the previous session high.

## [1.11.0] - 2026-10-29

### Added

- **Anchored VWAP (`VWAP`, `IndicatorEnum.vwap = 'VWAP'`).** TradingView's
  built-in VWAP: the volume-weighted average of hlc3, restarting at the anchor
  in UTC — `day` (default, 00:00), `week` (Monday 00:00, TradingView's crypto
  weekly) or `month` (the 1st). Standard-deviation bands as TradingView's
  "Standard Deviation" mode: `upper` / `lower` = vwap ± multiplier × stdev,
  stdev = √(Σv·hlc3²/Σv − vwap²) (accumulated with West's weighted update,
  which avoids the cancellation of squaring prices). Result `VWAPResult`
  `{ vwap, stdev, upper, lower, price, periodStart }`. Config
  `{ type: 'VWAP', vwapAnchor?, vwapBandMultiplier? }` (defaults day, 1).
  Needs the candle open time: new input shape `OHLCVT`, and `feedCandle`
  passes `t`. Decisions: the first period in the history is skipped (null)
  unless its first candle opens exactly on the period start; a candle without
  a time is not accumulated (the VWAP holds, `price` updates); non-positive
  volume counts as 0 and the lines are NaN while the period has no volume.
  Warm-up per anchor (`VWAP_WARMUP`) is one whole period plus a candle on the
  smallest interval the anchor is normally used with — day 1441 (1m), week
  2017 (5m), month 2977 (15m); the factory does not know the interval, so on
  smaller intervals VWAP stays null until the next period starts. Shared
  decision `vwapCondition(last, prev, { line, bandMultiplier, condition })`:
  the close against `vwap` / `upper` / `lower`, `gt` / `lt` / `cu` / `cd`;
  crossings count only within one anchor period (the restart is not a
  crossing). The decision computes the bands from `vwap` and `stdev` with
  its own multiplier, so the multiplier is a condition setting, not part of
  the indicator room. Helpers `vwapLineValue`, `vwapPeriodStart`,
  `resolveVWAPAnchor`.
- **KDJ (`KDJ`, `IndicatorEnum.kdj = 'KDJ'`).** The formula of TradingView's
  popular open-source "KDJ Indicator": RSV over `n` bars, K and D smoothed
  with bcwsma (`(RSV + (m − 1)·K[1]) / m`), J = 3K − 2D. Config
  `{ type: 'KDJ', kdjLength?, kdjKSmooth?, kdjDSmooth? }`, default 9 / 3 / 3
  (the script's one "signal" length is exposed as two). Result
  `KDJResult { k, d, j }`; J is not clamped. Decisions: K and D are seeded at
  50 (the script uses 0) and nothing is emitted until the seed's weight is
  below 1e-6 (`kdjSettleBars`; KDJ(9,3,3) warms up in 63 candles), so values
  match the script to 1e-6 whatever the seed; a flat range (highest = lowest)
  keeps the previous RSV (50 if none) instead of producing NaN. Shared
  decision `kdjCondition(last, prev, settings)` offers what Stochastic offers
  — a line (K / D / J) against another line or a fixed level, `cu` / `cd` /
  `gt` / `lt`, and the Lower / Upper / Lower&Upper / Anywhere zone filter,
  reading the stored `stochUpper` / `stochLower` keys exactly as the
  Stochastic condition does. Unlike Stochastic, a single-band zone does not
  also pass above 100 / below 0 (J goes there).
- **DMI mode on ADX (`dmi: true`).** `new ADX(interval, ..., withDI)` /
  config `dmi: true` adds +DI and −DI as `pdi` / `mdi` to the ADX result
  (`ADXResult`), same length, from the first bar the ADX has a value; they
  pass through oscillator smoothing unsmoothed. Without the flag the ADX
  result is byte-identical to 1.10.0. Shared decision
  `dmiCondition(last, prev, { condition })`: +DI crosses above / below −DI
  (`cu` / `cd`), +DI above / below −DI (`gt` / `lt`).
- **Trend filter on the Moving Average.** `IndicatorEnum.ma` accepts MAR's
  trend filter settings with the same names and meaning (`trendFilter`,
  `trendFilterLookback`, `trendFilterValue` in percent, `trendFilterType`
  lower / higher / between): the MA now against the MA `lookback` bars ago.
  With `trendFilter` on, `createIndicator` returns `MATrendFilter`, result
  `MATrendResult { value, trend }` — `value` is the plain MA bit for bit,
  `trend` MAR's code (1 falling / 2 rising / 3 flat when the move meets the
  threshold, 0 when not, undefined until the lookback is filled or when the
  filter settings are incomplete). Every MA type, McGinley and VWMA included.
  Warm-up adds the lookback. Without `trendFilter` the factory returns the
  plain MA and its warm-up as before. Shared gate
  `trendFilterCondition(last, { trendFilterType })` — the engine's MAR trend
  check, usable on MA and MAR results — and `trendFilterCode`, MAR's trend
  arithmetic as a function.
- **`lineCondition(condition, last, value, prev?, prevValue?)`**, the bot
  engine's generic comparison (`gt` / `lt`; `cu` / `cd` with touching on the
  previous bar), used by the new decisions so they fire where the engine's
  band and Stochastic comparisons fire; and `resultNumber` (JSON null → NaN).

## [1.10.0] - 2026-10-29

### Added

- **McGinley Dynamic moving average (`MAEnum.mcginley`).** A new MA type for
  the Moving Average indicator and the Moving Average Ratio legs: a line that
  moves toward price by `(price − MD[1]) / (n × (price / MD[1])^4)`, so it
  catches up faster when price runs away from it and falls faster than it
  rises. Seeded like TradingView's built-in, with the simple average of the
  first `n` inputs, and matches it from there. Gaps (a missing, zero or
  negative input) show as NaN and the line starts over, as EMA does.
  `McGinley` is exported, built by `createIndicator`, warmed up like the other
  MA types and fed by `feedCandle`. Not offered as smoothing or as a Bollinger
  basis.

## [1.9.1] - 2026-10-25

### Fixed

- **MAR with a VWMA leg gave no values when the type was lower case.** The
  VWMA legs were fed the candle only for `'VWMA'`; bot settings send `'vwma'`,
  so the leg got a bare number and the ratio never formed. The type is now
  matched in either case.
- **VWMA took twice its length to warm up.** The volume SMA was skipped while
  the volume-price SMA warmed up, so it started a window late. Both now update
  on every candle and VWMA gives its first value on its length-th candle, like
  SMA. Values after warm-up are unchanged.

## [1.9.0] - 2026-10-24

### Added

- **Current session midpoint (`SessionLevelEnum.curMid`).** A new Price
  levels value: (highest high + lowest low) / 2 of the session in progress
  so far, latest candle included, so it moves whenever the session prints a
  new high or low. NaN outside a session and on candles without a time, like
  `curOpen`. Reported as `SessionLevelsResult.curMid` and read by
  `sessionLevelValue`; `sessionLevelsCondition` crossings against it follow
  the usual rules (within one session they count, across a rollover they do
  not). A session already in progress when the data starts still reports its
  midpoint as seen so far. No new indicator state: the running high and low
  were already tracked, so exported states from 1.8.0 restore unchanged.

## [1.8.0] - 2026-10-24

### Added

- **Session price levels (`SessionLevels`, `SessionRuleEnum.levels`).** For
  the Session indicator's new Price levels rule: groups candles into
  sessions by their open time (same window as `isInSession` with rule `in`)
  and reports the open, high, low, close and midpoint of the last completed
  session, the open of the session in progress (NaN outside a session), the
  latest close, `inSession` (1 / 0) and the current and previous session
  keys. A session already in progress when the data starts is never used as
  the previous session. Input is `OHLCT` (OHLC + candle open time in ms).
  Registered in `createIndicator` (only for `sessionRule: 'levels'`; the
  in / out rules stay factory-less clock filters), `getWarmupCandles` (1500)
  and `feedCandle`.
- `FeedCandle.t` — optional candle open time (ms). `SessionLevels` reads it
  to group candles; a candle without it updates the price but belongs to no
  session.
- `sessionKey(timestamp, days, hours)` — `yyyymmdd` of the local day a
  session opened, or `null` outside the window. `isInSession` is now
  expressed on top of it, with unchanged results.
- `SessionLevelEnum` and `sessionLevelValue(result, level)` — the values a
  Price levels condition compares (`prevOpen`, `prevHigh`, `prevMid`,
  `prevLow`, `prevClose`, `curOpen`, `price`).
- `sessionLevelsCondition(last, prev, { a, b, condition })` — the
  bot-condition decision (`gt`, `lt`, `cu`, `cd`), shared by the live engine
  and the backtester. False outside the session, for a missing value or
  A = B; a crossing only counts when both bars are in the same session and
  see the same previous session.

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
- `oteCondition(last, prev, { level, leg, condition })` — the bot-condition
  decision (close vs a level of the latest leg: `gt`, `lt`, or a `cu` / `cd`
  crossing on the same leg; `leg` filters `bullish` / `bearish` / `any`),
  shared by the live engine and the backtester so both fire on the same bars.

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
