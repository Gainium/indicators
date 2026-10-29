import { describe, it } from 'mocha'
import { expect } from 'chai'
import { PC, PCCompareEnum, priceChangeCondition } from '../src/PC/PC'
import { PCResult } from '../src/types/result'
import { OHLC } from '../src/types/candles'
import { createIndicator, feedCandle, getWarmupCandles } from '../src/factory'
import { IndicatorEnum } from '../src/types/config'

function walk(count: number, seed = 4242): OHLC[] {
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out: OHLC[] = []
  let c = 100
  for (let i = 0; i < count; i++) {
    const o = c
    // calm and violent stretches so moves land below, inside and above 2..5 %
    const vol = Math.floor(i / 50) % 2 === 0 ? 0.01 : 0.12
    c = Math.max(1, c * (1 + (rand() - 0.5) * vol))
    out.push({
      open: o,
      high: Math.max(o, c) * (1 + rand() * vol * 0.5),
      low: Math.min(o, c) * (1 - rand() * vol * 0.5),
      close: c,
    })
  }
  return out
}

/** The pre-1.13.0 decision, verbatim from main-app / the backtester. */
function legacyDecision(
  result: { up: boolean; down: boolean },
  pcValue: string | undefined,
): boolean {
  const pcCondition = +(pcValue ?? '5') > 0 ? 'up' : 'down'
  return (
    (pcCondition === 'down' && result.down) ||
    (pcCondition === 'up' && result.up)
  )
}

/** The pre-1.13.0 PC.calculate, verbatim. */
function legacyResult(l: OHLC, upThreshold: number, downThreshold: number) {
  return {
    up: !!(Math.abs((l.high - l.open) / l.open) * 100 > upThreshold ? 1 : 0),
    down: !!(Math.abs((l.open - l.low) / l.open) * 100 > downThreshold ? 1 : 0),
  }
}

const roomThreshold = (pcValue: string | undefined) =>
  Math.abs(+(pcValue ?? '5'))

const series = (bars: OHLC[], pcValue: string | undefined) => {
  const t = roomThreshold(pcValue)
  const pc = new PC(t, t)
  return bars.map((b) => pc.next(b) as PCResult)
}

describe('PC — upPct / downPct', () => {
  it('reports the open→high and open→low move in %, booleans unchanged', () => {
    const pc = new PC(2, 3)
    const r = pc.next({ open: 100, high: 104, low: 97.5, close: 101 })!
    expect(r.upPct).to.be.closeTo(4, 1e-12)
    expect(r.downPct).to.be.closeTo(2.5, 1e-12)
    expect(r.up).to.equal(true)
    expect(r.down).to.equal(false)
  })

  it('booleans are identical to the pre-1.13.0 class on a random walk', () => {
    const bars = walk(2000)
    for (const [u, d] of [
      [2, 2],
      [0, 0],
      [5, 1.5],
      [NaN, NaN],
    ]) {
      const pc = new PC(u, d)
      for (const b of bars) {
        const r = pc.next(b)!
        const old = legacyResult(b, u, d)
        expect(r.up).to.equal(old.up)
        expect(r.down).to.equal(old.down)
        expect(r.upPct).to.be.at.least(0)
        expect(r.downPct).to.be.at.least(0)
      }
    }
  })

  it('factory: room config unchanged, warm-up 1, feedCandle feeds it', () => {
    const cfg = { type: IndicatorEnum.pc, pcUp: 2, pcDown: 2 } as const
    const ind = createIndicator(cfg)
    expect(ind).to.be.instanceOf(PC)
    expect(getWarmupCandles(cfg)).to.equal(1)
    feedCandle(ind, { o: 100, h: 103, l: 99, c: 102, v: 1 })
    const r = ind!.result as PCResult
    expect(r.upPct).to.be.closeTo(3, 1e-12)
    expect(r.downPct).to.be.closeTo(1, 1e-12)
  })
})

