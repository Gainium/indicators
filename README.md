# 📊 Gainium Technical Indicators

<img src="https://app.gainium.io/gainium-icon-192x192.png" alt="Gainium Logo" width="100" />

A high-performance, TypeScript-based technical indicators library built for professional trading applications. This library provides 45+ comprehensive technical analysis indicators optimized for real-time trading systems with minimal memory footprint and maximum computational efficiency.

**Author:** Maksym Shamko (https://github.com/maksymshamko)  
**Organization:** Gainium (https://github.com/Gainium | https://gainium.io/)

## ✨ Features

- **🚀 High Performance**: Optimized with circular buffers and Float64Arrays for minimal memory usage
- **📐 45+ Indicators**: Comprehensive collection covering all major technical analysis categories
- **🔧 TypeScript First**: Complete type safety with detailed JSDoc documentation
- **💾 State Management**: Full serialization/deserialization support for persistence
- **🔄 Real-time Ready**: Designed for streaming data and real-time trading systems
- **🧩 Modular Architecture**: Clean separation with LightIndicator base class
- **📊 Production Tested**: Battle-tested in Gainium's professional trading platform

## 📦 Installation

```bash
# Install from npm
npm install @gainium/indicators
# or
yarn add @gainium/indicators
```

## 🔧 Quick Start

### Basic Usage

```typescript
import { RSI, SMA, MACD, BollingerBands } from '@gainium/indicators';

// Create indicators
const rsi = new RSI(14);
const sma = new SMA(20);
const macd = new MACD();
const bb = new BollingerBands(20, 2);

// Feed price data
const price = 100.50;
const candle = { open: 100, high: 101, low: 99.5, close: 100.50, volume: 1000 };

// Get results
const rsiValue = rsi.next(price);           // Returns RSI value or null if not ready
const smaValue = sma.next(price);           // Returns SMA value or null
const macdResult = macd.next(price);        // Returns {value, signal, histogram} or null
const bbResult = bb.next(candle);           // Returns {upper, middle, lower} or null

console.log('RSI:', rsiValue?.value);       // Access RSI value
console.log('SMA:', smaValue);              // Direct numeric value
console.log('MACD:', macdResult?.value);    // MACD line value
console.log('BB Upper:', bbResult?.upper);  // Bollinger Bands upper band
```

### Advanced Usage with State Management

```typescript
import { SuperTrend, StochasticOscillator } from '@gainium/indicators';

// Create indicators
const superTrend = new SuperTrend(10, 3.0);
const stoch = new StochasticOscillator(14, 3, 3);

// Process multiple candles
const candles = [
  { open: 100, high: 102, low: 99, close: 101, volume: 1000 },
  { open: 101, high: 103, low: 100, close: 102, volume: 1100 },
  // ... more candles
];

candles.forEach(candle => {
  const stResult = superTrend.next(candle);
  const stochResult = stoch.next(candle);
  
  if (stResult && stochResult) {
    console.log('SuperTrend:', stResult.trend ? 'Uptrend' : 'Downtrend');
    console.log('Stochastic %K:', stochResult.stochK);
    console.log('Stochastic %D:', stochResult.stochD);
  }
});

// Save and restore state for persistence
const state = superTrend.exportState();
// ... save state to database/file
const newSuperTrend = new SuperTrend(10, 3.0);
newSuperTrend.restoreState(state);
```

## 📊 Available Indicators

### 📈 Trend Following Indicators
- **SMA** - Simple Moving Average
- **EMA** - Exponential Moving Average  
- **WMA** - Weighted Moving Average
- **VWMA** - Volume Weighted Moving Average
- **HMA** - Hull Moving Average
- **TEMA** - Triple Exponential Moving Average
- **DEMA** - Double Exponential Moving Average
- **WSMA** - Wilder's Smoothed Moving Average
- **RMA** - Running Moving Average

### 📊 Oscillators & Momentum

Single-line oscillators (RSI, CCI, MFI, WR, UO, MOM, AO, ADX, BBPB, KCPB, BBW,
VO, MAR) can be smoothed through the factory:
`createIndicator({ type: IndicatorEnum.rsi, interval: 14, smoothing: 'ema', smoothingLength: 14 })`
returns a `SmoothedIndicator` whose `value` is the smoothed line and `raw` the
oscillator's own value (feed it with `feedCandle`).

- **RSI** - Relative Strength Index
- **STOCH** - Stochastic Oscillator
- **StochasticRSI** - Stochastic RSI
- **CCI** - Commodity Channel Index
- **WR** - Williams %R
- **UO** - Ultimate Oscillator
- **AO** - Awesome Oscillator
- **MOM** - Momentum
- **MFI** - Money Flow Index

### 📉 Volatility Indicators
- **ATR** - Average True Range
- **TR** - True Range
- **BBANDS** - Bollinger Bands
- **BBW** - Bollinger Bands Width
- **BBWP** - Bollinger Bands Width Percentile
- **BBPB** - Bollinger Bands %B
- **KC** - Keltner Channels
- **KCPB** - Keltner Channels %B
- **DC** - Donchian Channels

### 🔄 Trend & Signal Indicators
- **MACD** - Moving Average Convergence Divergence
- **ADX** - Average Directional Index
- **SuperTrend** - SuperTrend
- **PSAR** - Parabolic SAR
- **Ichimoku** - Ichimoku Cloud
- **BullBear** - Bull/Bear Power

### 📊 Volume Indicators
- **VO** - Volume Oscillator
- **Sum** - Rolling Sum (Volume/Price)

### 🎯 Support/Resistance & Levels
- **SupportResistance** - Dynamic Support/Resistance
- **PriorPivot** - Prior Pivot Points
- **ATH** - All Time High
- **Extremum** - Local Extremums

### 🔧 Utility & Composite
- **TVTA** - TradingView Technical Analysis (Composite Rating)
- **QFL** - Quickfingersluc Base Finder
- **MAD** - Median Absolute Deviation
- **MAR** - Moving Average Ratio
- **DIV** - Divergence Detection
- **PC** - Price Change (open→high / open→low move in %; `priceChangeCondition` gt / lt / between)
- **ECD** - Elder Channel Divergence
- **ADR** - Average Daily Range

## 🏗️ Architecture

### LightIndicator Base Class

All indicators extend the `LightIndicator` base class, providing:

- **Circular Buffer History**: Efficient memory usage with fixed-size buffers
- **State Management**: Complete serialization/deserialization support
- **Type Safety**: Generic type support for different input/output types
- **Performance Optimization**: Float64Array for internal state storage

```typescript
// Basic indicator structure
abstract class LightIndicator<T = number, I = number> {
  next(value: I): T | null          // Process new value
  preview(value: I): T | null       // Preview without updating state
  get result(): T | null            // Get current result
  exportState(): LightIndicatorState      // Serialize state
  restoreState(state: LightIndicatorState): void  // Restore state
}
```

### Input Types

Indicators accept different input types based on their requirements:

- **Numeric**: Single price value (Close, High, Low, etc.)
- **HLC**: High, Low, Close candle data
- **OHLC**: Open, High, Low, Close candle data  
- **OHLCV**: Open, High, Low, Close, Volume candle data

### Result Types

Indicators return typed results:

```typescript
// Simple numeric result
const smaResult: number | null = sma.next(price);

// Complex result objects
const rsiResult: PercentileResult | null = rsi.next(price);
const macdResult: MACDResult | null = macd.next(price);
const bbResult: BollingerBandsResult | null = bb.next(candle);
```

## 🎯 Usage Patterns

### 1. Real-time Trading

```typescript
import { EMA, RSI, MACD } from '@gainium/indicators';

class TradingStrategy {
  private ema20 = new EMA(20);
  private ema50 = new EMA(50);
  private rsi = new RSI(14);
  private macd = new MACD();

  onNewCandle(candle: OHLCV) {
    const ema20Val = this.ema20.next(candle.close);
    const ema50Val = this.ema50.next(candle.close);
    const rsiVal = this.rsi.next(candle.close);
    const macdVal = this.macd.next(candle.close);

    if (ema20Val && ema50Val && rsiVal && macdVal) {
      // Golden cross with RSI confirmation
      if (ema20Val > ema50Val && rsiVal.value < 70 && macdVal.histogram > 0) {
        this.enterLong();
      }
    }
  }
}
```

### 2. Historical Analysis

```typescript
import { SuperTrend, BollingerBands } from '@gainium/indicators';

function analyzeHistoricalData(candles: OHLCV[]) {
  const superTrend = new SuperTrend(10, 3.0);
  const bb = new BollingerBands(20, 2);
  
  const signals = candles.map(candle => {
    const stResult = superTrend.next(candle);
    const bbResult = bb.next(candle);
    
    return {
      timestamp: candle.timestamp,
      price: candle.close,
      trend: stResult?.trend,
      bbPosition: bbResult ? (candle.close - bbResult.middle) / (bbResult.upper - bbResult.middle) : null
    };
  });
  
  return signals.filter(s => s.trend !== null);
}
```

### 3. Multi-Timeframe Analysis

```typescript
import { RSI, MACD } from '@gainium/indicators';

class MultiTimeframeAnalysis {
  private rsi1h = new RSI(14);
  private rsi4h = new RSI(14);
  private rsi1d = new RSI(14);
  
  // Call with appropriate timeframe data
  update1h(price: number) { return this.rsi1h.next(price); }
  update4h(price: number) { return this.rsi4h.next(price); }
  update1d(price: number) { return this.rsi1d.next(price); }
  
  getOverallSignal() {
    const rsi1h = this.rsi1h.result?.value;
    const rsi4h = this.rsi4h.result?.value;
    const rsi1d = this.rsi1d.result?.value;
    
    if (rsi1h && rsi4h && rsi1d) {
      // All timeframes oversold
      if (rsi1h < 30 && rsi4h < 40 && rsi1d < 50) return 'STRONG_BUY';
      // All timeframes overbought  
      if (rsi1h > 70 && rsi4h > 60 && rsi1d > 50) return 'STRONG_SELL';
    }
    return 'NEUTRAL';
  }
}
```

## 🔧 Contributing

We welcome contributions! Please follow these guidelines:

### 1. Follow the LightIndicator Pattern

All indicators must extend the `LightIndicator` base class:

```typescript
export class MyIndicator extends LightIndicator<ResultType, InputType> {
  constructor(period: number) {
    super(historyLength, defaultValue, stateSize, fillValue);
  }

  protected calculate(): ResultType | null {
    // Implementation
  }
}
```

### 2. Comprehensive Documentation

- Add detailed JSDoc comments with type classification
- Include trading interpretation and usage examples
- Provide formula and parameter guidelines
- Add reliable reference links

### 3. Type Safety

- Use proper TypeScript types for inputs and outputs
- Define custom result types for complex indicators
- Export all types from appropriate modules

### 4. Testing

- Add comprehensive unit tests
- Test edge cases and error conditions
- Verify mathematical accuracy against known references

### 5. Performance

- Use efficient algorithms and data structures
- Minimize memory allocations in calculation loops
- Leverage Float64Array and circular buffers

### 6. State Management

- Implement proper `exportState()` and `restoreState()` methods
- Handle all internal state including child indicators
- Test serialization/deserialization thoroughly

## 📈 Performance Characteristics

- **Memory Efficient**: Circular buffers limit memory growth
- **CPU Optimized**: Minimal allocations in hot paths
- **Real-time Ready**: O(1) complexity for most operations
- **Scalable**: Handles thousands of instruments simultaneously

## 🤝 License

MIT License - see LICENSE file for details.

## 🚀 Used By

This library powers the technical analysis engine in [Gainium](https://gainium.io/), a professional cryptocurrency trading platform trusted by thousands of traders worldwide.

## 📞 Support

- 📖 [Documentation](https://github.com/Gainium/indicators)
- 🐛 [Issue Tracker](https://github.com/Gainium/indicators/issues)
- 💬 [Gainium Community](https://gainium.io/)

---

Built with ❤️ by the Gainium team for the trading community.
