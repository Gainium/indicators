import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  VWAP,
  VWAPAnchorEnum,
  VWAPLineEnum,
  VWAP_WARMUP,
  resolveVWAPAnchor,
  vwapCondition,
  vwapLineValue,
  vwapPeriodStart,
} from '../src/VWAP/VWAP'
import { VWAPResult } from '../src/types/result'
import { OHLCVT } from '../src/types/candles'
import { createIndicator, feedCandle, getWarmupCandles } from '../src/factory'
import { IndicatorEnum } from '../src/types/config'

const at = (iso: string) => Date.parse(iso)
const HOUR = 3_600_000
const bar = (
  iso: string,
  high: number,
  low: number,
  close: number,
  volume: number,
): OHLCVT => ({ open: close, high, low, close, volume, time: at(iso) })

/** A deterministic 15m OHLCV walk starting at `start` — no fixtures. */
function walk(count: number, start: number, seed = 13579): OHLCVT[] {
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out: OHLCVT[] = []
  let c = 30000
  for (let i = 0; i < count; i++) {
    const o = c
    c = c * (1 + (rand() - 0.5) * 0.01)
    out.push({
      open: o,
      high: Math.max(o, c) * (1 + rand() * 0.002),
      low: Math.min(o, c) * (1 - rand() * 0.002),
      close: c,
      volume: rand() < 0.05 ? 0 : rand() * 50,
      time: start + i * 15 * 60_000,
    })
  }
  return out
}

/** TradingView's ta.vwap, written out: sums over the period, textbook variance. */
function reference(
  candles: OHLCVT[],
  anchor: VWAPAnchorEnum,
): Array<{ vwap: number; stdev: number } | null> {
  let start = NaN
  let first = true
  let full = false
  let sv = 0
  let svs = 0
  let svss = 0
  return candles.map((c) => {
    const ps = vwapPeriodStart(c.time, anchor)
    if (ps !== start) {
      full = !first || c.time === ps
      start = ps
      sv = svs = svss = 0
    }
    first = false
    const src = (c.high + c.low + c.close) / 3
    sv += c.volume
    svs += c.volume * src
    svss += c.volume * src * src
    if (!full) return null
    const vwap = svs / sv
    return { vwap, stdev: Math.sqrt(Math.max(0, svss / sv - vwap * vwap)) }
  })
}