describe('priceChangeCondition', () => {
  const r = (upPct: number, downPct: number, t = 2): PCResult => ({
    up: upPct > t,
    down: downPct > t,
    upPct,
    downPct,
  })

  it('compare missing == the pre-1.13.0 decision on every candle (random walk)', () => {
    const bars = walk(3000)
    const values = [
      undefined,
      '5',
      '2',
      '-2',
      '0.5',
      '-0.5',
      '3.25',
      '-7',
      '0',
      '',
      '-0',
      'abc',
    ]
    let fired = 0
    for (const v of values) {
      const results = series(bars, v)
      for (const res of results) {
        const old = legacyDecision(res, v)
        for (const compare of [undefined, null, 'gt', 'unknown']) {
          expect(
            priceChangeCondition(res, { value: v, compare }),
            `value ${v} compare ${compare}`,
          ).to.equal(old)
        }
        // old room data (no pct) → the stored boolean
        expect(
          priceChangeCondition({ up: res.up, down: res.down }, { value: v }),
        ).to.equal(old)
        if (old) fired++
      }
    }
    expect(fired).to.be.greaterThan(1000)
  })

  it('gt / lt / bw on the up move (positive value)', () => {
    const s = (compare: PCCompareEnum, value2?: string) => ({
      value: '2',
      value2,
      compare,
    })
    expect(priceChangeCondition(r(2.5, 0), s(PCCompareEnum.gt))).to.equal(true)
    expect(priceChangeCondition(r(2, 0), s(PCCompareEnum.gt))).to.equal(false)
    expect(priceChangeCondition(r(1.5, 9), s(PCCompareEnum.lt))).to.equal(true)
    expect(priceChangeCondition(r(2, 0), s(PCCompareEnum.lt))).to.equal(false)
    expect(priceChangeCondition(r(3, 0), s(PCCompareEnum.bw, '5'))).to.equal(
      true,
    )
    expect(priceChangeCondition(r(6, 0), s(PCCompareEnum.bw, '5'))).to.equal(
      false,
    )
    // the down move is not read
    expect(priceChangeCondition(r(0, 3), s(PCCompareEnum.bw, '5'))).to.equal(
      false,
    )
  })

  it('gt / lt / bw on the down move (negative value)', () => {
    const s = (compare: PCCompareEnum, value2?: string) => ({
      value: '-2',
      value2,
      compare,
    })
    expect(priceChangeCondition(r(0, 2.5), s(PCCompareEnum.gt))).to.equal(true)
    expect(priceChangeCondition(r(9, 1.5), s(PCCompareEnum.lt))).to.equal(true)
    expect(priceChangeCondition(r(0, 3), s(PCCompareEnum.bw, '-5'))).to.equal(
      true,
    )
    expect(priceChangeCondition(r(3, 0), s(PCCompareEnum.bw, '-5'))).to.equal(
      false,
    )
  })

  it('bw is strict at both bounds and order-free (random walk, every boundary)', () => {
    const bars = walk(3000, 777)
    const pairs: Array<[string, string]> = [
      ['2', '5'],
      ['5', '2'],
      ['-2', '-5'],
      ['-5', '-2'],
      ['0.5', '1'],
    ]
    let inside = 0
    for (const [a, b] of pairs) {
      const res = series(bars, a)
      const lo = Math.min(Math.abs(+a), Math.abs(+b))
      const hi = Math.max(Math.abs(+a), Math.abs(+b))
      for (const x of res) {
        const m = +a > 0 ? x.upPct! : x.downPct!
        const got = priceChangeCondition(x, {
          value: a,
          value2: b,
          compare: PCCompareEnum.bw,
        })
        // invariant: bw never fires outside (lo, hi)
        expect(got).to.equal(m > lo && m < hi)
        if (got) inside++
        // swapping the bounds changes nothing
        expect(
          priceChangeCondition(x, {
            value: b,
            value2: a,
            compare: PCCompareEnum.bw,
          }),
        ).to.equal(got)
      }
      // exactly on a bound → false
      for (const edge of [lo, hi]) {
        const e = +a > 0 ? r(edge, 0) : r(0, edge)
        expect(
          priceChangeCondition(e, {
            value: a,
            value2: b,
            compare: PCCompareEnum.bw,
          }),
        ).to.equal(false)
        // and just inside → true
        const inner = edge === lo ? edge + 1e-9 : edge - 1e-9
        const i = +a > 0 ? r(inner, 0) : r(0, inner)
        expect(
          priceChangeCondition(i, {
            value: a,
            value2: b,
            compare: PCCompareEnum.bw,
          }),
        ).to.equal(true)
      }
    }
    expect(inside).to.be.greaterThan(100)
  })

  it('gt ⊇ bw (same lower bound) and lt ∩ gt = ∅ on a random walk', () => {
    const bars = walk(3000, 99)
    const res = series(bars, '2')
    let gt = 0
    let bw = 0
    let lt = 0
    for (const x of res) {
      const g = priceChangeCondition(x, { value: '2' })
      const l = priceChangeCondition(x, { value: '2', compare: 'lt' })
      const b = priceChangeCondition(x, {
        value: '2',
        value2: '5',
        compare: 'bw',
      })
      if (b) expect(g).to.equal(true)
      expect(g && l).to.equal(false)
      gt += +g
      lt += +l
      bw += +b
    }
    expect(gt).to.be.greaterThan(bw)
    expect(bw).to.be.greaterThan(0)
    expect(lt).to.be.greaterThan(0)
  })

  it('bw with mixed signs, a zero, equal or missing bounds → false', () => {
    const x = r(3, 3)
    const bw = (value: string | undefined, value2: string | undefined) =>
      priceChangeCondition(x, { value, value2, compare: PCCompareEnum.bw })
    expect(bw('2', '-5')).to.equal(false)
    expect(bw('-2', '5')).to.equal(false)
    expect(bw('0', '5')).to.equal(false)
    expect(bw('2', '0')).to.equal(false)
    expect(bw('3', '3')).to.equal(false)
    expect(bw('2', undefined)).to.equal(false)
    expect(bw('2', '')).to.equal(false)
    expect(bw('2', 'x')).to.equal(false)
    // value missing = '5' (legacy default) → (3, 5) with value2 3
    expect(bw(undefined, '2')).to.equal(true)
    // numbers are accepted too
    expect(
      priceChangeCondition(x, { value: 2, value2: 5, compare: 'bw' }),
    ).to.equal(true)
  })

  it('lt / bw need the pct fields; null / missing result → false', () => {
    const legacy = { up: true, down: false }
    expect(
      priceChangeCondition(legacy, { value: '2', compare: PCCompareEnum.lt }),
    ).to.equal(false)
    expect(
      priceChangeCondition(legacy, {
        value: '2',
        value2: '5',
        compare: PCCompareEnum.bw,
      }),
    ).to.equal(false)
    // JSON turned NaN / Infinity into null
    const nulled = { up: true, down: false, upPct: null, downPct: null }
    expect(
      priceChangeCondition(nulled as unknown as PCResult, { value: '2' }),
    ).to.equal(true)
    expect(
      priceChangeCondition(nulled as unknown as PCResult, {
        value: '2',
        compare: 'lt',
      }),
    ).to.equal(false)
    expect(priceChangeCondition(null, { value: '2' })).to.equal(false)
    expect(priceChangeCondition(undefined)).to.equal(false)
  })
})
