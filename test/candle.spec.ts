import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  CANDLE_HA_SETTLE,
  CANDLE_STREAK_CAP,
  CANDLE_WARMUP,
  Candle,
  CandleColorEnum,
  CandleSourceEnum,
  CandleTriggerEnum,
  candleCondition,
  resolveCandleCount,
} from '../src/Candle/Candle'
import { CandleResult } from '../src/types/result'
import { OHLC } from '../src/types/candles'
import { createIndicator, feedCandle, getWarmupCandles } from '../src/factory'
import { IndicatorEnum } from '../src/types/config'

function walk(count: number, seed = 97531): OHLC[] {
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out: OHLC[] = []
  let c = 100
  for (let i = 0; i < count; i++) {
    const o = c
    c = Math.max(1, c * (1 + (rand() - 0.5) * 0.04))
    out.push({
      open: o,
      high: Math.max(o, c) * (1 + rand() * 0.01),
      low: Math.min(o, c) * (1 - rand() * 0.01),
      close: c,
    })
  }
  return out
}

/** TradingView's Heikin Ashi, array-based. */
function heikinAshi(candles: OHLC[]): OHLC[] {
  const out: OHLC[] = []
  candles.forEach((c, i) => {
    const close = (c.open + c.high + c.low + c.close) / 4
    const open =
      i === 0
        ? (c.open + c.close) / 2
        : (out[i - 1].open + out[i - 1].close) / 2
    out.push({
      open,
      close,
      high: Math.max(c.high, open, close),
      low: Math.min(c.low, open, close),
    })
  })
  return out
}

const ohlc = (o: number, h: number, l: number, c: number): OHLC => ({
  open: o,
  high: h,
  low: l,
  close: c,
})

