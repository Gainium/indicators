import { describe, it } from 'mocha'
import { expect } from 'chai'
import { MAR } from '../src/MAR/MAR'
import { OHLCV } from '../src/types/candles'

/**
 * MAR's VWMA legs read the candle (close and volume). Bot settings send the
 * average type in lower case ('vwma'), and the VWMA leg was only fed the
 * candle for 'VWMA', so with 'vwma' it got a bare number and never produced
 * a value.
 */

const candles: OHLCV[] = Array.from({ length: 60 }, (_, i) => {
  const close = 100 + 10 * Math.sin(i / 5)
  return {
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 1000 + 100 * (i % 7),
  } as OHLCV
})

const run = (ma1: string, ma2: string) => {
  const mar = new MAR(ma1, 10, ma2, 20)
  return candles.map((c) => mar.next(c)?.value ?? null)
}

describe('MAR with VWMA legs', () => {
  for (const [ma1, ma2] of [
    ['vwma', 'price'],
    ['ema', 'vwma'],
    ['vwma', 'vwma'],
  ]) {
    it(`${ma1} vs ${ma2} gives the values of its upper-case spelling`, () => {
      const lower = run(ma1, ma2)
      expect(
        lower.filter((v) => v !== null && Number.isFinite(v)).length,
      ).to.be.greaterThan(30)
      expect(lower).to.deep.equal(
        run(ma1.toUpperCase(), ma2 === 'price' ? ma2 : ma2.toUpperCase()),
      )
    })
  }
})

describe('VWMA warm-up', () => {
  it('gives its first value on its length-th candle, like SMA', async () => {
    const { VWMA } = await import('../src/VWMA/VWMA')
    const vwma = new VWMA(10)
    const out = candles.map((c) => vwma.next(c))
    expect(out.slice(0, 9).every((v) => v === null)).to.equal(true)
    const window = candles.slice(0, 10)
    const expected =
      window.reduce((a, c) => a + c.close * c.volume, 0) /
      window.reduce((a, c) => a + c.volume, 0)
    expect(out[9]).to.be.closeTo(expected, 1e-9)
  })
})
