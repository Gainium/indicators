import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  MATrendFilter,
  trendFilterCode,
  trendFilterCondition,
} from '../src/MATrend/MATrend'
import { MATrendResult } from '../src/types/result'
import { MAR } from '../src/MAR/MAR'
import { EMA } from '../src/EMA/EMA'
import { SMA } from '../src/SMA/SMA'
import { VWMA } from '../src/VWMA/VWMA'
import { McGinley } from '../src/McGinley/McGinley'
import { createIndicator, feedCandle, getWarmupCandles } from '../src/factory'
import { FeedCandle } from '../src/factory/feed'
import {
  IndicatorConfig,
  IndicatorEnum,
  MAEnum,
  TrendFilterOperatorEnum,
} from '../src/types/config'

function walk(count: number, seed = 112358132): FeedCandle[] {
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out: FeedCandle[] = []
  let c = 100
  for (let i = 0; i < count; i++) {
    const o = c
    // alternating trends so every trend code shows up
    const drift =
      Math.floor(i / 60) % 3 === 0 ? 0.004 : i % 180 < 120 ? -0.004 : 0
    c = Math.max(1, c * (1 + drift + (rand() - 0.5) * 0.01))
    out.push({
      o,
      h: Math.max(o, c) * (1 + rand() * 0.005),
      l: Math.min(o, c) * (1 - rand() * 0.005),
      c,
      v: 100 + Math.floor(rand() * 900),
    })
  }
  return out
}

const candles = walk(700)
const ALL_TYPES = [
  MAEnum.ema,
  MAEnum.sma,
  MAEnum.wma,
  MAEnum.hma,
  MAEnum.vwma,
  MAEnum.dema,
  MAEnum.tema,
  MAEnum.rma,
  MAEnum.mcginley,
]

/** Feeds every candle; returns the indicator's result after each. */
const series = (ind: unknown) =>
  candles.map((c) => {
    feedCandle(ind, c)
    return (ind as { result: unknown }).result
  })

/** MAR's trend arithmetic, written out independently. */
function code(cur: number, old: number, type: string, diff: number): number {
  if (type === 'lower') return (old - cur) / old >= diff ? 1 : 0
  if (type === 'higher') return (cur - old) / cur >= diff ? 2 : 0
  const down = (old - cur) / old
  const up = (cur - old) / cur
  return down < diff && up < diff ? 3 : 0
}

