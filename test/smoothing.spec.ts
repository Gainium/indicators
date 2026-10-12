import { describe, it } from 'mocha'
import { expect } from 'chai'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import * as lib from '../src'
import type { IndicatorConfig } from '../src/types/config'
import { IndicatorEnum, MAEnum, RangeType } from '../src/types/config'

/**
 * Oscillator smoothing (smoothing / smoothingLength on every single-line
 * oscillator config).
 *
 * The golden files under `test/fixtures/smoothing-off/` were generated from
 * indicators 1.4.0 (commit 18773c2), before smoothing existed, by feeding the
 * same candles through `createIndicator` + `feedCandle`; each pins the full
 * output series and the final exported state. Regenerate only from a commit
 * that predates a deliberate change to an oscillator (`UPDATE_GOLDEN=1`).
 */

const GOLDEN_DIR = join(__dirname, 'fixtures', 'smoothing-off')

type Candle = { o: number; h: number; l: number; c: number; v: number }

/** Deterministic OHLCV walk with periodic one-way runs (zero-loss bars). */
function candles(count: number, seed = 192837465): Candle[] {
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out: Candle[] = []
  let c = 100
  for (let i = 0; i < count; i++) {
    const o = c
    c = i % 97 >= 80 ? c * 1.004 : Math.max(1, c * (1 + (rand() - 0.48) * 0.03))
    const h = Math.max(o, c) * (1 + rand() * 0.01)
    const l = Math.min(o, c) * (1 - rand() * 0.01)
    const v = 500 + Math.floor(rand() * 1500)
    out.push({ o, h, l, c, v })
  }
  return out
}

const bars = candles(600)

/** One config per in-scope oscillator, smoothing fields absent. */
const SCOPE: [string, IndicatorConfig][] = [
  ['rsi', { type: IndicatorEnum.rsi, interval: 14 }],
  ['cci', { type: IndicatorEnum.cci, interval: 20 }],
  ['mfi', { type: IndicatorEnum.mfi, interval: 14 }],
  ['wr', { type: IndicatorEnum.wr, interval: 14 }],
  ['uo', { type: IndicatorEnum.uo, fast: 7, middle: 14, slow: 28 }],
  ['mom', { type: IndicatorEnum.mom, interval: 10, source: 'close' }],
  ['ao', { type: IndicatorEnum.ao }],
  ['adx', { type: IndicatorEnum.adx, interval: 14 }],
  [
    'bbpb',
    {
      type: IndicatorEnum.bbpb,
      interval: 20,
      bbwMult: 2,
      bbwMa: MAEnum.sma,
      bbwMaLength: 20,
    },
  ],
  [
    'kcpb',
    {
      type: IndicatorEnum.kcpb,
      interval: 20,
      multiplier: 2,
      ma: MAEnum.ema,
      range: RangeType.atr,
      rangeLength: 10,
    },
  ],
  [
    'bbw',
    {
      type: IndicatorEnum.bbw,
      interval: 20,
      bbwMult: 2,
      bbwMa: MAEnum.sma,
      bbwMaLength: 20,
    },
  ],
  ['vo', { type: IndicatorEnum.vo, voShort: 5, voLong: 10 }],
  [
    'mar',
    {
      type: IndicatorEnum.mar,
      mar1type: MAEnum.ema,
      mar1length: 20,
      mar2type: MAEnum.price,
      mar2length: 20,
      trendFilter: true,
      trendFilterLookback: 10,
      trendFilterValue: 1,
      trendFilterType: lib.TrendFilterOperatorEnum.higher,
    },
  ],
]

const PCT = {
  percentile: true,
  percentileLookback: 50,
  percentilePercentage: 80,
}

