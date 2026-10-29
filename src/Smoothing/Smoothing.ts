import { SMA } from '../SMA/SMA'
import { EMA } from '../EMA/EMA'
import { WMA } from '../WMA/WMA'
import { DEMA } from '../DEMA/DEMA'
import { TEMA } from '../TEMA/TEMA'
import { HMA } from '../HMA/HMA'
import { RMA } from '../RMA/RMA'
import { IndicatorEnum } from '../types/config'
import { PercentileResult } from '../types/result'
import { PercentileCalculator } from '../util/percentile'
import { LightIndicator, LightIndicatorState } from '../util/indicator'

/**
 * Oscillator smoothing — one moving average laid over the main line of a
 * single-line oscillator.
 *
 * The oscillator itself is not modified: `SmoothedIndicator` wraps an
 * instance of it that was built WITHOUT percentile, feeds every input through
 * it, smooths its `value` and computes the percentile (when requested) on the
 * smoothed line. With smoothing off nothing is wrapped, so the output is the
 * oscillator's own, unchanged.
 */

/** Moving averages accepted as smoothing (VWMA and `price` are not). */
export type SmoothingType =
  | 'sma'
  | 'ema'
  | 'wma'
  | 'dema'
  | 'tema'
  | 'hma'
  | 'rma'

/** Every accepted smoothing type, lowercase. */
export const SMOOTHING_TYPES: readonly SmoothingType[] = [
  'sma',
  'ema',
  'wma',
  'dema',
  'tema',
  'hma',
  'rma',
]

/** Longest accepted smoothing length. */
export const SMOOTHING_MAX_LENGTH = 1000

/**
 * Indicator types whose main line can be smoothed: the single-line value
 * oscillators. Every one of them reports that line as `value`.
 */
export const SMOOTHABLE_INDICATORS: readonly IndicatorEnum[] = [
  IndicatorEnum.rsi,
  IndicatorEnum.cci,
  IndicatorEnum.mfi,
  IndicatorEnum.wr,
  IndicatorEnum.uo,
  IndicatorEnum.mom,
  IndicatorEnum.ao,
  IndicatorEnum.adx,
  IndicatorEnum.bbpb,
  IndicatorEnum.kcpb,
  IndicatorEnum.bbw,
  IndicatorEnum.vo,
  IndicatorEnum.mar,
]

/** True when `type` is one of `SMOOTHABLE_INDICATORS`. */
export function isSmoothableIndicator(type: unknown): boolean {
  return SMOOTHABLE_INDICATORS.includes(type as IndicatorEnum)
}

/** A smoothing configuration that is actually in effect. */
export type SmoothingConfig = {
  type: SmoothingType
  length: number
}

/**
 * Result of a smoothed oscillator: `value` is the smoothed line, `raw` the
 * oscillator's own value on the same bar, `percentile` (percentile mode)
 * ranks `value`. Any `trend` the oscillator reports is passed through, and so
 * are ADX's `pdi` / `mdi` (unsmoothed — smoothing applies to the ADX line).
 */
export interface SmoothedResult extends PercentileResult {
  raw: number
  /** ADX only: +DI / −DI of the same bar, passed through unsmoothed */
  pdi?: number
  mdi?: number
}

/**
 * Normalises stored smoothing fields. Returns `null` (smoothing off) for a
 * missing, `'none'` or unknown type (matched case-insensitively, trimmed),
 * and for a missing, non-numeric, < 1 or > 1000 length. A fractional length
 * is floored; a numeric string is accepted.
 */
export function resolveSmoothing(
  type?: string | null,
  length?: number | string | null,
): SmoothingConfig | null {
  if (typeof type !== 'string') {
    return null
  }
  const t = type.trim().toLowerCase() as SmoothingType
  if (!SMOOTHING_TYPES.includes(t)) {
    return null
  }
  if (length === null || length === undefined || length === '') {
    return null
  }
  const l = Math.floor(+length)
  if (!Number.isFinite(l) || l < 1 || l > SMOOTHING_MAX_LENGTH) {
    return null
  }
  return { type: t, length: l }
}

/**
 * Extra candles the smoothing average needs on top of the oscillator's own
 * warm-up (0 when off): one length for SMA/EMA/WMA/RMA, two for DEMA, three
 * for TEMA, `length + ceil(length / 2) + ceil(sqrt(length))` for HMA (its
 * half-length WMA only starts once the full-length one is ready).
 */
