import { MFI } from '../MFI/MFI'
import { MACD } from '../MACD/MACD'
import { EMA } from '../EMA/EMA'
import { RSI } from '../RSI/RSI'
import { CCI } from '../CCI/CCI'
import { AO } from '../AO/AO'
import { WilliamsR } from '../WR/WR'
import { UltimateOscillator } from '../UO/UO'
import { MOM } from '../MOM/MOM'
import { StochasticOscillator } from '../STOCH/StochasticOscillator'
import {
  LightIndicator,
  LightIndicatorState,
  PivotCalculator,
  fixedArray,
  ohlcvValue,
} from '../util'
import { DIVResult } from '../types/result'
import { OHLCV } from '../types/candles'

export type DIVUsableOscillators =
  | 'mfi'
  | 'ao'
  | 'wr'
  | 'uo'
  | 'mom'
  | 'macd'
  | 'rsi'
  | 'cci'
  | 'stoch'

/**
 * Divergence Detector (DIV) - Legacy Complex Indicator
 * Type: Market Structure/Pattern Recognition Indicator
 *
 * The Divergence Detector is a sophisticated technical analysis tool that identifies
 * divergences between price action and various momentum oscillators. This is a legacy
 * implementation with complex internal logic that has been preserved for historical
 * compatibility and proven effectiveness in divergence detection.
 *
 * Divergences occur when price movements are not confirmed by the underlying momentum
 * indicators, often signaling potential trend reversals or weakening momentum. This
 * indicator analyzes multiple oscillators simultaneously to detect both regular and
 * hidden divergences using pivot point analysis.
 *
 * Supported Oscillators:
 * - MFI (Money Flow Index)
 * - MACD (Moving Average Convergence Divergence)
 * - Stochastic Oscillator
 * - RSI (Relative Strength Index)
 * - CCI (Commodity Channel Index)
 * - AO (Awesome Oscillator)
 * - Williams %R
 * - UO (Ultimate Oscillator)
 * - MOM (Momentum)
 *
 * Types of Divergences Detected:
 * - Regular Bullish: Price makes lower lows while oscillator makes higher lows (reversal signal)
 * - Regular Bearish: Price makes higher highs while oscillator makes lower highs (reversal signal)
 * - Hidden Bullish: Price makes higher lows while oscillator makes lower lows (continuation signal)
 * - Hidden Bearish: Price makes lower highs while oscillator makes higher highs (continuation signal)
 *
 * Trading Interpretation:
 * - Regular Divergences: Often signal trend reversals and are used for counter-trend entries
 * - Hidden Divergences: Usually indicate trend continuation and support trend-following strategies
 * - Multiple Oscillator Confirmation: Stronger signals when multiple oscillators show divergence
 * - Time Frame Consideration: Divergences on higher time frames are generally more significant
 *
 * Note: This is a legacy implementation with complex algorithmic logic that works based on
 * established behavior patterns. The internal calculations involve sophisticated pivot
 * detection and multi-oscillator analysis optimized for performance and accuracy.
 *
 * Candle Input Type: OHLCV (Open, High, Low, Close, Volume) - full candle data for comprehensive analysis
 *
 * @see https://www.investopedia.com/terms/d/divergence.asp
 * @see https://www.babypips.com/learn/forex/divergence-cheat-sheet
 */