const OFF_VARIANTS: [string, Record<string, unknown>][] = [
  ['missing', {}],
  ['none', { smoothing: 'none', smoothingLength: 14 }],
  ['NONE', { smoothing: 'NONE', smoothingLength: 14 }],
  ['null', { smoothing: null, smoothingLength: null }],
  ['unknown', { smoothing: 'kama', smoothingLength: 14 }],
  ['vwma', { smoothing: 'vwma', smoothingLength: 14 }],
  ['price', { smoothing: 'price', smoothingLength: 14 }],
  ['no-length', { smoothing: 'ema' }],
  ['length-0', { smoothing: 'ema', smoothingLength: 0 }],
  ['length-1001', { smoothing: 'ema', smoothingLength: 1001 }],
]

const make = (cfg: IndicatorConfig, extra: Record<string, unknown> = {}) =>
  lib.createIndicator({ ...cfg, ...extra } as IndicatorConfig)

const feed = (ind: unknown, c: Candle) => {
  lib.feedCandle(ind, c)
  return (ind as { result: unknown }).result
}

/** Full output series + final exported state, hashed. */
function fingerprint(ind: unknown): { sha256: string; emitted: number } {
  const series = bars.map((c) => feed(ind, c))
  const state = (ind as { exportState(): unknown }).exportState()
  const json = JSON.stringify({ series, state }, (_k, v) =>
    ArrayBuffer.isView(v) ? Array.from(v as Float64Array) : v,
  )
  return {
    sha256: createHash('sha256').update(json).digest('hex'),
    emitted: series.filter((r) => r !== null && r !== undefined).length,
  }
}

type MA = { next(v: number): number | null }
const maRef: Record<string, (n: number) => MA> = {
  sma: (n) => new lib.SMA(n),
  ema: (n) => new lib.EMA(n),
  wma: (n) => new lib.WMA(n),
  dema: (n) => new lib.DEMA(n),
  tema: (n) => new lib.TEMA(n),
  hma: (n) => (n < 2 ? new lib.WMA(1) : new lib.HMA(n)),
  rma: (n) => new lib.RMA(n),
}

