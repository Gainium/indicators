import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  Squeeze,
  SqzMomentumEnum,
  SqzSignalEnum,
  linregEnd,
  squeezeCondition,
  squeezeWarmup,
} from '../src/SQZ/Squeeze'
import { SqueezeResult } from '../src/types/result'
import { HLC } from '../src/types/candles'
import { createIndicator, feedCandle, getWarmupCandles } from '../src/factory'
import { IndicatorEnum } from '../src/types/config'

function walk(count: number, seed = 8642): HLC[] {
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out: HLC[] = []
  let c = 100
  for (let i = 0; i < count; i++) {
    const o = c
    // alternate calm and volatile stretches so squeezes form and fire
    const vol = Math.floor(i / 40) % 2 === 0 ? 0.004 : 0.04
    c = Math.max(1, c * (1 + (rand() - 0.5) * vol))
    out.push({
      high: Math.max(o, c) * (1 + rand() * vol * 0.25),
      low: Math.min(o, c) * (1 - rand() * vol * 0.25),
      close: c,
    })
  }
  return out
}

/**
 * LazyBear's Squeeze Momentum v2, transcribed from the Pine source with
 * plain arrays (useTrueRange = true). `na` = null.
 */
function pineSqueeze(
  bars: HLC[],
  length: number,
  mult: number,
  lengthKC: number,
  multKC: number,
): Array<SqueezeResult | null> {
  const close = bars.map((b) => b.close)
  const high = bars.map((b) => b.high)
  const low = bars.map((b) => b.low)
  const sma = (src: Array<number | null>, len: number, i: number) => {
    if (i < len - 1) return null
    let s = 0
    for (let k = i - len + 1; k <= i; k++) {
      const v = src[k]
      if (v === null) return null
      s += v
    }
    return s / len
  }
  const stdev = (src: number[], len: number, i: number) => {
    const m = sma(src, len, i)
    if (m === null) return null
    let s = 0
    for (let k = i - len + 1; k <= i; k++) s += (src[k] - m) ** 2
    return Math.sqrt(s / len)
  }
  const highest = (src: number[], len: number, i: number) =>
    i < len - 1 ? null : Math.max(...src.slice(i - len + 1, i + 1))
  const lowest = (src: number[], len: number, i: number) =>
    i < len - 1 ? null : Math.min(...src.slice(i - len + 1, i + 1))
  // ta.tr(true): high - low on the first bar
  const tr = bars.map((b, i) =>
    i === 0
      ? b.high - b.low
      : Math.max(
          b.high - b.low,
          Math.abs(b.high - close[i - 1]),
          Math.abs(b.low - close[i - 1]),
        ),
  )
  // Pine linreg: for i = 0 .. len-1, x = len-1-i for src[i] (src[0] newest)
  const linreg = (src: Array<number | null>, len: number, i: number) => {
    if (i < len - 1) return null
    const ys: number[] = []
    for (let k = i - len + 1; k <= i; k++) {
      const v = src[k]
      if (v === null) return null
      ys.push(v)
    }
    const xbar = (len - 1) / 2
    const ybar = ys.reduce((a, b) => a + b, 0) / len
    let num = 0
    let den = 0
    ys.forEach((y, x) => {
      num += (x - xbar) * (y - ybar)
      den += (x - xbar) ** 2
    })
    const slope = den === 0 ? 0 : num / den
    return ybar + slope * (len - 1 - xbar)
  }
  const val: Array<number | null> = bars.map((_, i) => {
    const hh = highest(high, lengthKC, i)
    const ll = lowest(low, lengthKC, i)
    const m = sma(close, lengthKC, i)
    if (hh === null || ll === null || m === null) return null
    return close[i] - ((hh + ll) / 2 + m) / 2
  })
  return bars.map((_, i) => {
    const basis = sma(close, length, i)
    const dev0 = stdev(close, length, i)
    const ma = sma(close, lengthKC, i)
    const rangema = sma(tr, lengthKC, i)
    const momentum = linreg(val, lengthKC, i)
    if (
      basis === null ||
      dev0 === null ||
      ma === null ||
      rangema === null ||
      momentum === null
    ) {
      return null
    }
    const dev = mult * dev0
    const upperBB = basis + dev
    const lowerBB = basis - dev
    const upperKC = ma + rangema * multKC
    const lowerKC = ma - rangema * multKC
    const sqzOn = lowerBB > lowerKC && upperBB < upperKC
    const sqzOff = lowerBB < lowerKC && upperBB > upperKC
    return { momentum, squeeze: sqzOn ? 1 : sqzOff ? -1 : 0 }
  })
}

