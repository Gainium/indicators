import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  OB_MAX_WINDOW,
  OB_WARMUP,
  OBLevelEnum,
  OBSideEnum,
  OrderBlocks,
  orderBlockCondition,
  orderBlockLevel,
} from '../src/OB/OrderBlocks'
import { OrderBlockResult } from '../src/types/result'
import { OHLCT } from '../src/types/candles'
import { createIndicator, feedCandle, getWarmupCandles } from '../src/factory'
import { IndicatorEnum } from '../src/types/config'

// [high, low, close]; open = previous close. Hand-traced with swingLength 2.
const BARS: Array<[number, number, number]> = [
  [10, 9, 9.5], // 0
  [11, 9.5, 10.5], // 1
  [12, 10.5, 11.5], // 2  swing high 12 (confirmed on bar 4)
  [11.5, 10, 10.2], // 3
  [11, 9, 9.5], // 4  swing low 9 (confirmed on bar 6); lowest low after the swing high
  [11.8, 9.2, 11.6], // 5  close below 12: no break
  [12.8, 11, 12.5], // 6  close 12.5 > 12: bullish block = bar 4 [9, 11], id 6
  [13.5, 12.2, 13], // 7  swing high 13.5 (confirmed on bar 9)
  [13.2, 12, 12.4], // 8
  [12.6, 10.8, 10.9], // 9  close drops into the bullish block (crosses top 11)
  [11.2, 8.5, 8.8], // 10 close < 9: bullish mitigated; close < swing low 9: bearish block = bar 7 [12.2, 13.5]
  [10, 8, 9.5], // 11 swing low 8 (confirmed on bar 13)
  [10.5, 9, 10.2], // 12
  [11, 9.8, 10.8], // 13
  [13.8, 10.6, 13.7], // 14 close > 13.5: bearish mitigated, bullish block = bar 11 [8, 10], id 14
  [14.5, 13.5, 14.2], // 15 swing high 14.5 (confirmed on bar 17)
  [14.2, 13, 13.4], // 16
  [13.9, 12.5, 13], // 17
  [15, 12.8, 14.8], // 18 close > 14.5: bullish block replaced by bar 17 [12.5, 13.9], id 18
]

const toCandles = (
  bars: Array<[number, number, number]>,
  time?: (i: number) => number,
): OHLCT[] =>
  bars.map(([high, low, close], i) => ({
    open: i ? bars[i - 1][2] : close,
    high,
    low,
    close,
    time: time ? time(i) : NaN,
  }))

const bull = (r: OrderBlockResult) => [
  r.bullishBottom,
  r.bullishTop,
  r.bullishId,
]
const bear = (r: OrderBlockResult) => [
  r.bearishBottom,
  r.bearishTop,
  r.bearishId,
]
const NONE = [NaN, NaN, NaN]

function walk(count: number, seed = 13579): OHLCT[] {
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out: OHLCT[] = []
  let c = 100
  for (let i = 0; i < count; i++) {
    const o = c
    c = Math.max(1, c * (1 + (rand() - 0.5) * 0.04))
    out.push({
      open: o,
      high: Math.max(o, c) * (1 + rand() * 0.01),
      low: Math.min(o, c) * (1 - rand() * 0.01),
      close: c,
      time: 1_700_000_000_000 + i * 3_600_000,
    })
  }
  return out
}