describe('oscillator smoothing', () => {
  describe('smoothing off is the old indicator, output and state', () => {
    for (const [name, cfg] of SCOPE) {
      for (const [pname, pct] of [
        ['plain', {}],
        ['percentile', PCT],
      ] as const) {
        const file = join(GOLDEN_DIR, `${name}-${pname}.json`)
        for (const [vname, v] of OFF_VARIANTS) {
          it(`${name} (${pname}, ${vname})`, () => {
            const ind = make(cfg, { ...pct, ...v })
            expect(ind.constructor.name).to.not.equal('SmoothedIndicator')
            const got = fingerprint(ind)
            if (process.env.UPDATE_GOLDEN === '1' && vname === 'missing') {
              if (!existsSync(GOLDEN_DIR))
                mkdirSync(GOLDEN_DIR, { recursive: true })
              writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`)
            }
            expect(got.emitted).to.be.greaterThan(400)
            expect(got).to.deep.equal(JSON.parse(readFileSync(file, 'utf8')))
          })
        }
      }
    }
  })

  describe('smoothed value = the library MA over the raw series', () => {
    for (const [name, cfg] of SCOPE) {
      for (const type of Object.keys(maRef)) {
        it(`${name} + ${type}(9)`, () => {
          const base = make(cfg)
          const sm = make(cfg, {
            smoothing: type.toUpperCase(),
            smoothingLength: 9,
          })
          expect(sm).to.be.instanceOf(lib.SmoothedIndicator)
          const ref = maRef[type](9)
          let compared = 0
          for (const c of bars) {
            const r = feed(base, c) as lib.PercentileResult | null
            const s = feed(sm, c) as lib.SmoothedResult | null
            const want = r === null ? null : ref.next(r.value)
            if (want === null) {
              expect(s).to.equal(null)
              continue
            }
            const expected: Record<string, unknown> = {
              value: want,
              raw: r!.value,
            }
            if ('trend' in r!) expected.trend = r!.trend
            expect(s).to.deep.equal(expected)
            compared++
          }
          expect(compared).to.be.greaterThan(350)
        })
      }
    }

    it('length 1 is the raw series itself (every type, HMA included)', () => {
      for (const type of Object.keys(maRef)) {
        const base = make(SCOPE[0][1])
        const sm = make(SCOPE[0][1], { smoothing: type, smoothingLength: 1 })
        for (const c of bars) {
          const r = feed(base, c) as lib.PercentileResult | null
          const s = feed(sm, c) as lib.SmoothedResult | null
          expect(s).to.deep.equal(r ? { value: r.value, raw: r.value } : null)
        }
      }
    })
  })

  describe('percentile ranks the smoothed line', () => {
    for (const [name, cfg] of SCOPE) {
      it(name, () => {
        const base = make(cfg)
        const sm = make(cfg, { ...PCT, smoothing: 'ema', smoothingLength: 9 })
        const ema = new lib.EMA(9)
        const ref = new lib.PercentileCalculator(50, 80)
        let ranked = 0
        for (const c of bars) {
          const r = feed(base, c) as lib.PercentileResult | null
          const s = feed(sm, c) as lib.SmoothedResult | null
          const v = r === null ? null : ema.next(r.value)
          if (v === null) {
            expect(s).to.equal(null)
            continue
          }
          const expected: Record<string, unknown> = { value: v, raw: r!.value }
          if (ref.insert(v)) {
            expected.percentile = ref.getPercentile()
            ranked++
          }
          if ('trend' in r!) expected.trend = r!.trend
          expect(s).to.deep.equal(expected)
        }
        expect(ranked).to.be.greaterThan(300)
      })
    }
  })

  describe('state export / restore with smoothing', () => {
    // BBW (export omits `parent`) and MAR (exports trend history in circ[0],
    // restores circ[1]) cannot restore their OWN state, smoothed or not; the
    // wrapper delegates to them, so it inherits that. Pinned, not fixed here.
    for (const name of ['bbw', 'mar']) {
      it(`${name}: own restore already fails without smoothing (pre-existing)`, () => {
        const cfg = SCOPE.find(([n]) => n === name)![1]
        const plain = make(cfg)
        bars.slice(0, 100).forEach((c) => feed(plain, c))
        expect(() => plain.restoreState(plain.exportState())).to.throw()
      })
    }
    for (const [name, cfg] of SCOPE.filter(
      ([n]) => n !== 'bbw' && n !== 'mar',
    )) {
      it(`${name}: restored copy continues identically; preview is side-effect free`, () => {
        const extra = { ...PCT, smoothing: 'tema', smoothingLength: 5 }
        const a = make(cfg, extra)
        const b = make(cfg, extra)
        bars.slice(0, 250).forEach((c) => {
          feed(a, c)
          feed(b, c)
        })
        // preview twice on `a`, then restore a copy of `a` into `c`
        const shaped = (c: Candle) => ({
          open: c.o,
          high: c.h * 1.05,
          low: c.l,
          close: c.c * 1.03,
          volume: c.v,
        })
        const input =
          name === 'rsi'
            ? bars[250].c * 1.03
            : name === 'vo'
              ? bars[250].v * 2
              : shaped(bars[250])
        ;(a as lib.SmoothedIndicator).preview(input)
        const c = make(cfg, extra)
        c.restoreState(a.exportState())
        for (const k of bars.slice(250)) {
          const want = feed(b, k)
          expect(feed(a, k)).to.deep.equal(want)
          expect(feed(c, k)).to.deep.equal(want)
        }
      })
    }
  })

  describe('factory + warm-up', () => {
    it('adds the average run-up to every in-scope warm-up', () => {
      for (const [, cfg] of SCOPE) {
        const base = lib.getWarmupCandles(cfg)
        const w = (extra: Record<string, unknown>) =>
          lib.getWarmupCandles({ ...cfg, ...extra } as IndicatorConfig)
        for (const [, v] of OFF_VARIANTS) expect(w(v)).to.equal(base)
        expect(w({ smoothing: 'ema', smoothingLength: 10 })).to.equal(base + 10)
        expect(w({ smoothing: 'SMA', smoothingLength: 10 })).to.equal(base + 10)
        expect(w({ smoothing: 'wma', smoothingLength: 10 })).to.equal(base + 10)
        expect(w({ smoothing: 'rma', smoothingLength: 10 })).to.equal(base + 10)
        expect(w({ smoothing: 'dema', smoothingLength: 10 })).to.equal(
          base + 20,
        )
        expect(w({ smoothing: 'tema', smoothingLength: 10 })).to.equal(
          base + 30,
        )
        expect(w({ smoothing: 'hma', smoothingLength: 16 })).to.equal(
          base + 16 + 8 + 4,
        )
      }
    })

    it('out-of-scope types ignore the fields', () => {
      const on = { smoothing: 'ema', smoothingLength: 10 }
      const outOfScope: IndicatorConfig[] = [
        { type: IndicatorEnum.atr, interval: 14 },
        { type: IndicatorEnum.bb, interval: 20 },
        { type: IndicatorEnum.kc, interval: 20 },
        {
          type: IndicatorEnum.macd,
          longInterval: 26,
          shortInterval: 12,
          signalInterval: 9,
        },
      ]
      for (const cfg of outOfScope) {
        const ind = make(cfg, on)
        expect(ind).to.not.be.instanceOf(lib.SmoothedIndicator)
        expect(
          lib.getWarmupCandles({ ...cfg, ...on } as IndicatorConfig),
        ).to.equal(lib.getWarmupCandles(cfg))
      }
    })

    it('SMOOTHABLE_INDICATORS is the in-scope list', () => {
      expect([...lib.SMOOTHABLE_INDICATORS].sort()).to.deep.equal(
        SCOPE.map(([, c]) => c.type).sort(),
      )
    })

    it('resolveSmoothing normalises stored settings', () => {
      expect(lib.resolveSmoothing(' Tema ', 3)).to.deep.equal({
        type: 'tema',
        length: 3,
      })
      expect(lib.resolveSmoothing('ema', '12')).to.deep.equal({
        type: 'ema',
        length: 12,
      })
      expect(lib.resolveSmoothing('ema', 7.9)).to.deep.equal({
        type: 'ema',
        length: 7,
      })
      expect(lib.resolveSmoothing('ema', 1000)).to.deep.equal({
        type: 'ema',
        length: 1000,
      })
      for (const [t, l] of [
        [undefined, 14],
        ['none', 14],
        ['vwma', 14],
        ['price', 14],
        ['ema', 0],
        ['ema', 0.5],
        ['ema', NaN],
        ['ema', 1001],
        ['ema', null],
      ] as [string | undefined, number | null][]) {
        expect(lib.resolveSmoothing(t, l), `${t}/${l}`).to.equal(null)
      }
    })

    it('warm-up covers the first smoothed value (RSI)', () => {
      for (const type of Object.keys(maRef)) {
        for (const len of [2, 9, 21]) {
          const sm = make(SCOPE[0][1], {
            smoothing: type,
            smoothingLength: len,
          })
          const firstAt = bars.findIndex((c) => feed(sm, c) !== null)
          expect(firstAt + 1, `${type}(${len})`).to.be.at.most(
            lib.getWarmupCandles({
              type: IndicatorEnum.rsi,
              interval: 14,
              smoothing: type,
              smoothingLength: len,
            }) + 1,
          )
        }
      }
    })

    it('unwrapSmoothed returns the oscillator class', () => {
      const sm = make(SCOPE[1][1], { smoothing: 'ema', smoothingLength: 3 })
      expect(lib.unwrapSmoothed(sm)).to.be.instanceOf(lib.CCI)
      const plain = make(SCOPE[1][1])
      expect(lib.unwrapSmoothed(plain)).to.equal(plain)
    })
  })
})