describe('linregEnd', () => {
  it('is the end point of the least-squares line', () => {
    // x = 0,1,2; y = 1,2,4 → slope 1.5, mean 7/3 → end = 7/3 + 1.5 = 23/6
    expect(linregEnd([1, 2, 4])).to.be.closeTo(23 / 6, 1e-12)
    // a straight line is reproduced exactly
    expect(linregEnd([3, 5, 7, 9])).to.be.closeTo(9, 1e-12)
    expect(linregEnd([5])).to.equal(5)
    expect(linregEnd([])).to.be.NaN
    // y = 2, 0, 4, 3, 6: x̄ = 2, ȳ = 3, Sxy = (-2)(-1)+(-1)(-3)+0+(1)(0)+(2)(3) = 11,
    // Sxx = 10 → slope 1.1, end = 3 + 1.1 × 2 = 5.2
    expect(linregEnd([2, 0, 4, 3, 6])).to.be.closeTo(5.2, 1e-12)
  })
})

describe('Squeeze', () => {
  it('hand-traced: squeeze on, then fired with positive rising momentum', () => {
    // length 2, bbMult 2, kcLength 2, kcMult 1
    const sqz = new Squeeze(2, 2, 2, 1)
    const r = [
      { high: 11, low: 9, close: 10 }, // TR 2 (first bar: high - low)
      { high: 11, low: 9, close: 10 }, // TR 2; val = 10 - (10 + 10)/2 = 0
      { high: 10.5, low: 9.5, close: 10.2 }, // TR 1; val = 10.2 - (10 + 10.1)/2 = 0.15
      { high: 14, low: 10, close: 13.8 }, // TR 4; val = 13.8 - (11.75 + 12)/2 = 1.925
    ].map((c) => sqz.next(c))
    expect(r[0]).to.equal(null)
    expect(r[1]).to.equal(null) // only one momentum value yet
    // bar 2: BB 10.1 ± 2 × 0.1 = [9.9, 10.3] inside KC 10.1 ± 1.5 = [8.6, 11.6]
    expect(r[2]!.squeeze).to.equal(1)
    expect(r[2]!.momentum).to.be.closeTo(0.15, 1e-12) // linreg([0, 0.15])
    // bar 3: BB 12 ± 2 × 1.8 = [8.4, 15.6] outside KC 12 ± 2.5 = [9.5, 14.5]
    expect(r[3]!.squeeze).to.equal(-1)
    expect(r[3]!.momentum).to.be.closeTo(1.925, 1e-12)
    expect(squeezeCondition(r[3], r[2])).to.equal(true) // fired + positive
    expect(
      squeezeCondition(r[3], r[2], { signal: 'fired', momentum: 'rising' }),
    ).to.equal(true)
    expect(
      squeezeCondition(r[3], r[2], { signal: 'fired', momentum: 'negative' }),
    ).to.equal(false)
    expect(squeezeCondition(r[2], r[1])).to.equal(false) // no prev result
  })

  it('falls back to the defaults for invalid settings', () => {
    const s = new Squeeze(0, -1, NaN, 0)
    expect([s.length, s.bbMult, s.kcLength, s.kcMult]).to.deep.equal([
      20, 1.5, 20, 1.5,
    ])
    const t = new Squeeze(7.9, 2.5, 3.2, 0.5)
    expect([t.length, t.bbMult, t.kcLength, t.kcMult]).to.deep.equal([
      7, 2.5, 3, 0.5,
    ])
  })

  it('matches an independent Pine transcription on a 500-bar random walk', () => {
    const bars = walk(500)
    for (const [len, mult, kcLen, kcMult] of [
      [20, 2, 20, 1.5],
      [20, 1.5, 20, 1.5],
      [10, 2, 30, 1.5],
      [30, 1.5, 10, 1],
      [5, 2.5, 7, 2],
    ]) {
      const ref = pineSqueeze(bars, len, mult, kcLen, kcMult)
      const ind = new Squeeze(len, mult, kcLen, kcMult)
      const got = bars.map((b) => ind.next(b))
      const tag = `${len}/${mult}/${kcLen}/${kcMult}`
      let states = new Set<number>()
      got.forEach((g, i) => {
        const e = ref[i]
        if (e === null) {
          expect(g, `${tag} bar ${i}`).to.equal(null)
          return
        }
        expect(g, `${tag} bar ${i}`).to.not.equal(null)
        expect(g!.squeeze, `${tag} bar ${i}`).to.equal(e.squeeze)
        expect(g!.momentum, `${tag} bar ${i}`).to.be.closeTo(
          e.momentum,
          1e-9 * Math.max(1, Math.abs(e.momentum)),
        )
        states.add(e.squeeze)
      })
      // first value at bar max(length, 2 × kcLength − 1) − 1
      const first = got.findIndex((g) => g !== null)
      expect(first, tag).to.equal(Math.max(len, 2 * kcLen - 1) - 1)
      if (tag === '10/2/30/1.5') {
        expect([...states].sort(), tag).to.deep.equal([-1, 0, 1])
      }
      states = new Set()
    }
  })

  it('continues identically after exportState / restoreState', () => {
    const bars = walk(500, 777)
    const whole = new Squeeze(20, 2, 20, 1.5)
    const expected = bars.map((b) => whole.next(b))
    for (const split of [5, 30, 250]) {
      const a = new Squeeze(20, 2, 20, 1.5)
      bars.slice(0, split).forEach((b) => a.next(b))
      const b = new Squeeze(20, 2, 20, 1.5)
      b.restoreState(a.exportState())
      const rest = bars.slice(split).map((x) => b.next(x))
      expect(rest, `split ${split}`).to.deep.equal(expected.slice(split))
    }
  })

  it('preview has no side effect', () => {
    const bars = walk(100)
    const s = new Squeeze()
    bars.slice(0, 80).forEach((b) => s.next(b))
    const peek = s.preview(bars[80])
    expect(s.next(bars[80])).to.deep.equal(peek)
  })

  it('rejects an incomplete state', () => {
    expect(() => new Squeeze().restoreState({ bin: [], circ: [] })).to.throw()
  })

  it('is built, warmed up and fed through the factory', () => {
    const ind = createIndicator({
      type: IndicatorEnum.sqz,
      length: 10,
      bbMult: 1.5,
      kcLength: 30,
      kcMult: 1,
    })
    expect(ind).to.be.instanceOf(Squeeze)
    expect([ind.length, ind.bbMult, ind.kcLength, ind.kcMult]).to.deep.equal([
      10, 1.5, 30, 1,
    ])
    const def = createIndicator({ type: IndicatorEnum.sqz })
    expect([def.length, def.bbMult, def.kcLength, def.kcMult]).to.deep.equal([
      20, 1.5, 20, 1.5,
    ])
    expect(getWarmupCandles({ type: IndicatorEnum.sqz })).to.equal(40)
    expect(
      getWarmupCandles({ type: IndicatorEnum.sqz, length: 10, kcLength: 30 }),
    ).to.equal(60)
    expect(
      getWarmupCandles({ type: IndicatorEnum.sqz, length: 50, kcLength: 20 }),
    ).to.equal(100)
    expect(squeezeWarmup(20, 20)).to.equal(def.warmup)
    const direct = new Squeeze(10, 1.5, 30, 1)
    for (const b of walk(120)) {
      feedCandle(ind, { o: b.close, h: b.high, l: b.low, c: b.close, v: 1 })
      direct.next(b)
    }
    expect(ind.result).to.not.equal(null)
    expect(ind.result).to.deep.equal(direct.result)
  })
})