describe('OrderBlocks', () => {
  const ob = new OrderBlocks(2)
  const results = toCandles(BARS).map((c) => ob.next(c) as OrderBlockResult)

  it('is null until a swing can be confirmed (2L bars)', () => {
    for (let i = 0; i < 4; i++) expect(results[i], `bar ${i}`).to.equal(null)
    expect(results[4]).to.not.equal(null)
    expect(bull(results[4])).to.deep.equal(NONE)
    expect(bear(results[4])).to.deep.equal(NONE)
  })

  it('has no block before a close breaks the swing high', () => {
    expect(bull(results[5])).to.deep.equal(NONE)
  })

  it('forms a bullish block on the breaking close: the lowest-low candle since the swing high', () => {
    expect(bull(results[6])).to.deep.equal([9, 11, 6])
    expect(results[6].price).to.equal(12.5)
    for (let i = 7; i <= 9; i++)
      expect(bull(results[i]), `bar ${i}`).to.deep.equal([9, 11, 6])
    expect(bear(results[9])).to.deep.equal(NONE)
  })

  it('mitigates a bullish block on a close below its bottom, and forms a bearish block on a close below the swing low', () => {
    expect(bull(results[10])).to.deep.equal(NONE)
    expect(bear(results[10])).to.deep.equal([12.2, 13.5, 10])
    for (let i = 11; i <= 13; i++)
      expect(bear(results[i]), `bar ${i}`).to.deep.equal([12.2, 13.5, 10])
  })

  it('mitigates a bearish block on a close above its top; the same close breaks the next swing high', () => {
    expect(bear(results[14])).to.deep.equal(NONE)
    expect(bull(results[14])).to.deep.equal([8, 10, 14])
  })

  it('replaces the active block with a new one, with a new id', () => {
    expect(bull(results[17])).to.deep.equal([8, 10, 14])
    expect(bull(results[18])).to.deep.equal([12.5, 13.9, 18])
  })

  it('uses the candle open time as the block id when there is one', () => {
    const t = (i: number) => 1_000_000 + i * 60_000
    const ind = new OrderBlocks(2)
    const r = toCandles(BARS, t).map((c) => ind.next(c) as OrderBlockResult)
    expect(r[6].bullishId).to.equal(t(6))
    expect(r[10].bearishId).to.equal(t(10))
    expect(r[18].bullishId).to.equal(t(18))
  })

  it('breaks ties on the lowest low by taking the latest candle', () => {
    const bars: Array<[number, number, number]> = [
      [10, 9, 9.5],
      [11, 9.5, 10.5],
      [12, 10.5, 11.5], // swing high
      [11.5, 9, 10.2], // low 9
      [11, 9, 9.5], // low 9 again, later → the block
      [11.8, 9.5, 11.6],
      [12.8, 11, 12.5], // break
    ]
    const ind = new OrderBlocks(2)
    const r = toCandles(bars).map((c) => ind.next(c) as OrderBlockResult)
    expect(bull(r[6])).to.deep.equal([9, 11, 6])
  })

  it('searches at most 500 bars back from the breaking candle', () => {
    const bars: Array<[number, number, number]> = [
      [10, 9, 9.5],
      [10, 9, 9.5],
      [20, 9, 9.5], // swing high 20
    ]
    for (let i = 3; i < 702; i++) {
      bars.push([10, i === 10 ? 1 : i === 300 ? 5 : 9, 9.5])
    }
    bars.push([25, 9, 21]) // bar 702 breaks 20
    const ind = new OrderBlocks(2)
    const r = toCandles(bars).map((c) => ind.next(c) as OrderBlockResult)
    expect(OB_MAX_WINDOW).to.equal(500)
    // bar 10 (low 1) is outside bars 203..702; bar 300 (low 5) is the block
    expect(bull(r[702])).to.deep.equal([5, 10, 702])
  })

  it('never forms a block from a swing that is already used up', () => {
    // after bar 6 used swing high 12, a further close above 12 forms nothing
    const bars = BARS.slice(0, 7).concat([[12.9, 12.3, 12.7]] as Array<
      [number, number, number]
    >)
    const ind = new OrderBlocks(2)
    const r = toCandles(bars).map((c) => ind.next(c) as OrderBlockResult)
    expect(bull(r[7])).to.deep.equal([9, 11, 6])
  })

  it('continues identically after exportState / restoreState', () => {
    const candles = walk(1500)
    const whole = new OrderBlocks(5)
    const expected = candles.map((c) => whole.next(c))
    expect(expected.some((r) => r && !isNaN(r.bullishTop))).to.equal(true)
    expect(expected.some((r) => r && !isNaN(r.bearishTop))).to.equal(true)
    for (const split of [3, 777, 1200]) {
      const first = new OrderBlocks(5)
      candles.slice(0, split).forEach((c) => first.next(c))
      const second = new OrderBlocks(5)
      second.restoreState(first.exportState())
      const rest = candles.slice(split).map((c) => second.next(c))
      expect(rest, `split ${split}`).to.deep.equal(expected.slice(split))
    }
  })

  it('restores from an in-memory exportState and preview has no side effect', () => {
    const candles = walk(800, 2468)
    const whole = new OrderBlocks(3)
    const expected = candles.map((c) => whole.next(c))
    const a = new OrderBlocks(3)
    candles.slice(0, 600).forEach((c) => a.next(c))
    const peek = a.preview(candles[600])
    const b = new OrderBlocks(3)
    b.restoreState(a.exportState())
    expect(a.next(candles[600])).to.deep.equal(peek)
    const rest = candles.slice(600).map((c) => b.next(c))
    expect(rest).to.deep.equal(expected.slice(600))
  })

  it('rejects an incomplete state', () => {
    expect(() =>
      new OrderBlocks(2).restoreState({ bin: [], circ: [] }),
    ).to.throw()
  })

  it('is built, warmed up and fed through the factory', () => {
    const ind = createIndicator({ type: IndicatorEnum.ob, swingLength: 2 })
    expect(ind).to.be.instanceOf(OrderBlocks)
    expect(ind.swingLength).to.equal(2)
    expect(createIndicator({ type: IndicatorEnum.ob }).swingLength).to.equal(5)
    expect(
      getWarmupCandles({ type: IndicatorEnum.ob, swingLength: 5 }),
    ).to.equal(OB_WARMUP)
    expect(OB_WARMUP).to.equal(1000)
    const t = (i: number) => 5_000_000 + i * 60_000
    toCandles(BARS, t).forEach((c) =>
      feedCandle(ind, {
        o: c.open,
        h: c.high,
        l: c.low,
        c: c.close,
        v: 1,
        t: c.time,
      }),
    )
    expect(bull(ind.result)).to.deep.equal([12.5, 13.9, t(18)])
    // without t, the bar index is the id
    const untimed = createIndicator({ type: IndicatorEnum.ob, swingLength: 2 })
    toCandles(BARS).forEach((c) =>
      feedCandle(untimed, { o: c.open, h: c.high, l: c.low, c: c.close, v: 1 }),
    )
    expect(untimed.result.bullishId).to.equal(18)
  })
})