export function getSmoothingWarmup(
  type?: string | null,
  length?: number | string | null,
): number {
  const cfg = resolveSmoothing(type, length)
  if (!cfg) {
    return 0
  }
  switch (cfg.type) {
    case 'dema':
      return cfg.length * 2
    case 'tema':
      return cfg.length * 3
    case 'hma':
      return (
        cfg.length +
        Math.ceil(cfg.length / 2) +
        Math.ceil(Math.sqrt(cfg.length))
      )
    default:
      return cfg.length
  }
}

type Smoother = SMA | EMA | WMA | DEMA | TEMA | HMA | RMA

/** The library moving average for `cfg`. */
export function createSmoother(cfg: SmoothingConfig): Smoother {
  switch (cfg.type) {
    case 'sma':
      return new SMA(cfg.length)
    case 'ema':
      return new EMA(cfg.length)
    case 'wma':
      return new WMA(cfg.length)
    case 'dema':
      return new DEMA(cfg.length)
    case 'tema':
      return new TEMA(cfg.length)
    case 'hma':
      // HMA(1) would build a zero-length WMA and never produce a value; an
      // average of length 1 is the input itself, which WMA(1) returns.
      return cfg.length < 2 ? new WMA(1) : new HMA(cfg.length)
    case 'rma':
      return new RMA(cfg.length)
  }
}

/** What `SmoothedIndicator` needs from the oscillator it wraps. */
export interface SmoothableOscillator<I> {
  next(value: I): PercentileResult | null
  exportState(): LightIndicatorState
  restoreState(state: LightIndicatorState): void
}

/**
 * Smoothed oscillator. `inner` must be built with percentile OFF; pass the
 * percentile settings here instead so the smoothed line is ranked.
 *
 * Per input: the inner oscillator is advanced; while it has no value nothing
 * is emitted and the average is not fed. Its `value` (R) goes through the
 * average; while the average warms up nothing is emitted. Then the result is
 * `{ value: S, raw: R }` (+ `percentile` once the percentile window is full,
 * + `trend` when the oscillator reports one).
 */
export class SmoothedIndicator<I = any> extends LightIndicator<
  SmoothedResult,
  I
> {
  private readonly smoother: Smoother
  private readonly percentileCalc?: PercentileCalculator

  constructor(
    public readonly inner: SmoothableOscillator<I>,
    public readonly smoothing: SmoothingConfig,
    percentile?: boolean,
    percentileLookback?: number,
    percentilePercentage?: number,
  ) {
    super(1, undefined as unknown as I, 0)
    this.smoother = createSmoother(smoothing)
    if (percentile && percentileLookback) {
      this.percentileCalc = new PercentileCalculator(
        percentileLookback,
        percentilePercentage,
      )
    }
  }

  protected calculate(): SmoothedResult | null {
    const r = this.inner.next(this._history.last)
    if (r === null) {
      return null
    }
    const raw = r.value
    const value = this.smoother.next(raw)
    if (value === null) {
      return null
    }
    const out: SmoothedResult = { value, raw }
    if (this.percentileCalc && this.percentileCalc.insert(value)) {
      out.percentile = this.percentileCalc.getPercentile()
    }
    if ('trend' in r) {
      out.trend = r.trend
    }
    if ('pdi' in r && 'mdi' in r) {
      const dmi = r as { pdi: number; mdi: number }
      out.pdi = dmi.pdi
      out.mdi = dmi.mdi
    }
    return out
  }

  override exportState(): LightIndicatorState {
    return {
      parent: super.exportState(),
      child: [this.inner.exportState(), this.smoother.exportState()],
      percentile: this.percentileCalc?.exportState(),
      bin: [],
      circ: [],
    }
  }

  override restoreState(state: LightIndicatorState): void {
    if (!state.parent || !state.child || state.child.length < 2) {
      throw new Error('Invalid state: smoothed indicator state is incomplete')
    }
    this.inner.restoreState(state.child[0])
    this.smoother.restoreState(state.child[1])
    if (this.percentileCalc && state.percentile) {
      this.percentileCalc.restoreState(state.percentile)
    }
    super.restoreState(state.parent)
  }
}

/** The oscillator a (possibly smoothed) indicator instance is built on. */
export function unwrapSmoothed<T>(indicator: T): T {
  return indicator instanceof SmoothedIndicator
    ? (indicator.inner as unknown as T)
    : indicator
}
