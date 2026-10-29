import { describe, it } from 'mocha'
import { expect } from 'chai'
import { ADX, dmiCondition } from '../src/ADX/ADX'
import { lineCondition } from '../src/util/condition'
import { ADXResult, PercentileResult } from '../src/types/result'
import { HLC } from '../src/types/candles'
import { SmoothedIndicator } from '../src/Smoothing/Smoothing'
import { createIndicator, feedCandle, getWarmupCandles } from '../src/factory'
import { IndicatorEnum } from '../src/types/config'

function walk(count: number, seed = 864213579): HLC[] {
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out: HLC[] = []
  let c = 100
  for (let i = 0; i < count; i++) {
    const o = c
    c = Math.max(1, c * (1 + (rand() - 0.5) * 0.04))
    out.push({
      high: Math.max(o, c) * (1 + rand() * 0.01),
      low: Math.min(o, c) * (1 - rand() * 0.01),
      close: c,
    })
  }
  return out
}

/** TradingView's ta.dmi DI lines: rma (SMA-seeded) of +DM, −DM and TR. */
function referenceDI(candles: HLC[], len: number) {
  const rma = () => {
    const seed: number[] = []
    let v = NaN
    return (x: number) => {
      if (isNaN(v)) {
        seed.push(x)
        if (seed.length === len) v = seed.reduce((a, b) => a + b, 0) / len
        return v
      }
      v = v + (x - v) / len
      return v
    }
  }
  const [tr, p, m] = [rma(), rma(), rma()]
  return candles.map((c, i) => {
    if (i === 0) return null
    const prev = candles[i - 1]
    const up = c.high - prev.high
    const down = prev.low - c.low
    const t = tr(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close),
      ),
    )
    const pdm = p(up > down && up > 0 ? up : 0)
    const mdm = m(down > up && down > 0 ? down : 0)
    return isNaN(t) ? null : { pdi: (100 * pdm) / t, mdi: (100 * mdm) / t }
  })
}

describe('ADX DMI mode', () => {
  const candles = walk(500)

  it('without dmi the result is exactly the old one (keys and values)', () => {
    for (const pct of [false, true]) {
      const plain = new ADX(14, pct, 50, 80)
      const dmi = new ADX(14, pct, 50, 80, true)
      for (const c of candles) {
        const a = plain.next(c)
        const b = dmi.next(c) as ADXResult | null
        if (a === null) {
          expect(b).to.equal(null)
          continue
        }
        expect(Object.keys(a)).to.deep.equal(
          'percentile' in a ? ['value', 'percentile'] : ['value'],
        )
        expect(b!.value).to.equal(a.value)
        expect(b!.percentile).to.equal(a.percentile)
      }
    }
  })

  it('reports +DI / −DI equal to TradingView ta.dmi, from the first ADX bar', () => {
    const adx = new ADX(14, false, 0, 0, true)
    const want = referenceDI(candles, 14)
    let compared = 0
    candles.forEach((c, i) => {
      const r = adx.next(c) as ADXResult | null
      if (r === null) return
      expect(Object.keys(r)).to.deep.equal(['value', 'pdi', 'mdi'])
      expect(r.pdi).to.be.closeTo(want[i]!.pdi, 1e-9)
      expect(r.mdi).to.be.closeTo(want[i]!.mdi, 1e-9)
      expect(r.pdi).to.equal(adx.pdi)
      expect(r.mdi).to.equal(adx.mdi)
      compared++
    })
    expect(compared).to.be.greaterThan(450)
  })

  it('smoothing passes the DI lines through unsmoothed, only in DMI mode', () => {
    const cfg = {
      type: IndicatorEnum.adx,
      interval: 14,
      smoothing: 'ema',
      smoothingLength: 5,
    } as const
    const sm = createIndicator({ ...cfg, dmi: true })
    const old = createIndicator(cfg)
    const raw = new ADX(14, false, 0, 0, true)
    expect(sm).to.be.instanceOf(SmoothedIndicator)
    for (const c of candles) {
      const r = raw.next(c) as ADXResult | null
      feedCandle(sm, { o: c.close, h: c.high, l: c.low, c: c.close, v: 1 })
      feedCandle(old, { o: c.close, h: c.high, l: c.low, c: c.close, v: 1 })
      if (sm.result) {
        expect(sm.result.pdi).to.equal(r!.pdi)
        expect(sm.result.mdi).to.equal(r!.mdi)
        expect(Object.keys(old.result)).to.deep.equal(['value', 'raw'])
      }
    }
    expect(sm.result).to.not.equal(null)
  })

  it('export / restore round trip continues identically', () => {
    const whole = new ADX(14, true, 30, 50, true)
    const expected = candles.map((c) => whole.next(c))
    // Cuts inside the first 2 × 14 bars are left out: WSMA does not export
    // the SMA it seeds from, so ADX (with or without DMI mode) cannot resume
    // there. Pre-existing, unrelated to the DI lines.
    for (const cut of [1, 40, 200]) {
      const first = new ADX(14, true, 30, 50, true)
      const got: Array<PercentileResult | null> = []
      candles.slice(0, cut).forEach((c) => got.push(first.next(c)))
      const second = new ADX(14, true, 30, 50, true)
      second.restoreState(first.exportState())
      candles.slice(cut).forEach((c) => got.push(second.next(c)))
      expect(got, `cut ${cut}`).to.deep.equal(expected)
    }
  })

  it('factory: dmi: true builds DMI mode with the ADX warm-up', () => {
    const cfg = { type: IndicatorEnum.adx, interval: 14, dmi: true } as const
    const ind = createIndicator(cfg)
    expect(ind).to.be.instanceOf(ADX)
    expect(ind.withDI).to.equal(true)
    expect(
      createIndicator({ type: IndicatorEnum.adx, interval: 14 }).withDI,
    ).to.equal(false)
    expect(getWarmupCandles(cfg)).to.equal(
      getWarmupCandles({ type: IndicatorEnum.adx, interval: 14 }),
    )
    const direct = new ADX(14, false, 0, 0, true)
    for (const c of candles) {
      feedCandle(ind, { o: c.close, h: c.high, l: c.low, c: c.close, v: 1 })
      direct.next(c)
    }
    expect(ind.result).to.deep.equal(direct.result)
    expect(ind.result.pdi).to.be.a('number')
  })
})