export class DIV extends LightIndicator<DIVResult, OHLCV> {
  private mfi: MFI = new MFI(14)
  private macd: MACD = new MACD(new EMA(12), new EMA(26), new EMA(9))
  private stoch = new StochasticOscillator(14, 3, 1)
  private rsi: RSI = new RSI(14)
  private cci: CCI = new CCI(10, 'close')
  private ao: AO = new AO(5, 34)
  private wr: WilliamsR = new WilliamsR(14)
  private uo: UltimateOscillator = new UltimateOscillator(7, 14, 28)
  private mom: MOM = new MOM(10, 'close')
  private highArray: number[] = []
  private export_highArray: number[] = []
  private lowArray: number[] = []
  private export_lowArray: number[] = []
  private pivotLowCalculator: PivotCalculator
  private pivotHighCalculator: PivotCalculator
  private barsSinceMap: Map<string, number> = new Map()
  private export_barsSinceMap: Map<string, number> = new Map()
  private valueWhenMap: Map<string, number[]> = new Map()
  private export_valueWhenMap: Map<string, number[]> = new Map()
  private pivotMap: Map<string, boolean[]> = new Map()
  private export_pivotMap: Map<string, boolean[]> = new Map()
  private oscHistoryMap: Map<string, number[]> = new Map()
  private export_oscHistoryMap: Map<string, number[]> = new Map()
  /**
   * Creates a new Divergence Detector indicator instance
   *
   * @param oscillators - Array of oscillator types to analyze for divergences (e.g., ['rsi', 'macd', 'stoch'])
   * @param leftBars - Number of bars to the left of a pivot point for validation (typically 4-10)
   * @param rightBars - Number of bars to the right of a pivot point for validation (typically 4-10)
   * @param rangeLower - Lower bound for oscillator range filtering (helps focus on significant levels)
   * @param rangeUpper - Upper bound for oscillator range filtering (helps focus on significant levels)
   */
  constructor(
    private readonly oscillators: DIVUsableOscillators[],
    public readonly leftBars: number,
    public readonly rightBars: number,
    public readonly rangeLower: number,
    public readonly rangeUpper: number,
  ) {
    /**
     * Initialize the LightIndicator parent class
     * @param historyLength - 1 (only need current candle for oscillator calculations)
     * @param defaultValue - ohlcvValue (default object with zero values, e.g., {open: 0, high: 0, low: 0, close: 0, volume: 0})
     * @param stateSize - 0 (legacy implementation uses internal data structures for state management)
     */
    super(1, ohlcvValue, 0)
    const range = this.leftBars + this.rightBars
    this.highArray = fixedArray(range + 1)
    this.lowArray = fixedArray(range + 1)
    this.export_highArray = fixedArray(range + 1)
    this.export_lowArray = fixedArray(range + 1)
    this.pivotHighCalculator = new PivotCalculator(
      this.leftBars,
      this.rightBars,
      'high',
    )
    this.pivotLowCalculator = new PivotCalculator(
      this.leftBars,
      this.rightBars,
      'low',
    )
  }

