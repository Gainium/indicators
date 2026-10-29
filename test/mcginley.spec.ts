import { describe, it } from 'mocha'
import { expect } from 'chai'
import { McGinley } from '../src/McGinley/McGinley'
import { MAR } from '../src/MAR/MAR'
import { createIndicator } from '../src/factory/create'
import { getWarmupCandles } from '../src/factory/warmup'
import { feedCandle } from '../src/factory/feed'
import { IndicatorEnum, MAEnum } from '../src/types/config'

/**
 * McGinley Dynamic as an MA type (`MAEnum.mcginley`).
 *
 * TradingView's built-in: mg := na(mg[1]) ? ta.ema(src, n)
 *                               : mg[1] + (src - mg[1]) / (n * pow(src / mg[1], 4))
 * ta.ema's first value is the SMA of the first n inputs, so that is the seed.
 */
function reference(values: number[], n: number): number[] {
  const out: number[] = []
  let prev = 0
  for (let i = n - 1; i < values.length; i++) {
    const v = values[i]
    prev =
      i === n - 1
        ? values.slice(0, n).reduce((a, b) => a + b, 0) / n
        : prev + (v - prev) / (n * Math.pow(v / prev, 4))
    out.push(prev)
  }
  return out
}

/** A deterministic random walk — no network, no candle fixtures. */
function walk(count: number): number[] {
  let seed = 975318642
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const values: number[] = []
  let price = 100
  for (let i = 0; i < count; i++) {
    price = Math.max(1, price * (1 + (rand() - 0.49) * 0.04))
    values.push(price)
  }
  return values
}

describe('McGinley Dynamic', () => {
  it('matches the TradingView definition on a random walk', () => {
    const values = walk(800)
    for (const n of [3, 14, 50, 200]) {
      const mg = new McGinley(n)
      const got = values
        .map((v) => mg.next(v))
        .filter((v): v is number => v !== null)
      const expected = reference(values, n)
      expect(got.length, `MG(${n}) length`).to.equal(expected.length)
      got.forEach((g, i) => {
        expect(g, `MG(${n}) #${i}`).to.be.closeTo(expected[i], 1e-9)
      })
    }
  })

  it('first value is the SMA of the first interval inputs', () => {
    const mg = new McGinley(3)
    expect([10, 20, 30].map((v) => mg.next(v))).to.deep.equal([null, null, 20])
    // 20 + (20 - 20) / ... stays put when price sits on the line
    expect(mg.next(20)).to.equal(20)
  })

  it('catches up faster when price falls than when it rises by as much', () => {
    const up = new McGinley(10)
    const down = new McGinley(10)
    for (let i = 0; i < 10; i++) {
      up.next(100)
      down.next(100)
    }
    const upMove = (up.next(110) as number) - 100
    const downMove = 100 - (down.next(90) as number)
    expect(downMove).to.be.greaterThan(upMove)
  })

  it('treats a missing or non-positive input as a gap and starts over', () => {
    const mg = new McGinley(3)
    const out = [10, 10, 10, Number.NaN, 10, 10, 10, 0, 10, 10, 10].map((v) =>
      mg.next(v),
    )
    expect(out.slice(0, 3)).to.deep.equal([null, null, 10])
    expect(out[3]).to.be.NaN
    expect(out.slice(4, 6)).to.deep.equal([null, null])
    expect(out[6]).to.equal(10)
    expect(out[7]).to.be.NaN
    expect(out.slice(8, 10)).to.deep.equal([null, null])
    expect(out[10]).to.equal(10)
  })

  it('carries on the same after an export and restore', () => {
    const values = walk(80)
    for (const cut of [1, 5, 6, 30]) {
      const whole = new McGinley(6)
      const expected = values.map((v) => whole.next(v))
      const first = new McGinley(6)
      const got: Array<number | null> = []
      values.slice(0, cut).forEach((v) => got.push(first.next(v)))
      const second = new McGinley(6)
      second.restoreState(first.exportState())
      values.slice(cut).forEach((v) => got.push(second.next(v)))
      expect(got, `cut ${cut}`).to.deep.equal(expected)
    }
  })

  it('is built, warmed up and fed through the factory as an MA type', () => {
    const config = {
      type: IndicatorEnum.ma,
      maType: MAEnum.mcginley,
      interval: 14,
    } as const
    const indicator = createIndicator(config)
    expect(indicator).to.be.instanceOf(McGinley)
    expect(getWarmupCandles(config)).to.equal(14 + 300)
    const values = walk(40)
    const direct = new McGinley(14)
    for (const close of values) {
      feedCandle(indicator, { o: close, h: close, l: close, c: close, v: 1 })
      direct.next(close)
    }
    expect(indicator.result).to.be.a('number')
    expect(indicator.result).to.equal(direct.result)
  })

  it('works as a Moving Average Ratio leg, in either case', () => {
    const values = walk(120)
    for (const type of ['mcginley', 'MCGINLEY']) {
      const mar = new MAR(type, 10, 'price', 0)
      const mg = new McGinley(10)
      let last: number | null = null
      for (const close of values) {
        const r = mar.next({
          open: close,
          high: close,
          low: close,
          close,
          volume: 1,
        })
        mg.next(close)
        last = r?.value ?? null
      }
      expect(last, type).to.be.closeTo(
        values[values.length - 1] / (mg.result as number),
        1e-12,
      )
    }
  })
})
