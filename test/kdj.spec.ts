import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  KDJ,
  KDJ_SEED,
  kdjCondition,
  kdjSettleBars,
  KDJLineEnum,
  KDJZoneEnum,
} from '../src/KDJ/KDJ'
import { KDJResult } from '../src/types/result'
import { HLC } from '../src/types/candles'
import { createIndicator, feedCandle, getWarmupCandles } from '../src/factory'
import { IndicatorEnum } from '../src/types/config'

/** A deterministic HLC walk — no network, no candle fixtures. */
function walk(count: number, seed = 246813579): HLC[] {
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

/**
 * The TradingView script, line by line ("KDJ Indicator"):
 *   bcwsma(s,l,m) => _bcwsma = (m*s+(l-m)*nz(_bcwsma[1]))/l
 *   RSV = 100*((c-l)/(h-l)); pK = bcwsma(RSV, sig, 1); pD = bcwsma(pK, sig, 1)
 *   pJ = 3*pK - 2*pD
 * `seed` is the value nz() gives the first bar (0 in the script).
 */
function reference(
  candles: HLC[],
  n: number,
  ks: number,
  ds: number,
  seed: number,
): Array<KDJResult | null> {
  let k = seed
  let d = seed
  return candles.map((c, i) => {
    if (i < n - 1) return null
    const window = candles.slice(i - n + 1, i + 1)
    const h = Math.max(...window.map((x) => x.high))
    const l = Math.min(...window.map((x) => x.low))
    const rsv = (100 * (c.close - l)) / (h - l)
    k = (rsv + (ks - 1) * k) / ks
    d = (k + (ds - 1) * d) / ds
    return { k, d, j: 3 * k - 2 * d }
  })
}

const flat = (p: number): HLC => ({ high: p, low: p, close: p })

describe('KDJ', () => {
  it('settles the seed in 55 updates for 3/3 (63 candles for 9,3,3)', () => {
    expect(kdjSettleBars(3, 3)).to.equal(55)
    expect(kdjSettleBars(1, 1)).to.equal(1)
    expect(new KDJ().warmup).to.equal(63)
  })

  it('hand-traced with no smoothing: K = RSV, D = K, J = K', () => {
    const kdj = new KDJ(3, 1, 1)
    const out = [
      { high: 10, low: 8, close: 9 },
      { high: 12, low: 9, close: 11 },
      // window 8..12, RSV = 100 * (10 - 8) / 4 = 50
      { high: 11, low: 9, close: 10 },
      // window 9..13, RSV = 100 * (13 - 9) / 4 = 100
      { high: 13, low: 10, close: 13 },
      // window 9..13, RSV = 100 * (9.5 - 9) / 4 = 12.5
      { high: 12, low: 9.5, close: 9.5 },
    ].map((c) => kdj.next(c))
    expect(out.slice(0, 2)).to.deep.equal([null, null])
    expect(out.slice(2)).to.deep.equal([
      { k: 50, d: 50, j: 50 },
      { k: 100, d: 100, j: 100 },
      { k: 12.5, d: 12.5, j: 12.5 },
    ])
  })

  it('hand-traced smoothing from the 50 seed (3/3, before it settles)', () => {
    const kdj = new KDJ(1, 3, 3)
    // n = 1: RSV = 100 * (close - low) / (high - low)
    kdj.next({ high: 10, low: 0, close: 10 }) // RSV 100
    const s = kdj.exportState().parent!.bin[0]
    // K = (100 + 2 * 50) / 3, D = (K + 2 * 50) / 3
    const k = (100 + 2 * KDJ_SEED) / 3
    expect(s[1]).to.equal(k)
    expect(s[2]).to.equal((k + 2 * KDJ_SEED) / 3)
  })

  it('matches the TradingView script (0 seed) to 1e-6 from its first value', () => {
    const candles = walk(800)
    for (const [n, ks, ds] of [
      [9, 3, 3],
      [14, 3, 3],
      [9, 5, 3],
      [5, 2, 4],
    ]) {
      const kdj = new KDJ(n, ks, ds)
      const want = reference(candles, n, ks, ds, 0)
      let compared = 0
      candles.forEach((c, i) => {
        const got = kdj.next(c)
        if (i < kdj.warmup - 1) {
          expect(got, `${n},${ks},${ds} bar ${i}`).to.equal(null)
          return
        }
        expect(got, `${n},${ks},${ds} bar ${i}`).to.not.equal(null)
        const w = want[i] as KDJResult
        expect(Math.abs(got!.k - w.k)).to.be.lessThan(1e-6)
        expect(Math.abs(got!.d - w.d)).to.be.lessThan(1e-6)
        expect(Math.abs(got!.j - w.j)).to.be.lessThan(1e-6)
        compared++
      })
      expect(compared).to.equal(800 - kdj.warmup + 1)
    }
  })

  it('equals the formula exactly with the same 50 seed', () => {
    const candles = walk(300)
    const kdj = new KDJ()
    const want = reference(candles, 9, 3, 3, 50)
    candles.forEach((c, i) => {
      const got = kdj.next(c)
      if (got) {
        expect(got.k).to.be.closeTo(want[i]!.k, 1e-12)
        expect(got.d).to.be.closeTo(want[i]!.d, 1e-12)
        expect(got.j).to.equal(3 * got.k - 2 * got.d)
      }
    })
  })

  it('J leaves 0..100', () => {
    const kdj = new KDJ()
    const js = walk(800).map((c) => kdj.next(c)?.j ?? 50)
    expect(Math.max(...js)).to.be.greaterThan(100)
    expect(Math.min(...js)).to.be.lessThan(0)
  })

  it('a flat range keeps the previous RSV (50 when there is none)', () => {
    const fresh = new KDJ(3, 1, 1)
    expect([1, 2, 3].map(() => fresh.next(flat(5)))[2]).to.deep.equal({
      k: 50,
      d: 50,
      j: 50,
    })
    const kdj = new KDJ(2, 1, 1)
    kdj.next({ high: 10, low: 8, close: 9 })
    // window 8..10, RSV = 100
    expect(kdj.next({ high: 10, low: 9, close: 10 })!.k).to.equal(100)
    kdj.next(flat(10)) // window 9..10, RSV = 100
    // window 10..10: flat, RSV stays 100, no NaN
    expect(kdj.next(flat(10))).to.deep.equal({ k: 100, d: 100, j: 100 })
    // range again: window 10..11, RSV = 0
    expect(kdj.next({ high: 11, low: 10, close: 10 })!.k).to.equal(0)
  })

  it('export / restore round trip continues identically', () => {
    const candles = walk(200)
    const whole = new KDJ()
    const expected = candles.map((c) => whole.next(c))
    for (const cut of [1, 5, 40, 63, 120]) {
      const first = new KDJ()
      const got: Array<KDJResult | null> = []
      candles.slice(0, cut).forEach((c) => got.push(first.next(c)))
      const second = new KDJ()
      second.restoreState(first.exportState())
      candles.slice(cut).forEach((c) => got.push(second.next(c)))
      expect(got, `cut ${cut}`).to.deep.equal(expected)
    }
  })

  it('preview does not move the state', () => {
    const candles = walk(100)
    const kdj = new KDJ()
    candles.slice(0, 99).forEach((c) => kdj.next(c))
    const before = kdj.result
    const preview = kdj.preview(candles[99])
    expect(kdj.result).to.deep.equal(before)
    expect(kdj.next(candles[99])).to.deep.equal(preview)
  })

  it('is built, warmed up and fed through the factory', () => {
    const config = { type: IndicatorEnum.kdj } as const
    const ind = createIndicator(config)
    expect(ind).to.be.instanceOf(KDJ)
    expect([ind.n, ind.kSmooth, ind.dSmooth]).to.deep.equal([9, 3, 3])
    expect(getWarmupCandles(config)).to.equal(63)
    const custom = {
      type: IndicatorEnum.kdj,
      kdjLength: 14,
      kdjKSmooth: 5,
      kdjDSmooth: 3,
    } as const
    expect(getWarmupCandles(custom)).to.equal(13 + kdjSettleBars(5, 3))
    expect(createIndicator(custom).warmup).to.equal(getWarmupCandles(custom))
    const direct = new KDJ()
    for (const c of walk(100)) {
      feedCandle(ind, { o: c.close, h: c.high, l: c.low, c: c.close, v: 1 })
      direct.next(c)
    }
    expect(ind.result).to.not.equal(null)
    expect(ind.result).to.deep.equal(direct.result)
  })
})

describe('kdjCondition', () => {
  const r = (k: number, d: number, j = 3 * k - 2 * d): KDJResult => ({
    k,
    d,
    j,
  })

  it('K crosses D up / down, touching counts on the previous bar', () => {
    expect(kdjCondition(r(30, 25), r(20, 25), { condition: 'cu' })).to.equal(
      true,
    )
    expect(kdjCondition(r(30, 25), r(25, 25), { condition: 'cu' })).to.equal(
      true,
    )
    expect(kdjCondition(r(25, 25), r(20, 25), { condition: 'cu' })).to.equal(
      false,
    )
    expect(kdjCondition(r(30, 25), r(26, 25), { condition: 'cu' })).to.equal(
      false,
    )
    expect(kdjCondition(r(20, 25), r(30, 25), { condition: 'cd' })).to.equal(
      true,
    )
    expect(kdjCondition(r(20, 25), r(25, 25), { condition: 'cd' })).to.equal(
      true,
    )
    expect(kdjCondition(r(20, 25), r(20, 25), { condition: 'cd' })).to.equal(
      false,
    )
    // defaults: K vs D, crossing up
    expect(kdjCondition(r(30, 25), r(20, 25))).to.equal(true)
    // a crossing needs the previous bar
    expect(kdjCondition(r(30, 25), null, { condition: 'cu' })).to.equal(false)
  })

  it('gt / lt read the newest bar only', () => {
    expect(kdjCondition(r(30, 25), null, { condition: 'gt' })).to.equal(true)
    expect(kdjCondition(r(30, 25), null, { condition: 'lt' })).to.equal(false)
    expect(kdjCondition(r(20, 25), null, { condition: 'lt' })).to.equal(true)
  })

  it('J, D and a custom level as either side', () => {
    // J = 3*40 - 2*30 = 60 above K = 40
    expect(
      kdjCondition(r(40, 30), null, {
        line: KDJLineEnum.j,
        compareTo: KDJLineEnum.k,
        condition: 'gt',
      }),
    ).to.equal(true)
    // J crosses up through 100
    expect(
      kdjCondition(r(50, 20), r(40, 20), {
        line: 'j',
        compareTo: 'custom',
        level: 100,
        condition: 'cu',
      }),
    ).to.equal(true) // J 110 now, 80 before
    expect(
      kdjCondition(r(40, 30), null, {
        line: 'd',
        compareTo: 'custom',
        level: '20',
        condition: 'gt',
      }),
    ).to.equal(true)
    // same line both sides is never true
    expect(
      kdjCondition(r(40, 30), r(20, 30), { line: 'k', compareTo: 'k' }),
    ).to.equal(false)
  })

  it('zone filter reads the Stochastic band keys the way Stochastic does', () => {
    const lowUp = (prevK: number, k: number) =>
      kdjCondition(r(k, 15), r(prevK, 15), {
        condition: 'cu',
        zone: KDJZoneEnum.lower,
        // a "Lower" zone reads its lower band from stochUpper
        stochUpper: 20,
        stochLower: 999,
      })
    expect(lowUp(10, 18)).to.equal(true)
    expect(lowUp(10, 22)).to.equal(false) // K left the zone
    const upDown = (prevK: number, k: number) =>
      kdjCondition(r(k, 85), r(prevK, 85), {
        condition: 'cd',
        zone: KDJZoneEnum.upper,
        // an "Upper" zone reads its upper band from stochLower
        stochLower: 80,
        stochUpper: -999,
      })
    expect(upDown(90, 82)).to.equal(true)
    expect(upDown(90, 79)).to.equal(false)
    const both = (k: number, d: number, prevK: number) =>
      kdjCondition(r(k, d), r(prevK, d), {
        condition: 'cu',
        zone: KDJZoneEnum.both,
        stochLower: 20,
        stochUpper: 80,
      })
    expect(both(18, 15, 10)).to.equal(true)
    expect(both(95, 90, 85)).to.equal(true)
    expect(both(50, 45, 40)).to.equal(false)
    // missing zone = no filter; a missing band = never
    expect(kdjCondition(r(50, 45), r(40, 45), { condition: 'cu' })).to.equal(
      true,
    )
    expect(
      kdjCondition(r(18, 15), r(10, 15), { condition: 'cu', zone: 'lower' }),
    ).to.equal(false)
  })

  it('a "Lower" zone is below the band only — J above 100 does not pass', () => {
    // all four values above 100: Stochastic's 100 sentinel would let it pass
    expect(
      kdjCondition(r(0, 0, 130), r(0, 0, 100), {
        line: 'j',
        compareTo: 'custom',
        level: 110,
        condition: 'cu',
        zone: 'lower',
        stochUpper: 20,
      }),
    ).to.equal(true) // custom level: the zone is not applied (as Stochastic)
    expect(
      kdjCondition(
        { k: 105, d: 102, j: 111 },
        { k: 101, d: 102, j: 99 },
        {
          condition: 'cu',
          zone: 'lower',
          stochUpper: 20,
        },
      ),
    ).to.equal(false)
  })

  it('tolerates JSON nulls and missing bars', () => {
    const nul = { k: null, d: null, j: null } as unknown as KDJResult
    expect(kdjCondition(nul, r(20, 25), { condition: 'cu' })).to.equal(false)
    expect(kdjCondition(r(30, 25), nul, { condition: 'cu' })).to.equal(false)
    expect(kdjCondition(null, null)).to.equal(false)
    expect(kdjCondition(undefined, undefined, { condition: 'gt' })).to.equal(
      false,
    )
  })
})