describe('Candle', () => {
  describe('regular source', () => {
    it('reads the colour and a signed streak; a doji breaks it', () => {
      const ind = new Candle(CandleSourceEnum.regular)
      const seq = [
        ohlc(10, 11, 9, 10.5), // green
        ohlc(10.5, 12, 10, 11), // green
        ohlc(11, 12, 10.5, 11.5), // green
        ohlc(11.5, 12, 11, 11.5), // doji
        ohlc(11.5, 11.6, 10, 10.2), // red
        ohlc(10.2, 10.3, 9, 9.5), // red
        ohlc(9.5, 10, 9.4, 9.9), // green
      ]
      const r = seq.map((c) => ind.next(c) as CandleResult)
      expect(r.map((x) => x.color)).to.deep.equal([1, 1, 1, 0, -1, -1, 1])
      expect(r.map((x) => x.streak)).to.deep.equal([1, 2, 3, 0, -1, -2, 1])
      expect(r[4]).to.deep.include({
        open: 11.5,
        high: 11.6,
        low: 10,
        close: 10.2,
      })
    })

    it('emits from the first candle', () => {
      expect(new Candle('regular').next(ohlc(1, 2, 0.5, 1.5))).to.not.equal(
        null,
      )
    })

    it('caps the streak', () => {
      const ind = new Candle(CandleSourceEnum.regular)
      let r: CandleResult | null = null
      for (let i = 0; i < CANDLE_STREAK_CAP + 50; i++) {
        r = ind.next(ohlc(10, 12, 9, 11))
      }
      expect(r!.streak).to.equal(CANDLE_STREAK_CAP)
      for (let i = 0; i < CANDLE_STREAK_CAP + 5; i++) {
        r = ind.next(ohlc(11, 12, 9, 10))
      }
      expect(r!.streak).to.equal(-CANDLE_STREAK_CAP)
    })
  })

  describe('Heikin Ashi source', () => {
    it('is null until the seed has settled', () => {
      const ind = new Candle()
      expect(ind.source).to.equal(CandleSourceEnum.heikinAshi)
      const candles = walk(40)
      candles.forEach((c, i) => {
        const r = ind.next(c)
        if (i < CANDLE_HA_SETTLE - 1) expect(r, `bar ${i}`).to.equal(null)
        else expect(r, `bar ${i}`).to.not.equal(null)
      })
    })

    it('computes the hand-traced Heikin Ashi candles, colours and streak', () => {
      const ind = new Candle(CandleSourceEnum.heikinAshi)
      // 29 flat candles: haOpen = haClose = 10 throughout
      for (let i = 0; i < CANDLE_HA_SETTLE - 1; i++) {
        expect(ind.next(ohlc(10, 11, 9, 10))).to.equal(null)
      }
      // haClose = 42/4 = 10.5, haOpen = (10+10)/2 = 10 → green
      expect(ind.next(ohlc(10, 12, 9, 11))).to.deep.equal({
        color: 1,
        streak: 1,
        open: 10,
        high: 12,
        low: 9,
        close: 10.5,
      })
      // haClose = 48/4 = 12, haOpen = (10+10.5)/2 = 10.25 → green
      expect(ind.next(ohlc(11, 14, 10, 13))).to.deep.equal({
        color: 1,
        streak: 2,
        open: 10.25,
        high: 14,
        low: 10,
        close: 12,
      })
      // a red regular candle, still green in Heikin Ashi:
      // haClose = 49/4 = 12.25, haOpen = (10.25+12)/2 = 11.125
      expect(ind.next(ohlc(13, 13.5, 11, 11.5))).to.deep.equal({
        color: 1,
        streak: 3,
        open: 11.125,
        high: 13.5,
        low: 11,
        close: 12.25,
      })
      // haClose = 40/4 = 10, haOpen = (11.125+12.25)/2 = 11.6875 → red
      expect(ind.next(ohlc(12, 12, 8, 8))).to.deep.equal({
        color: -1,
        streak: -1,
        open: 11.6875,
        high: 12,
        low: 8,
        close: 10,
      })
      // haOpen = (11.6875+10)/2 = 10.84375 = haClose → doji
      expect(ind.next(ohlc(10.84375, 11, 10.6875, 10.84375))).to.deep.equal({
        color: 0,
        streak: 0,
        open: 10.84375,
        high: 11,
        low: 10.6875,
        close: 10.84375,
      })
    })

    it('matches an array-based Heikin Ashi on a random walk', () => {
      const candles = walk(600)
      const ha = heikinAshi(candles)
      const ind = new Candle(CandleSourceEnum.heikinAshi)
      let streak = 0
      candles.forEach((c, i) => {
        const r = ind.next(c)
        if (i < CANDLE_HA_SETTLE - 1) return
        const h = ha[i]
        const color = h.close > h.open ? 1 : h.close < h.open ? -1 : 0
        streak =
          color === 0 ? 0 : Math.sign(streak) === color ? streak + color : color
        expect(r).to.deep.equal({ color, streak, ...h })
      })
    })

    it('no longer depends on where the history starts once settled', () => {
      const candles = walk(300)
      const a = new Candle()
      const b = new Candle()
      const ra = candles.map((c) => a.next(c))
      const rb = candles.slice(100).map((c) => b.next(c))
      for (let i = CANDLE_HA_SETTLE - 1; i < rb.length; i++) {
        const x = ra[i + 100]!
        const y = rb[i]!
        expect(y.color).to.equal(x.color)
        expect(y.open).to.be.closeTo(x.open, 1e-6)
      }
    })
  })

  it('continues identically after exportState / restoreState', () => {
    for (const source of [
      CandleSourceEnum.regular,
      CandleSourceEnum.heikinAshi,
    ]) {
      const candles = walk(400, 4242)
      const whole = new Candle(source)
      const expected = candles.map((c) => whole.next(c))
      const first = new Candle(source)
      candles.slice(0, 173).forEach((c) => first.next(c))
      const second = new Candle(source)
      second.restoreState(first.exportState())
      const rest = candles.slice(173).map((c) => second.next(c))
      expect(rest).to.deep.equal(expected.slice(173))
    }
  })

  it('preview has no side effect', () => {
    const ind = new Candle()
    const candles = walk(60)
    candles.slice(0, 50).forEach((c) => ind.next(c))
    const peek = ind.preview(candles[50])
    expect(ind.next(candles[50])).to.deep.equal(peek)
  })

  it('is built, warmed up and fed through the factory', () => {
    const ha = createIndicator({ type: IndicatorEnum.candle })
    expect(ha).to.be.instanceOf(Candle)
    expect(ha.source).to.equal(CandleSourceEnum.heikinAshi)
    const reg = createIndicator({
      type: IndicatorEnum.candle,
      source: CandleSourceEnum.regular,
    })
    expect(reg.source).to.equal(CandleSourceEnum.regular)
    expect(getWarmupCandles({ type: IndicatorEnum.candle })).to.equal(81)
    expect(CANDLE_WARMUP).to.equal(81)
    expect(
      getWarmupCandles({ type: IndicatorEnum.candle, source: 'regular' }),
    ).to.equal(81)
    const direct = new Candle()
    for (const c of walk(100)) {
      feedCandle(ha, { o: c.open, h: c.high, l: c.low, c: c.close, v: 1 })
      direct.next(c)
    }
    expect(ha.result).to.not.equal(null)
    expect(ha.result).to.deep.equal(direct.result)
  })
})