describe('VWAP', () => {
  it('period starts in UTC: day, Monday week, month', () => {
    const t = at('2026-10-29T13:45:00Z') // a Thursday
    expect(vwapPeriodStart(t, 'day')).to.equal(at('2026-10-29T00:00:00Z'))
    expect(vwapPeriodStart(t, 'week')).to.equal(at('2026-10-26T00:00:00Z'))
    expect(vwapPeriodStart(t, 'month')).to.equal(at('2026-10-01T00:00:00Z'))
    // Monday 00:00 starts its own week; Sunday 23:59 is the previous one
    expect(vwapPeriodStart(at('2026-10-26T00:00:00Z'), 'week')).to.equal(
      at('2026-10-26T00:00:00Z'),
    )
    expect(vwapPeriodStart(at('2026-10-25T23:59:00Z'), 'week')).to.equal(
      at('2026-10-19T00:00:00Z'),
    )
    // before the epoch's first Monday, and across a year end
    expect(vwapPeriodStart(at('1970-01-02T00:00:00Z'), 'week')).to.equal(
      at('1969-12-29T00:00:00Z'),
    )
    expect(vwapPeriodStart(at('2026-12-31T23:00:00Z'), 'month')).to.equal(
      at('2026-12-01T00:00:00Z'),
    )
    expect(resolveVWAPAnchor(' Week ')).to.equal(VWAPAnchorEnum.week)
    expect(resolveVWAPAnchor('MONTH')).to.equal(VWAPAnchorEnum.month)
    expect(resolveVWAPAnchor('hour')).to.equal(VWAPAnchorEnum.day)
    expect(resolveVWAPAnchor(undefined)).to.equal(VWAPAnchorEnum.day)
  })

  it('hand-traced: skips the partial first day, then hlc3 by volume', () => {
    const vwap = new VWAP('day', 2)
    const out = [
      bar('2026-10-28T22:00:00Z', 50, 40, 45, 10),
      bar('2026-10-28T23:00:00Z', 50, 40, 45, 10),
      bar('2026-10-29T00:00:00Z', 12, 9, 9, 2), // hlc3 10
      bar('2026-10-29T01:00:00Z', 14, 11, 11, 2), // hlc3 12
      bar('2026-10-29T02:00:00Z', 16, 13, 13, 4), // hlc3 14
    ].map((c) => vwap.next(c))
    expect(out.slice(0, 2)).to.deep.equal([null, null])
    const day = at('2026-10-29T00:00:00Z')
    expect(out[2]).to.deep.equal({
      vwap: 10,
      stdev: 0,
      upper: 10,
      lower: 10,
      price: 9,
      periodStart: day,
    })
    // Σv = 4, Σv·src = 44 → 11; Σv·src² / Σv = 122 → variance 1
    expect(out[3]!.vwap).to.equal(11)
    expect(out[3]!.stdev).to.be.closeTo(1, 1e-12)
    expect(out[3]!.upper).to.be.closeTo(13, 1e-12)
    expect(out[3]!.lower).to.be.closeTo(9, 1e-12)
    // Σv = 8, Σv·src = 100 → 12.5; 1272 / 8 − 156.25 = 2.75
    expect(out[4]!.vwap).to.equal(12.5)
    expect(out[4]!.stdev).to.be.closeTo(Math.sqrt(2.75), 1e-12)
    expect(out[4]!.upper).to.be.closeTo(12.5 + 2 * Math.sqrt(2.75), 1e-12)
    expect(out[4]!.price).to.equal(13)
  })

  it('history starting exactly on the period start counts from its first candle', () => {
    const vwap = new VWAP()
    expect(vwap.next(bar('2026-10-29T00:00:00Z', 12, 9, 9, 2))!.vwap).to.equal(
      10,
    )
    const late = new VWAP()
    expect(late.next(bar('2026-10-29T00:15:00Z', 12, 9, 9, 2))).to.equal(null)
  })

  it('restarts at every anchor boundary', () => {
    for (const anchor of [
      VWAPAnchorEnum.day,
      VWAPAnchorEnum.week,
      VWAPAnchorEnum.month,
    ]) {
      const vwap = new VWAP(anchor)
      // 75 days of 1h candles from a mid-period start
      let start = NaN
      let resets = 0
      for (let i = 0; i < 75 * 24; i++) {
        const t = at('2026-08-14T05:00:00Z') + i * HOUR
        const r = vwap.next({
          open: 1,
          high: 2 + (i % 7),
          low: 1,
          close: 1.5,
          volume: 1 + (i % 3),
          time: t,
        })
        if (!r) continue
        if (r.periodStart !== start) {
          // the first bar of a period is its own VWAP
          expect(r.vwap).to.be.closeTo((3 + (i % 7) + 1.5) / 3, 1e-12)
          expect(r.stdev).to.equal(0)
          start = r.periodStart
          resets++
        }
        expect(r.periodStart).to.equal(vwapPeriodStart(t, anchor))
      }
      expect(resets, anchor).to.equal(
        anchor === 'day' ? 75 : anchor === 'week' ? 11 : 2,
      )
    }
  })

  it('matches the textbook formula (TradingView ta.vwap) on a long walk', () => {
    const candles = walk(3 * 96 * 31, at('2026-07-03T09:30:00Z'))
    for (const anchor of [
      VWAPAnchorEnum.day,
      VWAPAnchorEnum.week,
      VWAPAnchorEnum.month,
    ]) {
      const vwap = new VWAP(anchor, 1.5)
      const want = reference(candles, anchor)
      let compared = 0
      candles.forEach((c, i) => {
        const got = vwap.next(c)
        const w = want[i]
        if (w === null) {
          expect(got, `${anchor} bar ${i}`).to.equal(null)
          return
        }
        if (isNaN(w.vwap)) {
          // no volume yet in this period
          expect(got!.vwap).to.be.NaN
          return
        }
        expect(got!.vwap).to.be.closeTo(w.vwap, w.vwap * 1e-12)
        // the textbook variance cancels ~1e8 against ~1e8: compare to its noise
        expect(got!.stdev).to.be.closeTo(w.stdev, 1e-3)
        expect(got!.upper).to.equal(got!.vwap + 1.5 * got!.stdev)
        expect(got!.lower).to.equal(got!.vwap - 1.5 * got!.stdev)
        compared++
      })
      expect(compared, anchor).to.be.greaterThan(1000)
    }
  })

  it('zero volume: NaN lines until the period has volume', () => {
    const vwap = new VWAP()
    const r = vwap.next(bar('2026-10-29T00:00:00Z', 12, 9, 9, 0))!
    expect(r.vwap).to.be.NaN
    expect(r.stdev).to.be.NaN
    expect(r.upper).to.be.NaN
    expect(r.price).to.equal(9)
    expect(vwap.next(bar('2026-10-29T01:00:00Z', 12, 9, 9, 3))!.vwap).to.equal(
      10,
    )
  })

  it('a candle without a time is not accumulated', () => {
    const vwap = new VWAP()
    expect(
      vwap.next({ ...bar('2026-10-29T00:00:00Z', 1, 1, 1, 1), time: NaN }),
    ).to.equal(null)
    vwap.next(bar('2026-10-29T00:00:00Z', 12, 9, 9, 2))
    const r = vwap.next({
      ...bar('2026-10-29T01:00:00Z', 100, 90, 95, 100),
      time: undefined as unknown as number,
    })!
    expect(r.vwap).to.equal(10)
    expect(r.price).to.equal(95)
    expect(r.periodStart).to.equal(at('2026-10-29T00:00:00Z'))
  })

  it('export / restore round trip continues identically', () => {
    const candles = walk(600, at('2026-10-27T13:00:00Z'))
    const whole = new VWAP('day', 2)
    const expected = candles.map((c) => whole.next(c))
    for (const cut of [1, 30, 44, 300]) {
      const first = new VWAP('day', 2)
      const got: Array<VWAPResult | null> = []
      candles.slice(0, cut).forEach((c) => got.push(first.next(c)))
      const second = new VWAP('day', 2)
      second.restoreState(first.exportState())
      candles.slice(cut).forEach((c) => got.push(second.next(c)))
      expect(got, `cut ${cut}`).to.deep.equal(expected)
    }
  })

  it('is built, warmed up and fed (with t) through the factory', () => {
    const config = { type: IndicatorEnum.vwap } as const
    const ind = createIndicator(config)
    expect(ind).to.be.instanceOf(VWAP)
    expect([ind.anchor, ind.bandMultiplier]).to.deep.equal(['day', 1])
    expect(getWarmupCandles(config)).to.equal(1441)
    expect(
      getWarmupCandles({ type: IndicatorEnum.vwap, vwapAnchor: 'week' }),
    ).to.equal(VWAP_WARMUP.week)
    expect(
      getWarmupCandles({ type: IndicatorEnum.vwap, vwapAnchor: 'month' }),
    ).to.equal(VWAP_WARMUP.month)
    const weekly = createIndicator({
      type: IndicatorEnum.vwap,
      vwapAnchor: VWAPAnchorEnum.week,
      vwapBandMultiplier: 2.5,
    })
    expect([weekly.anchor, weekly.bandMultiplier]).to.deep.equal(['week', 2.5])

    const candles = walk(200, at('2026-10-28T20:00:00Z'))
    const direct = new VWAP()
    const untimed = createIndicator(config)
    for (const c of candles) {
      const fc = { o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }
      feedCandle(ind, { ...fc, t: c.time })
      feedCandle(untimed, fc)
      direct.next(c)
    }
    expect(ind.result).to.not.equal(null)
    expect(ind.result).to.deep.equal(direct.result)
    // no time, no period: never a value
    expect(untimed.result).to.equal(null)
  })
})