describe('dmiCondition', () => {
  const r = (pdi: number, mdi: number): ADXResult => ({ value: 25, pdi, mdi })

  it('+DI crosses above / below −DI; touching counts on the previous bar', () => {
    expect(dmiCondition(r(21, 20), r(19, 20))).to.equal(true) // default cu
    expect(dmiCondition(r(21, 20), r(20, 20), { condition: 'cu' })).to.equal(
      true,
    )
    expect(dmiCondition(r(20, 20), r(19, 20), { condition: 'cu' })).to.equal(
      false,
    )
    expect(dmiCondition(r(21, 20), r(22, 20), { condition: 'cu' })).to.equal(
      false,
    )
    expect(dmiCondition(r(19, 20), r(21, 20), { condition: 'cd' })).to.equal(
      true,
    )
    expect(dmiCondition(r(19, 20), r(20, 20), { condition: 'cd' })).to.equal(
      true,
    )
    // both lines move
    expect(dmiCondition(r(18, 15), r(17, 19), { condition: 'cu' })).to.equal(
      true,
    )
    expect(dmiCondition(r(21, 20), null, { condition: 'cu' })).to.equal(false)
  })

  it('+DI above / below −DI on the newest bar', () => {
    expect(dmiCondition(r(21, 20), null, { condition: 'gt' })).to.equal(true)
    expect(dmiCondition(r(21, 20), null, { condition: 'lt' })).to.equal(false)
    expect(dmiCondition(r(19, 20), null, { condition: 'lt' })).to.equal(true)
    expect(dmiCondition(r(20, 20), null, { condition: 'gt' })).to.equal(false)
  })

  it('an ADX without DMI mode, JSON nulls and missing bars are false', () => {
    const plain = { value: 30 }
    expect(dmiCondition(plain, plain, { condition: 'cu' })).to.equal(false)
    expect(dmiCondition(plain, null, { condition: 'gt' })).to.equal(false)
    const nul = { value: 30, pdi: null, mdi: null } as unknown as ADXResult
    expect(dmiCondition(nul, r(19, 20))).to.equal(false)
    expect(dmiCondition(null, null)).to.equal(false)
  })
})

describe('lineCondition', () => {
  it('is the engine comparison: cu / cd touching on the previous bar', () => {
    // cu: last above value now, prev at or below prevValue
    expect(lineCondition('cu', 2, 1, 1, 1)).to.equal(true)
    expect(lineCondition('cu', 2, 1, 0, 1)).to.equal(true)
    expect(lineCondition('cu', 1, 1, 0, 1)).to.equal(false)
    // cd: last below value now, prev at or above prevValue
    expect(lineCondition('cd', 0, 1, 1, 1)).to.equal(true)
    expect(lineCondition('cd', 1, 1, 2, 1)).to.equal(false)
    // epsilon: 1e-12 apart counts as touching
    expect(lineCondition('cu', 2, 1, 1 + 1e-12, 1)).to.equal(true)
    expect(lineCondition('gt', 1 + 1e-12, 1)).to.equal(false)
    expect(lineCondition('gt', 2, 1)).to.equal(true)
    expect(lineCondition('lt', 0, 1)).to.equal(true)
    expect(lineCondition('bw', 0, 1)).to.equal(false)
    expect(lineCondition(undefined, 2, 1, 0, 1)).to.equal(false)
    expect(lineCondition('cu', 2, 1)).to.equal(false)
    expect(lineCondition('gt', NaN, 1)).to.equal(false)
  })
})