describe('squeezeCondition', () => {
  const r = (squeeze: number, momentum: number): SqueezeResult => ({
    squeeze,
    momentum,
  })

  it('signal fired: previous bar on, newest bar not on', () => {
    const s = { signal: SqzSignalEnum.fired, momentum: SqzMomentumEnum.any }
    expect(squeezeCondition(r(-1, 1), r(1, 1), s)).to.equal(true)
    expect(squeezeCondition(r(0, 1), r(1, 1), s)).to.equal(true)
    expect(squeezeCondition(r(1, 1), r(1, 1), s)).to.equal(false)
    expect(squeezeCondition(r(-1, 1), r(0, 1), s)).to.equal(false)
    expect(squeezeCondition(r(-1, 1), r(-1, 1), s)).to.equal(false)
    expect(squeezeCondition(r(-1, 1), null, s)).to.equal(false)
  })

  it('signal on / off / any', () => {
    expect(squeezeCondition(r(1, 1), null, { signal: 'on' })).to.equal(true)
    expect(squeezeCondition(r(0, 1), null, { signal: 'on' })).to.equal(false)
    expect(squeezeCondition(r(-1, 1), null, { signal: 'off' })).to.equal(true)
    expect(squeezeCondition(r(0, 1), null, { signal: 'off' })).to.equal(false)
    expect(squeezeCondition(r(0, 1), null, { signal: 'any' })).to.equal(true)
    expect(squeezeCondition(r(0, -1), null, { signal: 'any' })).to.equal(false)
  })

  it('momentum positive / negative read the newest bar', () => {
    const on = { signal: 'on' }
    expect(
      squeezeCondition(r(1, 0.1), null, { ...on, momentum: 'positive' }),
    ).to.equal(true)
    expect(
      squeezeCondition(r(1, 0), null, { ...on, momentum: 'positive' }),
    ).to.equal(false)
    expect(
      squeezeCondition(r(1, -0.1), null, { ...on, momentum: 'negative' }),
    ).to.equal(true)
    expect(
      squeezeCondition(r(1, 0), null, { ...on, momentum: 'negative' }),
    ).to.equal(false)
  })

  it('momentum rising / falling compare with the previous bar', () => {
    const on = { signal: 'on' }
    expect(
      squeezeCondition(r(1, 2), r(1, 1), { ...on, momentum: 'rising' }),
    ).to.equal(true)
    expect(
      squeezeCondition(r(1, 1), r(1, 1), { ...on, momentum: 'rising' }),
    ).to.equal(false)
    expect(
      squeezeCondition(r(1, 1), r(1, 2), { ...on, momentum: 'falling' }),
    ).to.equal(true)
    expect(
      squeezeCondition(r(1, 2), r(1, 2), { ...on, momentum: 'falling' }),
    ).to.equal(false)
    expect(
      squeezeCondition(r(1, 2), null, { ...on, momentum: 'rising' }),
    ).to.equal(false)
    expect(
      squeezeCondition(r(1, 1), null, { ...on, momentum: 'falling' }),
    ).to.equal(false)
  })

  it('momentum crossUp / crossDown through zero', () => {
    const any = { signal: 'any' }
    expect(
      squeezeCondition(r(0, 1), r(0, -1), { ...any, momentum: 'crossUp' }),
    ).to.equal(true)
    expect(
      squeezeCondition(r(0, 1), r(0, 0), { ...any, momentum: 'crossUp' }),
    ).to.equal(true)
    expect(
      squeezeCondition(r(0, 1), r(0, 0.5), { ...any, momentum: 'crossUp' }),
    ).to.equal(false)
    expect(
      squeezeCondition(r(0, 0), r(0, -1), { ...any, momentum: 'crossUp' }),
    ).to.equal(false)
    expect(
      squeezeCondition(r(0, -1), r(0, 1), { ...any, momentum: 'crossDown' }),
    ).to.equal(true)
    expect(
      squeezeCondition(r(0, -1), r(0, 0), { ...any, momentum: 'crossDown' }),
    ).to.equal(true)
    expect(
      squeezeCondition(r(0, -1), r(0, -0.5), { ...any, momentum: 'crossDown' }),
    ).to.equal(false)
    expect(
      squeezeCondition(r(0, 0), r(0, 1), { ...any, momentum: 'crossDown' }),
    ).to.equal(false)
    expect(
      squeezeCondition(r(0, 1), null, { ...any, momentum: 'crossUp' }),
    ).to.equal(false)
    expect(
      squeezeCondition(r(0, -1), null, { ...any, momentum: 'crossDown' }),
    ).to.equal(false)
  })

  it('both any never fires; signal AND momentum must both hold', () => {
    expect(
      squeezeCondition(r(1, 1), r(1, 1), { signal: 'any', momentum: 'any' }),
    ).to.equal(false)
    expect(
      squeezeCondition(r(1, 1), null, { signal: 'on', momentum: 'any' }),
    ).to.equal(true)
    expect(squeezeCondition(r(-1, -1), r(1, 1))).to.equal(false) // fired but negative
    expect(squeezeCondition(r(-1, 1), r(1, 1))).to.equal(true) // defaults fired + positive
  })

  it('is false for a missing result, nulls, NaN or unknown settings', () => {
    expect(squeezeCondition(null, r(1, 1))).to.equal(false)
    expect(squeezeCondition(undefined, undefined)).to.equal(false)
    expect(squeezeCondition(r(-1, NaN), r(1, 1))).to.equal(false)
    expect(squeezeCondition(r(1, 1), null, { signal: 'maybe' })).to.equal(false)
    expect(
      squeezeCondition(r(1, 1), null, { signal: 'on', momentum: 'sideways' }),
    ).to.equal(false)
    const last = JSON.parse(JSON.stringify(r(-1, NaN)))
    expect(last.momentum).to.equal(null)
    expect(squeezeCondition(last, r(1, 1), { momentum: 'negative' })).to.equal(
      false,
    )
    expect(
      squeezeCondition(r(-1, 1), { squeeze: null as any, momentum: 1 }),
    ).to.equal(false)
    expect(
      squeezeCondition({ squeeze: null as any, momentum: 1 }, r(1, 1)),
    ).to.equal(false)
    expect(
      squeezeCondition(
        r(1, 1),
        { squeeze: 1, momentum: null as any },
        { signal: 'on', momentum: 'rising' },
      ),
    ).to.equal(false)
    expect(
      squeezeCondition(
        JSON.parse(JSON.stringify(r(-1, 2))),
        JSON.parse(JSON.stringify(r(1, 1))),
        { momentum: 'rising' },
      ),
    ).to.equal(true)
  })
})