describe('vwapCondition', () => {
  const day1 = at('2026-10-29T00:00:00Z')
  const day2 = at('2026-10-30T00:00:00Z')
  const r = (
    price: number,
    vwap: number,
    stdev = 1,
    periodStart = day1,
  ): VWAPResult => ({
    vwap,
    stdev,
    upper: NaN, // never read: bands come from vwap and stdev
    lower: NaN,
    price,
    periodStart,
  })

  it('vwapLineValue: the VWAP or vwap ± multiplier × stdev', () => {
    expect(vwapLineValue(r(0, 100, 2))).to.equal(100)
    expect(vwapLineValue(r(0, 100, 2), 'upper', 1.5)).to.equal(103)
    expect(vwapLineValue(r(0, 100, 2), 'lower', '2')).to.equal(96)
    expect(vwapLineValue(r(0, 100, 2), 'upper', null)).to.equal(102)
    expect(vwapLineValue(r(0, 100, 2), 'nope')).to.be.NaN
    expect(vwapLineValue(null)).to.be.NaN
  })

  it('close above / below a line', () => {
    expect(vwapCondition(r(101, 100), null, { condition: 'gt' })).to.equal(true)
    expect(vwapCondition(r(101, 100), null, { condition: 'lt' })).to.equal(
      false,
    )
    expect(
      vwapCondition(r(101, 100), null, {
        line: VWAPLineEnum.upper,
        bandMultiplier: 2,
        condition: 'lt',
      }),
    ).to.equal(true)
    expect(
      vwapCondition(r(97, 100), null, {
        line: 'lower',
        bandMultiplier: 2,
        condition: 'lt',
      }),
    ).to.equal(true)
  })

  it('crossings within one period; touching counts on the previous bar', () => {
    expect(vwapCondition(r(101, 100), r(99, 100))).to.equal(true) // default cu
    expect(vwapCondition(r(101, 100), r(100, 100))).to.equal(true)
    expect(vwapCondition(r(100, 100), r(99, 100))).to.equal(false)
    expect(
      vwapCondition(r(99, 100), r(101, 100), { condition: 'cd' }),
    ).to.equal(true)
    // crossing the upper band (vwap moved too)
    expect(
      vwapCondition(r(104, 101), r(102, 100), {
        line: 'upper',
        bandMultiplier: 2,
        condition: 'cu',
      }),
    ).to.equal(true)
    expect(
      vwapCondition(r(97, 100), r(99, 100), {
        line: 'lower',
        bandMultiplier: 2,
        condition: 'cd',
      }),
    ).to.equal(true)
  })

  it('a restart at the anchor is not a crossing', () => {
    expect(vwapCondition(r(101, 100, 1, day2), r(99, 100, 1, day1))).to.equal(
      false,
    )
    expect(
      vwapCondition(r(99, 100, 1, day2), r(101, 100, 1, day1), {
        condition: 'cd',
      }),
    ).to.equal(false)
    // gt / lt still read the new period
    expect(
      vwapCondition(r(101, 100, 1, day2), r(99, 100, 1, day1), {
        condition: 'gt',
      }),
    ).to.equal(true)
  })

  it('tolerates JSON nulls and missing bars', () => {
    const nul = {
      vwap: null,
      stdev: null,
      price: 5,
      periodStart: day1,
    } as unknown as VWAPResult
    expect(vwapCondition(nul, r(99, 100), { condition: 'cu' })).to.equal(false)
    expect(vwapCondition(nul, null, { condition: 'gt' })).to.equal(false)
    expect(vwapCondition(r(101, 100), nul, { condition: 'cu' })).to.equal(false)
    expect(vwapCondition(r(101, 100), null, { condition: 'cu' })).to.equal(
      false,
    )
    expect(vwapCondition(null, null)).to.equal(false)
  })
})