describe('orderBlockLevel', () => {
  const r: OrderBlockResult = {
    bullishTop: 11,
    bullishBottom: 9,
    bullishId: 1,
    bearishTop: 20,
    bearishBottom: 18,
    bearishId: 2,
    price: 15,
  }
  it('reads top, middle and bottom of either side', () => {
    expect(orderBlockLevel(r, 'bullish', 'top')).to.equal(11)
    expect(orderBlockLevel(r, 'bullish', 'middle')).to.equal(10)
    expect(orderBlockLevel(r, 'bullish', 'bottom')).to.equal(9)
    expect(orderBlockLevel(r, OBSideEnum.bearish, OBLevelEnum.top)).to.equal(20)
    expect(orderBlockLevel(r, 'bearish', 'middle')).to.equal(19)
    expect(orderBlockLevel(r, 'bearish', 'bottom')).to.equal(18)
    expect(orderBlockLevel(r, 'sideways', 'top')).to.be.NaN
    expect(orderBlockLevel(r, 'bullish', 'edge')).to.be.NaN
    expect(orderBlockLevel(null, 'bullish', 'top')).to.be.NaN
  })
})

describe('orderBlockCondition', () => {
  const block = (
    price: number,
    id = 1,
    top = 11,
    bottom = 9,
  ): OrderBlockResult => ({
    bullishTop: top,
    bullishBottom: bottom,
    bullishId: id,
    bearishTop: top + 10,
    bearishBottom: bottom + 10,
    bearishId: id + 100,
    price,
  })
  const none = (price: number): OrderBlockResult => ({
    bullishTop: NaN,
    bullishBottom: NaN,
    bullishId: NaN,
    bearishTop: NaN,
    bearishBottom: NaN,
    bearishId: NaN,
    price,
  })

  it('defaults to bullish, top, crossing down', () => {
    expect(orderBlockCondition(block(10.9), block(12.4))).to.equal(true)
    expect(orderBlockCondition(block(11), block(12.4))).to.equal(true) // touching on last
    expect(orderBlockCondition(block(11.1), block(12.4))).to.equal(false)
    expect(orderBlockCondition(block(10.5), block(11))).to.equal(false) // prev was not above
  })

  it('crossing up needs prev below and last at or above', () => {
    const s = { condition: 'cu', level: 'bottom' }
    expect(orderBlockCondition(block(9.5), block(8.5), s)).to.equal(true)
    expect(orderBlockCondition(block(9), block(8.5), s)).to.equal(true)
    expect(orderBlockCondition(block(8.9), block(8.5), s)).to.equal(false)
    expect(orderBlockCondition(block(9.5), block(9), s)).to.equal(false)
  })

  it('middle level and the bearish side', () => {
    expect(
      orderBlockCondition(block(9.9), block(10.5), { level: 'middle' }),
    ).to.equal(true)
    const s = { side: 'bearish', level: 'bottom', condition: 'cu' }
    // bearish zone [19, 21]
    expect(orderBlockCondition(block(19.5), block(18.5), s)).to.equal(true)
    expect(orderBlockCondition(block(18.95), block(18.5), s)).to.equal(false)
    expect(
      orderBlockCondition(block(19.5), block(18.5), { ...s, level: 'top' }),
    ).to.equal(false)
    expect(
      orderBlockCondition(block(20.5), block(21.5), { side: 'bearish' }),
    ).to.equal(true) // cd top 21
  })

  it('gt / lt read the newest bar only', () => {
    expect(orderBlockCondition(block(12), null, { condition: 'gt' })).to.equal(
      true,
    )
    expect(orderBlockCondition(block(11), null, { condition: 'gt' })).to.equal(
      false,
    )
    expect(orderBlockCondition(block(10), null, { condition: 'lt' })).to.equal(
      true,
    )
    expect(orderBlockCondition(block(12), null, { condition: 'lt' })).to.equal(
      false,
    )
  })

  it('never counts a new block jumping the level as a crossing', () => {
    // prev above block 1's top, last below block 2's top: ids differ
    expect(orderBlockCondition(block(10.9, 2), block(12.4, 1))).to.equal(false)
    // prev had no block at all
    expect(orderBlockCondition(block(10.9, 2), none(12.4))).to.equal(false)
  })

  it('is false with no active block, no prev, nulls or unknown settings', () => {
    expect(orderBlockCondition(none(10), block(12))).to.equal(false)
    expect(orderBlockCondition(none(10), null, { condition: 'gt' })).to.equal(
      false,
    )
    expect(orderBlockCondition(block(10.9), null)).to.equal(false)
    expect(orderBlockCondition(block(10.9), undefined)).to.equal(false)
    expect(orderBlockCondition(null, block(12))).to.equal(false)
    expect(
      orderBlockCondition(block(10.9), block(12.4), { condition: 'xx' }),
    ).to.equal(false)
    expect(
      orderBlockCondition(block(10.9), block(12.4), { side: 'xx' }),
    ).to.equal(false)
    expect(
      orderBlockCondition(block(10.9), block(12.4), { level: 'xx' }),
    ).to.equal(false)
    expect(
      orderBlockCondition({ ...block(10.9), price: null as any }, block(12.4)),
    ).to.equal(false)
    expect(
      orderBlockCondition(block(10.9), { ...block(12.4), price: null as any }),
    ).to.equal(false)
  })

  it('tolerates results that went through JSON', () => {
    const last = JSON.parse(JSON.stringify(block(10.9)))
    const prev = JSON.parse(JSON.stringify(block(12.4)))
    expect(orderBlockCondition(last, prev)).to.equal(true)
    const empty = JSON.parse(JSON.stringify(none(10)))
    expect(empty.bullishTop).to.equal(null)
    expect(orderBlockCondition(empty, prev)).to.equal(false)
    expect(orderBlockCondition(empty, null, { condition: 'lt' })).to.equal(
      false,
    )
    // both ids null → not the same block
    const a = { ...none(10.9), bullishTop: 11, bullishBottom: 9 }
    const b = { ...none(12.4), bullishTop: 11, bullishBottom: 9 }
    expect(
      orderBlockCondition(
        JSON.parse(JSON.stringify(a)),
        JSON.parse(JSON.stringify(b)),
      ),
    ).to.equal(false)
  })

  it('fires the retest on the hand-traced stream and never on the replacement bar', () => {
    const ind = new OrderBlocks(2)
    const r = toCandles(BARS).map((c) => ind.next(c) as OrderBlockResult)
    const fires = r
      .map((x, i) => (i > 0 && orderBlockCondition(x, r[i - 1]) ? i : -1))
      .filter((i) => i >= 0)
    expect(fires).to.deep.equal([9])
    // bar 18 replaced the block: no crossing reads across it
    expect(r[18].bullishId).to.not.equal(r[17].bullishId)
    expect(
      orderBlockCondition(r[18], r[17], { condition: 'cu', level: 'top' }),
    ).to.equal(false)
  })
})