describe('candleCondition', () => {
  const r = (color: number, streak: number): CandleResult => ({
    color,
    streak,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
  })

  it('streak: green needs streak >= N, red streak <= -N', () => {
    const s = { color: 'green', count: 3, trigger: 'streak' }
    expect(candleCondition(r(1, 2), null, s)).to.equal(false)
    expect(candleCondition(r(1, 3), null, s)).to.equal(true)
    expect(candleCondition(r(1, 7), null, s)).to.equal(true)
    expect(candleCondition(r(-1, -3), null, s)).to.equal(false)
    const red = { color: CandleColorEnum.red, count: 2 }
    expect(candleCondition(r(-1, -1), null, red)).to.equal(false)
    expect(candleCondition(r(-1, -2), null, red)).to.equal(true)
    expect(candleCondition(r(-1, -9), null, red)).to.equal(true)
    expect(candleCondition(r(1, 9), null, red)).to.equal(false)
  })

  it('start: only on the N-th candle of the run', () => {
    const s = { color: 'green', count: 3, trigger: CandleTriggerEnum.start }
    expect(candleCondition(r(1, 2), null, s)).to.equal(false)
    expect(candleCondition(r(1, 3), null, s)).to.equal(true)
    expect(candleCondition(r(1, 4), null, s)).to.equal(false)
    const red = { color: 'red', count: 1, trigger: 'start' }
    expect(candleCondition(r(-1, -1), null, red)).to.equal(true)
    expect(candleCondition(r(-1, -2), null, red)).to.equal(false)
  })

  it('defaults to green, count 1, streak', () => {
    expect(candleCondition(r(1, 1), null)).to.equal(true)
    expect(candleCondition(r(-1, -1), null)).to.equal(false)
    expect(
      candleCondition(r(1, 1), null, { color: null, trigger: null }),
    ).to.equal(true)
  })

  it('treats a missing / invalid count as 1', () => {
    for (const count of [undefined, null, '', 'abc', 0, -3, NaN]) {
      expect(resolveCandleCount(count as any), String(count)).to.equal(1)
      expect(candleCondition(r(1, 1), null, { count: count as any })).to.equal(
        true,
      )
    }
    expect(resolveCandleCount('4')).to.equal(4)
    expect(resolveCandleCount(2.7)).to.equal(2)
  })

  it('never fires on a doji', () => {
    for (const color of ['green', 'red']) {
      for (const trigger of ['streak', 'start']) {
        expect(
          candleCondition(r(0, 0), null, { color, trigger, count: 1 }),
        ).to.equal(false)
      }
    }
  })

  it('is false for a missing result, nulls, or unknown settings', () => {
    expect(candleCondition(null, null)).to.equal(false)
    expect(candleCondition(undefined, null)).to.equal(false)
    expect(candleCondition({ color: null as any, streak: 3 }, null)).to.equal(
      false,
    )
    expect(candleCondition({ color: 1, streak: null as any }, null)).to.equal(
      false,
    )
    expect(candleCondition(r(1, 3), null, { color: 'blue' })).to.equal(false)
    expect(candleCondition(r(1, 3), null, { trigger: 'whenever' })).to.equal(
      false,
    )
  })

  it('reads the newest bar only and tolerates JSON round trips', () => {
    const json = JSON.parse(JSON.stringify(r(1, 2)))
    expect(candleCondition(json, r(-1, -5), { count: 2 })).to.equal(true)
  })
})