describe('Moving Average trend filter', () => {
  it('without the trend filter the factory result is unchanged', () => {
    for (const maType of ALL_TYPES) {
      for (const extra of [
        {},
        { trendFilter: false, trendFilterLookback: 5, trendFilterValue: 1 },
        { trendFilter: undefined },
      ]) {
        const cfg = {
          type: IndicatorEnum.ma,
          maType,
          interval: 20,
          ...extra,
        } as IndicatorConfig
        const ind = createIndicator(cfg)
        expect(ind).to.not.be.instanceOf(MATrendFilter)
        expect(ind.constructor.name).to.equal(
          createIndicator({ type: IndicatorEnum.ma, maType, interval: 20 })
            .constructor.name,
        )
        expect(getWarmupCandles(cfg)).to.equal(
          getWarmupCandles({ type: IndicatorEnum.ma, maType, interval: 20 }),
        )
        const plain = createIndicator({
          type: IndicatorEnum.ma,
          maType,
          interval: 20,
        })
        expect(series(ind)).to.deep.equal(series(plain))
      }
    }
    expect(
      createIndicator({
        type: IndicatorEnum.ma,
        maType: MAEnum.price,
        interval: 20,
        trendFilter: true,
      }),
    ).to.equal(null)
  })

  it('value is the plain MA bit for bit, trend is MAR-coded, every MA type', () => {
    for (const maType of ALL_TYPES) {
      for (const type of ['lower', 'higher', 'between'] as const) {
        const lookback = 7
        const pct = 0.5
        const ind = createIndicator({
          type: IndicatorEnum.ma,
          maType,
          interval: 20,
          trendFilter: true,
          trendFilterLookback: lookback,
          trendFilterValue: pct,
          trendFilterType: type as TrendFilterOperatorEnum,
        })
        expect(ind).to.be.instanceOf(MATrendFilter)
        const plain = series(
          createIndicator({ type: IndicatorEnum.ma, maType, interval: 20 }),
        ) as Array<number | null>
        const got = series(ind) as Array<MATrendResult | null>
        const values: number[] = []
        const seen = new Set<number>()
        got.forEach((r, i) => {
          if (plain[i] === null) {
            expect(r, `${maType} ${i}`).to.equal(null)
            return
          }
          expect(r!.value).to.equal(plain[i])
          values.push(plain[i]!)
          if (values.length <= lookback) {
            expect(r!.trend, `${maType} ${type} ${i}`).to.equal(undefined)
            return
          }
          const want = code(
            values[values.length - 1],
            values[values.length - 1 - lookback],
            type,
            pct / 100,
          )
          expect(r!.trend, `${maType} ${type} ${i}`).to.equal(want)
          seen.add(want)
        })
        // the filter both passes and fails on this walk
        expect(seen.size, `${maType} ${type}`).to.equal(2)
      }
    }
  })

  it('trendFilterCode is MAR’s trend arithmetic', () => {
    // MAR in price mode: its line is close / MA; feed the same through the
    // code on that ratio series and compare MAR's own trend output.
    for (const type of ['lower', 'higher', 'between']) {
      const mar = new MAR(
        'sma',
        10,
        'price',
        0,
        false,
        0,
        0,
        true,
        6,
        0.3,
        type,
      )
      const ma = new SMA(10)
      const ratios: number[] = []
      for (const c of candles) {
        const r = mar.next({
          open: c.o,
          high: c.h,
          low: c.l,
          close: c.c,
          volume: c.v,
        })
        const m = ma.next(c.c)
        if (m === null) continue
        ratios.push(c.c / m)
        if (ratios.length > 6) {
          expect(r!.trend).to.equal(
            trendFilterCode(
              ratios[ratios.length - 1],
              ratios[ratios.length - 7],
              type,
              0.003,
            ),
          )
        }
      }
    }
  })

  it('incomplete filter settings: a value, never a trend (as MAR)', () => {
    for (const extra of [
      { trendFilterValue: 1, trendFilterType: 'lower' },
      { trendFilterLookback: 0, trendFilterValue: 1, trendFilterType: 'lower' },
      { trendFilterLookback: 5, trendFilterType: 'lower' },
      { trendFilterLookback: 5, trendFilterValue: 1 },
    ]) {
      const ind = createIndicator({
        type: IndicatorEnum.ma,
        maType: MAEnum.ema,
        interval: 10,
        trendFilter: true,
        ...extra,
      } as IndicatorConfig)
      expect(ind).to.be.instanceOf(MATrendFilter)
      const got = series(ind) as Array<MATrendResult | null>
      expect(got[got.length - 1]!.value).to.be.a('number')
      expect(got.every((r) => r === null || r.trend === undefined)).to.equal(
        true,
      )
    }
  })

  it('VWMA gets the candle, the others the close', () => {
    const ind = new MATrendFilter(new VWMA(5), 3, 1, 'higher')
    const vw = new VWMA(5)
    const mg = new MATrendFilter(new McGinley(5), 3, 1, 'higher')
    const ref = new McGinley(5)
    for (const c of candles.slice(0, 50)) {
      const r = ind.next({
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
        volume: c.v,
      })
      const w = vw.next({
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
        volume: c.v,
      })
      expect(r?.value ?? null).to.equal(w)
      const g = mg.next({
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
        volume: c.v,
      })
      expect(g?.value ?? null).to.equal(ref.next(c.c))
    }
  })

  it('warm-up adds the lookback only when the filter is on', () => {
    const base = { type: IndicatorEnum.ma, maType: MAEnum.tema, interval: 20 }
    expect(getWarmupCandles(base as IndicatorConfig)).to.equal(360)
    expect(
      getWarmupCandles({
        ...base,
        trendFilter: true,
        trendFilterLookback: 15,
      } as IndicatorConfig),
    ).to.equal(375)
  })

  it('export / restore round trip continues identically (MA child included)', () => {
    const make = () => new MATrendFilter(new EMA(10), 6, 0.3, 'between')
    const input = candles.map((c) => ({
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      volume: c.v,
    }))
    const whole = make()
    const expected = input.map((c) => whole.next(c))
    for (const cut of [1, 12, 14, 300]) {
      const first = make()
      const got: Array<MATrendResult | null> = []
      input.slice(0, cut).forEach((c) => got.push(first.next(c)))
      const second = make()
      second.restoreState(first.exportState())
      input.slice(cut).forEach((c) => got.push(second.next(c)))
      expect(got, `cut ${cut}`).to.deep.equal(expected)
    }
  })
})

describe('trendFilterCondition', () => {
  it('matches the filter type to the trend code', () => {
    expect(
      trendFilterCondition({ trend: 1 }, { trendFilterType: 'lower' }),
    ).to.equal(true)
    expect(
      trendFilterCondition({ trend: 2 }, { trendFilterType: 'higher' }),
    ).to.equal(true)
    expect(
      trendFilterCondition({ trend: 3 }, { trendFilterType: 'between' }),
    ).to.equal(true)
    expect(
      trendFilterCondition({ trend: 0 }, { trendFilterType: 'lower' }),
    ).to.equal(false)
    expect(
      trendFilterCondition({ trend: 2 }, { trendFilterType: 'lower' }),
    ).to.equal(false)
    expect(
      trendFilterCondition({ trend: 1 }, { trendFilterType: 'nope' }),
    ).to.equal(false)
    expect(trendFilterCondition({ trend: 1 }, {})).to.equal(false)
  })

  it('tolerates missing trends, JSON nulls and missing bars', () => {
    expect(trendFilterCondition({}, { trendFilterType: 'lower' })).to.equal(
      false,
    )
    expect(
      trendFilterCondition({ trend: null }, { trendFilterType: 'between' }),
    ).to.equal(false)
    expect(trendFilterCondition(null, { trendFilterType: 'lower' })).to.equal(
      false,
    )
    // reads MAR results too
    expect(
      trendFilterCondition({ value: 1.01, trend: 2 } as never, {
        trendFilterType: TrendFilterOperatorEnum.higher,
      }),
    ).to.equal(true)
  })
})