  private plFound(lowArray: number[]) {
    return !Number.isNaN(this.pivotLowCalculator.calculate(lowArray))
  }
  private phFound(highArray: number[]) {
    return !Number.isNaN(this.pivotHighCalculator.calculate(highArray))
  }
  private barssince(bool: boolean, type: string) {
    if (!bool) {
      const prev = this.barsSinceMap.get(type)
      if (prev !== undefined) {
        this.barsSinceMap.set(type, prev + 1)
      }
    } else {
      this.barsSinceMap.set(type, 0)
    }
    return this.barsSinceMap.get(type)
  }
  private valuewhen(bool: boolean, val: number, count: number, type: string) {
    if (bool) {
      let prev = this.valueWhenMap.get(type)
      if (!prev) {
        prev = fixedArray(5)
      }
      prev.push(val)
      this.valueWhenMap.set(type, prev)
    }
    const array = this.valueWhenMap.get(type)
    if (array) {
      return array[array.length - count - 1]
    }
    return NaN
  }
  private _inRange(bool: boolean, type: string) {
    const bars = this.barssince(bool, `inRange${type}`)
    return bars !== undefined
      ? this.rangeLower <= bars && bars <= this.rangeUpper
      : false
  }
  // Higher Low on indicator
  private oscHL(_osc: number[], _type: string) {
    const type = `oscHL${_type}`
    let v = this.pivotMap.get(type)
    if (!v) {
      v = fixedArray(3)
    }
    const range = this.plFound(_osc)
    v.push(range)
    this.pivotMap.set(type, v)
    const osc =
      _osc?.length >= this.rightBars
        ? _osc[_osc.length - this.rightBars - 1]
        : NaN
    const vw = this.valuewhen(range, osc, 1, type)
    const r = this._inRange(v[v.length - 2], type)
    return osc > vw && r
  }
  // Lower Low on Price
  private priceLL(osc: number[], _type: string) {
    const currentLow =
      this.lowArray?.length >= this.rightBars
        ? this.lowArray[this.lowArray.length - 1 - this.rightBars]
        : NaN
    const type = `priceLL${_type}`
    const valWhen = this.valuewhen(this.plFound(osc), currentLow, 1, type)
    return currentLow < valWhen
  }
  // Regular Bullish
  private bullCond(osc: number[] | undefined, _type: string) {
    if (!osc) {
      return false
    }
    const type = `bullCond${_type}`
    const ll = this.priceLL(osc, type)
    const hl = this.oscHL(osc, type)
    const pl = this.plFound(osc)
    return ll && hl && pl
  }
  // Lower High on indicator
  private oscLH(_osc: number[], _type: string) {
    const type = `oscLH${_type}`
    let v = this.pivotMap.get(type)
    if (!v) {
      v = fixedArray(3)
    }
    const range = this.phFound(_osc)
    v.push(range)
    this.pivotMap.set(type, v)
    const osc =
      _osc?.length >= this.rightBars
        ? _osc[_osc.length - this.rightBars - 1]
        : NaN
    const vw = this.valuewhen(range, osc, 1, type)
    const r = this._inRange(v[v.length - 2], type)
    return osc < vw && r
  }
  // Higher High on Price
  private priceHH(osc: number[], _type: string) {
    const currentHigh =
      this.highArray?.length >= this.rightBars
        ? this.highArray[this.highArray.length - 1 - this.rightBars]
        : NaN
    const type = `priceHH${_type}`
    const vw = this.valuewhen(this.phFound(osc), currentHigh, 1, type)
    return currentHigh > vw
  }
  // Regular Bearish
  private bearCond(osc: number[] | undefined, _type: string) {
    if (!osc) {
      return false
    }
    const type = `bearCond${_type}`
    const hh = this.priceHH(osc, type)
    const lh = this.oscLH(osc, type)
    const ph = this.phFound(osc)
    return hh && lh && ph
  }
  // Lower Low on indicator
  private oscLL(_osc: number[], _type: string) {
    const type = `oscLL${_type}`
    let v = this.pivotMap.get(type)
    if (!v) {
      v = fixedArray(3)
    }
    const range = this.plFound(_osc)
    v.push(range)
    this.pivotMap.set(type, v)
    const osc =
      _osc?.length >= this.rightBars
        ? _osc[_osc.length - this.rightBars - 1]
        : NaN
    const vw = this.valuewhen(range, osc, 1, type)
    const r = this._inRange(v[v.length - 2], type)
    return osc < vw && r
  }
  // Higher Low on Price
  private priceHL(osc: number[], _type: string) {
    const currentLow =
      this.lowArray?.length >= this.rightBars
        ? this.lowArray[this.lowArray.length - 1 - this.rightBars]
        : NaN
    const type = `priceHL${_type}`
    const valWhen = this.valuewhen(this.plFound(osc), currentLow, 1, type)
    return currentLow > valWhen
  }
  // Hidden Bullish
  private hiddenBullCond(osc: number[] | undefined, _type: string) {
    if (!osc) {
      return false
    }
    const type = `hiddenBullCond${_type}`
    const hl = this.priceHL(osc, type)
    const ll = this.oscLL(osc, type)
    const pl = this.plFound(osc)
    return hl && ll && pl
  }
  // Higher High on indicator
  private oscHH(_osc: number[], _type: string) {
    const type = `oscHH${_type}`
    let v = this.pivotMap.get(type)
    if (!v) {
      v = fixedArray(3)
    }
    const range = this.phFound(_osc)
    v.push(range)
    this.pivotMap.set(type, v)
    const osc =
      _osc?.length >= this.rightBars
        ? _osc[_osc.length - this.rightBars - 1]
        : NaN
    const vw = this.valuewhen(range, osc, 1, type)
    const r = this._inRange(v[v.length - 2], type)
    return osc > vw && r
  }
  // Lower High on Price
  private priceLH(osc: number[], _type: string) {
    const currentHigh =
      this.highArray?.length >= this.rightBars
        ? this.highArray[this.highArray.length - 1 - this.rightBars]
        : NaN
    const type = `priceLH${_type}`
    const vw = this.valuewhen(this.phFound(osc), currentHigh, 1, type)
    return currentHigh < vw
  }
  // Hidden Bearish
  private hiddenBearCond(osc: number[] | undefined, _type: string) {
    if (!osc) {
      return false
    }
    const type = `hiddenBearCond${_type}`
    const lh = this.priceLH(osc, type)
    const hh = this.oscHH(osc, type)
    const ph = this.phFound(osc)
    return lh && hh && ph
  }

