import { describe, it } from 'mocha'
import { expect } from 'chai'
import { OTELevels, oteLevelPrice } from '../src/OTE/OTE'
import { OTEResult } from '../src/types/result'
import { createIndicator, feedCandle, getWarmupCandles } from '../src/factory'
import { IndicatorEnum } from '../src/types/config'

// Closes walking linearly between turning points, 5 bars per segment; each
// candle spans close ± 0.5.
const zigzag = (points: number[]): number[] => {
  const closes: number[] = []
  for (let i = 0; i < points.length - 1; i++) {
    for (let k = 0; k < 5; k++) {
      closes.push(points[i] + ((points[i + 1] - points[i]) * k) / 5)
    }
  }
  closes.push(points[points.length - 1])
  return closes
}
const candle = (c: number) => ({
  open: c,
  high: c + 0.5,
  low: c - 0.5,
  close: c,
})
const POINTS = [100, 90, 110, 95, 120, 100, 115, 98, 125]

const run = (ind: OTELevels, closes: number[]) =>
  closes.map((c) => ind.next(candle(c)) as OTEResult)

const leg = (r: OTEResult) => [r.direction, r.low, r.high]

describe('OTELevels', () => {
  const results = run(new OTELevels(3, 1), zigzag(POINTS))

  it('reports no leg until both sides have a usable swing', () => {
    for (let i = 0; i <= 20; i++) {
      expect(results[i].direction, `bar ${i}`).to.be.NaN
    }
  })

  it('builds a bullish leg from the latest qualifying swing low to a new swing high', () => {
    // swing high 120.5 prints at bar 20 and confirms at bar 21
    expect(leg(results[21])).to.deep.equal([1, 94.5, 120.5])
  })

  it('builds a bearish leg from the swing high down to a new swing low', () => {
    expect(leg(results[26])).to.deep.equal([-1, 99.5, 120.5])
    expect(leg(results[31])).to.deep.equal([1, 99.5, 115.5])
  })

  it('re-anchors when price trades through the latest leg', () => {
    // bar 35 trades below 99.5: the leg is rebuilt from swing low 94.5 up to
    // the OLDEST qualifying high after it (120.5)
    expect(leg(results[35])).to.deep.equal([1, 94.5, 120.5])
    expect(leg(results[36])).to.deep.equal([-1, 97.5, 115.5])
    // bar 39 trades above 115.5: rebuilt down from 120.5
    expect(leg(results[39])).to.deep.equal([-1, 97.5, 120.5])
  })

  it('drops every leg once price clears all remaining swing highs', () => {
    expect(results[40].direction).to.be.NaN
    expect(results[40].price).to.equal(125)
  })

  it('ignores legs shorter than the minimum size', () => {
    // every leg in the zigzag is under 30 %
    const big = run(new OTELevels(3, 30), zigzag(POINTS))
    expect(big.every((r) => isNaN(r.direction))).to.equal(true)
  })

  it('continues identically after exportState / restoreState', () => {
    const closes = zigzag(POINTS)
    const a = new OTELevels(3, 1)
    const b = new OTELevels(3, 1)
    run(a, closes.slice(0, 33))
    run(b, closes.slice(0, 33))
    const state = a.exportState()
    run(a, [50, 60, 70]) // diverge, then roll back
    a.restoreState(state)
    expect(run(a, closes.slice(33))).to.deep.equal(run(b, closes.slice(33)))
  })
})

describe('oteLevelPrice', () => {
  const bull = { high: 120, low: 100, direction: 1 }
  const bear = { high: 120, low: 100, direction: -1 }

  it('measures retracement from the end of the leg', () => {
    expect(oteLevelPrice(bull, 0)).to.equal(120)
    expect(oteLevelPrice(bull, 1)).to.equal(100)
    expect(oteLevelPrice(bull, 0.705)).to.be.closeTo(105.9, 1e-9)
    expect(oteLevelPrice(bear, 0)).to.equal(100)
    expect(oteLevelPrice(bear, 0.705)).to.be.closeTo(114.1, 1e-9)
    expect(oteLevelPrice(bull, 0.5)).to.equal(oteLevelPrice(bear, 0.5))
  })

  it('is NaN without a leg', () => {
    expect(oteLevelPrice({ high: NaN, low: NaN, direction: NaN }, 0.5)).to.be
      .NaN
  })
})

describe('OTE factory registration', () => {
  const config = {
    type: IndicatorEnum.ote,
    oteLeftBars: 3,
    oteMinLegSize: 1,
  } as const

  it('creates, warms up and feeds the indicator', () => {
    const ind = createIndicator(config)
    expect(ind).to.be.instanceOf(OTELevels)
    expect(getWarmupCandles(config)).to.equal(1000)
    for (const c of zigzag(POINTS).slice(0, 22)) {
      feedCandle(ind, { o: c, h: c + 0.5, l: c - 0.5, c, v: 1 })
    }
    expect(leg(ind.result)).to.deep.equal([1, 94.5, 120.5])
  })
})