  private setOscHistory(type: string, value: number | undefined) {
    if (typeof value !== 'undefined') {
      let val = this.oscHistoryMap.get(type)
      if (!val) {
        val = fixedArray(this.leftBars + this.rightBars + 1)
      }
      val.push(value)
      this.oscHistoryMap.set(type, val)
    }
  }

  private useOsc(type: DIVUsableOscillators) {
    return this.oscillators.includes(type)
  }

  calculate(): DIVResult | null {
    const l = this._history.last
    this.highArray.push(l.high)
    this.lowArray.push(l.low)
    const rsi = this.useOsc('rsi') ? this.rsi.next(l.close) : undefined
    const mfi = this.useOsc('mfi') ? this.mfi.next(l) : undefined
    const macd = this.useOsc('macd') ? this.macd.next(l.close) : undefined
    const cci = this.useOsc('cci') ? this.cci.next(l) : undefined
    const ao = this.useOsc('ao') ? this.ao.next(l) : undefined
    const wr = this.useOsc('wr') ? this.wr.next(l) : undefined
    const uo = this.useOsc('uo') ? this.uo.next(l) : undefined
    const mom = this.useOsc('mom') ? this.mom.next(l) : undefined
    const stoch = this.useOsc('stoch') ? this.stoch.next(l) : undefined
    if (rsi && typeof rsi.value !== 'undefined') {
      this.setOscHistory('rsi', rsi.value)
    }
    if (mfi && typeof mfi.value !== 'undefined') {
      this.setOscHistory('mfi', mfi.value)
    }
    if (stoch && typeof stoch.stochD !== 'undefined') {
      this.setOscHistory('stoch', stoch.stochD)
    }
    if (macd && typeof macd.histogram !== 'undefined') {
      this.setOscHistory('macd', macd.histogram)
    }
    if (cci && typeof cci.value !== 'undefined') {
      this.setOscHistory('cci', cci.value)
    }
    if (ao && typeof ao.value !== 'undefined') {
      this.setOscHistory('ao', ao.value)
    }
    if (wr && typeof wr.value !== 'undefined') {
      this.setOscHistory('wr', wr.value)
    }
    if (uo && typeof uo.value !== 'undefined') {
      this.setOscHistory('uo', uo.value)
    }
    if (mom && typeof mom.value !== 'undefined') {
      this.setOscHistory('mom', mom.value)
    }
    let negdivergence = 0
    if (
      this.useOsc('rsi') &&
      this.bearCond(this.oscHistoryMap.get('rsi'), 'rsi')
    ) {
      negdivergence += 1
    }
    if (
      this.useOsc('mfi') &&
      this.bearCond(this.oscHistoryMap.get('mfi'), 'mfi')
    ) {
      negdivergence += 1
    }
    if (
      this.useOsc('stoch') &&
      this.bearCond(this.oscHistoryMap.get('stoch'), 'stoch')
    ) {
      negdivergence += 1
    }
    if (
      this.useOsc('macd') &&
      this.bearCond(this.oscHistoryMap.get('macd'), 'macd')
    ) {
      negdivergence += 1
    }
    if (
      this.useOsc('cci') &&
      this.bearCond(this.oscHistoryMap.get('cci'), 'cci')
    ) {
      negdivergence += 1
    }
    if (
      this.useOsc('ao') &&
      this.bearCond(this.oscHistoryMap.get('ao'), 'ao')
    ) {
      negdivergence += 1
    }
    if (
      this.useOsc('wr') &&
      this.bearCond(this.oscHistoryMap.get('wr'), 'wr')
    ) {
      negdivergence += 1
    }
    if (
      this.useOsc('uo') &&
      this.bearCond(this.oscHistoryMap.get('uo'), 'uo')
    ) {
      negdivergence += 1
    }
    if (
      this.useOsc('mom') &&
      this.bearCond(this.oscHistoryMap.get('mom'), 'mom')
    ) {
      negdivergence += 1
    }
    let posdivergence = 0
    if (
      this.useOsc('rsi') &&
      this.bullCond(this.oscHistoryMap.get('rsi'), 'rsi')
    ) {
      posdivergence += 1
    }
    if (
      this.useOsc('mfi') &&
      this.bullCond(this.oscHistoryMap.get('mfi'), 'mfi')
    ) {
      posdivergence += 1
    }
    if (
      this.useOsc('stoch') &&
      this.bullCond(this.oscHistoryMap.get('stoch'), 'stoch')
    ) {
      posdivergence += 1
    }
    if (
      this.useOsc('macd') &&
      this.bullCond(this.oscHistoryMap.get('macd'), 'macd')
    ) {
      posdivergence += 1
    }
    if (
      this.useOsc('cci') &&
      this.bullCond(this.oscHistoryMap.get('cci'), 'cci')
    ) {
      posdivergence += 1
    }
    if (
      this.useOsc('ao') &&
      this.bullCond(this.oscHistoryMap.get('ao'), 'ao')
    ) {
      posdivergence += 1
    }
    if (
      this.useOsc('wr') &&
      this.bullCond(this.oscHistoryMap.get('wr'), 'wr')
    ) {
      posdivergence += 1
    }
    if (
      this.useOsc('uo') &&
      this.bullCond(this.oscHistoryMap.get('uo'), 'uo')
    ) {
      posdivergence += 1
    }
    if (
      this.useOsc('mom') &&
      this.bullCond(this.oscHistoryMap.get('mom'), 'mom')
    ) {
      posdivergence += 1
    }
    let negdivergencehidden = 0
    if (
      this.useOsc('rsi') &&
      this.hiddenBearCond(this.oscHistoryMap.get('rsi'), 'rsi')
    ) {
      negdivergencehidden += 1
    }
    if (
      this.useOsc('stoch') &&
      this.hiddenBearCond(this.oscHistoryMap.get('stoch'), 'stoch')
    ) {
      negdivergencehidden += 1
    }
    if (
      this.useOsc('mfi') &&
      this.hiddenBearCond(this.oscHistoryMap.get('mfi'), 'mfi')
    ) {
      negdivergencehidden += 1
    }
    if (
      this.useOsc('macd') &&
      this.hiddenBearCond(this.oscHistoryMap.get('macd'), 'macd')
    ) {
      negdivergencehidden += 1
    }
    if (
      this.useOsc('cci') &&
      this.hiddenBearCond(this.oscHistoryMap.get('cci'), 'cci')
    ) {
      negdivergencehidden += 1
    }
    if (
      this.useOsc('ao') &&
      this.hiddenBearCond(this.oscHistoryMap.get('ao'), 'ao')
    ) {
      negdivergencehidden += 1
    }
    if (
      this.useOsc('wr') &&
      this.hiddenBearCond(this.oscHistoryMap.get('wr'), 'wr')
    ) {
      negdivergencehidden += 1
    }
    if (
      this.useOsc('uo') &&
      this.hiddenBearCond(this.oscHistoryMap.get('uo'), 'uo')
    ) {
      negdivergencehidden += 1
    }
    if (
      this.useOsc('mom') &&
      this.hiddenBearCond(this.oscHistoryMap.get('mom'), 'mom')
    ) {
      negdivergencehidden += 1
    }
    let posdivergencehidden = 0
    if (
      this.useOsc('rsi') &&
      this.hiddenBullCond(this.oscHistoryMap.get('rsi'), 'rsi')
    ) {
      posdivergencehidden += 1
    }
    if (
      this.useOsc('mfi') &&
      this.hiddenBullCond(this.oscHistoryMap.get('mfi'), 'mfi')
    ) {
      posdivergencehidden += 1
    }
    if (
      this.useOsc('stoch') &&
      this.hiddenBullCond(this.oscHistoryMap.get('stoch'), 'stoch')
    ) {
      posdivergencehidden += 1
    }
    if (
      this.useOsc('macd') &&
      this.hiddenBullCond(this.oscHistoryMap.get('macd'), 'macd')
    ) {
      posdivergencehidden += 1
    }
    if (
      this.useOsc('cci') &&
      this.hiddenBullCond(this.oscHistoryMap.get('cci'), 'cci')
    ) {
      posdivergencehidden += 1
    }
    if (
      this.useOsc('ao') &&
      this.hiddenBullCond(this.oscHistoryMap.get('ao'), 'ao')
    ) {
      posdivergencehidden += 1
    }
    if (
      this.useOsc('wr') &&
      this.hiddenBullCond(this.oscHistoryMap.get('wr'), 'wr')
    ) {
      posdivergencehidden += 1
    }
    if (
      this.useOsc('uo') &&
      this.hiddenBullCond(this.oscHistoryMap.get('uo'), 'uo')
    ) {
      posdivergencehidden += 1
    }
    if (
      this.useOsc('mom') &&
      this.hiddenBullCond(this.oscHistoryMap.get('mom'), 'mom')
    ) {
      posdivergencehidden += 1
    }
    return {
      negdivergencehidden,
      posdivergencehidden,
      negdivergence,
      posdivergence,
    }
  }

  exportState(): LightIndicatorState {
    for (let i = 0; i < this.highArray.length; i++) {
      this.export_highArray[i] = this.highArray[i]
    }
    for (let i = 0; i < this.lowArray.length; i++) {
      this.export_lowArray[i] = this.lowArray[i]
    }
    for (const [key, value] of this.barsSinceMap.entries()) {
      this.export_barsSinceMap.set(key, value)
    }
    for (const [key, value] of this.valueWhenMap.entries()) {
      this.export_valueWhenMap.set(key, value.slice())
    }
    for (const [key, value] of this.pivotMap.entries()) {
      this.export_pivotMap.set(key, value.slice())
    }
    for (const [key, value] of this.oscHistoryMap.entries()) {
      this.export_oscHistoryMap.set(key, value.slice())
    }
    return {
      bin: [],
      circ: [],
      parent: super.exportState(),
      child: [
        this.mfi.exportState(),
        this.macd.exportState(),
        this.stoch.exportState(),
        this.rsi.exportState(),
        this.cci.exportState(),
        this.ao.exportState(),
        this.wr.exportState(),
        this.uo.exportState(),
        this.mom.exportState(),
      ],
    }
  }

  restoreState(state: LightIndicatorState): void {
    if (!state.child) {
      throw new Error('Invalid state: child indicators are missing')
    }
    if (!state.parent) {
      throw new Error('Invalid state: parent indicator state is missing')
    }
    this.mfi.restoreState(state.child[0])
    this.macd.restoreState(state.child[1])
    this.stoch.restoreState(state.child[2])
    this.rsi.restoreState(state.child[3])
    this.cci.restoreState(state.child[4])
    this.ao.restoreState(state.child[5])
    this.wr.restoreState(state.child[6])
    this.uo.restoreState(state.child[7])
    this.mom.restoreState(state.child[8])
    for (let i = 0; i < this.export_highArray.length; i++) {
      this.highArray[i] = this.export_highArray[i]
    }
    for (let i = 0; i < this.export_lowArray.length; i++) {
      this.lowArray[i] = this.export_lowArray[i]
    }
    for (const [key, value] of this.export_barsSinceMap.entries()) {
      this.barsSinceMap.set(key, value)
    }
    for (const [key, value] of this.export_valueWhenMap.entries()) {
      const live = this.valueWhenMap.get(key) ?? fixedArray<number>(5)
      live.length = 0
      live.push(...value)
      this.valueWhenMap.set(key, live)
    }
    for (const [key, value] of this.export_pivotMap.entries()) {
      const live = this.pivotMap.get(key) ?? fixedArray<boolean>(3)
      live.length = 0
      live.push(...value)
      this.pivotMap.set(key, live)
    }
    for (const [key, value] of this.export_oscHistoryMap.entries()) {
      const live =
        this.oscHistoryMap.get(key) ??
        fixedArray<number>(this.leftBars + this.rightBars + 1)
      live.length = 0
      live.push(...value)
      this.oscHistoryMap.set(key, live)
    }
    super.restoreState(state.parent)
  }
}
