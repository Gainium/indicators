import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  SessionLevelEnum,
  SessionLevels,
  SessionLevelsConditionSettings,
  sessionLevelValue,
  sessionLevelsCondition,
} from '../src/Session/Session'
import { SessionLevelsResult } from '../src/types/result'
import { gt, gte, lt, lte } from '../src/util/math'
import btc from './fixtures/btcusdt-1h-2026-03-08-to-03-17.json'

/**
 * `sessionLevelsCondition` exactly as shipped in 1.13.0 (before the
 * first-candle-after-the-session crossing), kept here to prove what changed.
 */
const num = (v: number | null | undefined): number =>
  v === null || v === undefined ? NaN : +v
const sameKey = (a: number, b: number) => a === b || (isNaN(a) && isNaN(b))
const v113SessionLevelsCondition = (
  last: SessionLevelsResult | null | undefined,
  prev: SessionLevelsResult | null | undefined,
  settings: SessionLevelsConditionSettings,
): boolean => {
  if (!last) {
    return false
  }
  const active = settings.active
  const lastIn = num(last.inSession) === 1
  if (active === 'always' ? false : active === 'outside' ? lastIn : !lastIn) {
    return false
  }
  const a = settings.a ?? SessionLevelEnum.price
  const b = settings.b ?? SessionLevelEnum.prevHigh
  if (a === b) {
    return false
  }
  const lastA = sessionLevelValue(last, a)
  const lastB = sessionLevelValue(last, b)
  if (isNaN(lastA) || isNaN(lastB)) {
    return false
  }
  const condition = settings.condition ?? 'cu'
  if (condition === 'gt') {
    return gt(lastA, lastB)
  }
  if (condition === 'lt') {
    return lt(lastA, lastB)
  }
  if (condition !== 'cd' && condition !== 'cu') {
    return false
  }
  if (!prev || !sameKey(num(prev.prevSessionKey), num(last.prevSessionKey))) {
    return false
  }
  if (lastIn) {
    if (
      num(prev.inSession) !== 1 ||
      isNaN(num(last.sessionKey)) ||
      num(prev.sessionKey) !== num(last.sessionKey)
    ) {
      return false
    }
  } else if (num(prev.inSession) === 1) {
    return false
  }
  const prevA = sessionLevelValue(prev, a)
  const prevB = sessionLevelValue(prev, b)
  if (isNaN(prevA) || isNaN(prevB)) {
    return false
  }
  return condition === 'cd'
    ? gt(prevA, prevB) && lte(lastA, lastB)
    : lt(prevA, prevB) && gte(lastA, lastB)
}

const HOUR = 3_600_000
const START = Date.parse('2026-09-06T00:00:00Z') // a Sunday

/** Hourly candles of a random walk; every 37th candle has no time. */
function walk(count: number, seed = 2468) {
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const out: Array<{
    open: number
    high: number
    low: number
    close: number
    time: number
  }> = []
  let c = 100
  for (let i = 0; i < count; i++) {
    const o = c
    c = Math.max(1, c * (1 + (rand() - 0.5) * 0.02))
    out.push({
      open: o,
      high: Math.max(o, c) * (1 + rand() * 0.005),
      low: Math.min(o, c) * (1 - rand() * 0.005),
      close: c,
      time: i % 37 === 36 ? NaN : START + i * HOUR,
    })
  }
  return out
}

const LEVELS = Object.values(SessionLevelEnum) as string[]
const PREV_LEVELS = [
  SessionLevelEnum.prevOpen,
  SessionLevelEnum.prevHigh,
  SessionLevelEnum.prevMid,
  SessionLevelEnum.prevLow,
  SessionLevelEnum.prevClose,
] as string[]
const CONDITIONS = ['cu', 'cd', 'gt', 'lt', 'xx', undefined]
const SESSIONS: Array<
  [number[], { start?: string; end?: string; timezone?: string } | null]
> = [
  [[1], null], // Monday range
  [[1, 2, 3, 4, 5], { start: '08:00', end: '16:30' }],
  [
    [0, 1, 2, 3, 4, 5, 6],
    { start: '22:00', end: '03:00', timezone: 'America/New_York' },
  ],
  [[0, 1, 2, 3, 4, 5, 6], null], // back-to-back sessions, never outside
]

/** Every (series, i, a, b, condition) the walk produces, raw and via JSON. */
function* cases() {
  for (const [days, hours] of SESSIONS) {
    const ind = new SessionLevels(days, hours)
    const results = walk(3000).map((c) => ind.next(c) as SessionLevelsResult)
    const json = results.map((r) => JSON.parse(JSON.stringify(r)))
    for (const rs of [results, json]) {
      for (let i = 1; i < rs.length; i++) {
        for (const a of LEVELS) {
          for (const b of LEVELS) {
            for (const condition of CONDITIONS) {
              yield { days, rs, i, a, b, condition }
            }
          }
        }
      }
    }
  }
}

describe('sessionLevelsCondition first candle after the session (1.14.0)', () => {
  it('session (default, missing, null, unknown) is identical to 1.13.0 on every bar', () => {
    let checked = 0
    let fired = 0
    const mismatches: string[] = []
    for (const { days, rs, i, a, b, condition } of cases()) {
      const base: SessionLevelsConditionSettings = { a, b, condition }
      for (const active of [undefined, null, 'session', 'nonsense']) {
        const settings = active === undefined ? base : { ...base, active }
        const old = v113SessionLevelsCondition(rs[i], rs[i - 1], settings)
        if (sessionLevelsCondition(rs[i], rs[i - 1], settings) !== old) {
          mismatches.push(`${days} ${i} ${a} ${b} ${condition} ${active}`)
        }
        checked++
        if (old) fired++
      }
    }
    expect(mismatches.slice(0, 5)).to.deep.equal([])
    expect(checked).to.be.greaterThan(1_000_000)
    expect(fired).to.be.greaterThan(1000)
  })

  it('outside / always differ from 1.13.0 only on the first outside candle, price vs a prev* level, as a real crossing', () => {
    let changed = 0
    let boundaryPairs = 0
    const unexpected: string[] = []
    for (const { days, rs, i, a, b, condition } of cases()) {
      const last = rs[i]
      const prev = rs[i - 1]
      const boundary =
        num(last.inSession) !== 1 &&
        num(prev.inSession) === 1 &&
        num(prev.sessionKey) === num(last.prevSessionKey)
      const pair =
        (a === 'price' && PREV_LEVELS.includes(b)) ||
        (b === 'price' && PREV_LEVELS.includes(a))
      for (const active of ['outside', 'always']) {
        const s = { a, b, condition, active }
        const old = v113SessionLevelsCondition(last, prev, s)
        const now = sessionLevelsCondition(last, prev, s)
        const crossing = condition ?? 'cu'
        if (boundary && pair && (crossing === 'cu' || crossing === 'cd')) {
          boundaryPairs++
        }
        if (now === old) {
          continue
        }
        changed++
        // the only change: false → true on a boundary crossing of price
        // with a prev* level, where the two closes really are on opposite
        // sides of the level the newest bar sees
        const level = sessionLevelValue(last, a === 'price' ? b : a)
        const p0 = num(prev.price)
        const p1 = num(last.price)
        const up = a === 'price' ? crossing === 'cu' : crossing === 'cd'
        const real = up ? p0 < level && p1 >= level : p0 > level && p1 <= level
        if (old || !now || !boundary || !pair || !real) {
          unexpected.push(`${days} ${i} ${a} ${b} ${condition} ${active}`)
        }
      }
    }
    expect(unexpected.slice(0, 5)).to.deep.equal([])
    expect(changed).to.be.greaterThan(20)
    expect(boundaryPairs).to.be.greaterThan(changed)
  })

  it('at the boundary, prevClose never crosses and the session close stays inside its high / low', () => {
    for (const [days, hours] of SESSIONS) {
      const ind = new SessionLevels(days, hours)
      const rs = walk(3000).map((c) => ind.next(c) as SessionLevelsResult)
      for (let i = 1; i < rs.length; i++) {
        const last = rs[i]
        const prev = rs[i - 1]
        if (
          !(
            last.inSession === 0 &&
            prev.inSession === 1 &&
            prev.sessionKey === last.prevSessionKey
          )
        ) {
          continue
        }
        expect(prev.price).to.equal(last.prevClose)
        expect(prev.price).to.be.at.most(last.prevHigh)
        expect(prev.price).to.be.at.least(last.prevLow)
        for (const condition of ['cu', 'cd']) {
          for (const active of ['outside', 'always']) {
            expect(
              sessionLevelsCondition(last, prev, {
                a: 'price',
                b: 'prevClose',
                condition,
                active,
              }),
            ).to.equal(false)
            // the session's high can only be broken upwards, its low downwards
            expect(
              sessionLevelsCondition(last, prev, {
                a: 'price',
                b: 'prevHigh',
                condition: 'cd',
                active,
              }),
            ).to.equal(false)
            expect(
              sessionLevelsCondition(last, prev, {
                a: 'price',
                b: 'prevLow',
                condition: 'cu',
                active,
              }),
            ).to.equal(false)
          }
        }
      }
    }
  })

  it('a session seen only partly (data starting inside it) gives no boundary crossing', () => {
    const t = (iso: string) => Date.parse(iso)
    const c = (iso: string, close: number) => ({
      open: close,
      high: close,
      low: close,
      close,
      time: t(iso),
    })
    const ind = new SessionLevels([1])
    const r = [
      c('2026-09-07T22:00:00Z', 100), // data starts inside Monday
      c('2026-09-07T23:00:00Z', 101),
      c('2026-09-08T00:00:00Z', 120), // Tuesday
    ].map((b) => ind.next(b) as SessionLevelsResult)
    expect(r[2].prevSessionKey).to.be.NaN
    expect(
      sessionLevelsCondition(r[2], r[1], {
        a: 'price',
        b: 'prevHigh',
        condition: 'cu',
        active: 'outside',
      }),
    ).to.equal(false)
  })

  describe('BTCUSDT 1h, Monday range broken on Tue 2026-03-17 00:00 UTC (Binance)', () => {
    const ind = new SessionLevels([1])
    const bars = (btc as number[][]).map(([time, open, high, low, close]) => ({
      time,
      open,
      high,
      low,
      close,
    }))
    const r = bars.map((b) => ind.next(b) as SessionLevelsResult)
    const at = (iso: string) =>
      bars.findIndex((b) => b.time === Date.parse(iso))
    const iso = (i: number) => new Date(bars[i].time).toISOString()
    const fires = (s: SessionLevelsConditionSettings) =>
      r
        .map((_, i) =>
          i > 0 && sessionLevelsCondition(r[i], r[i - 1], s) ? iso(i) : '',
        )
        .filter(Boolean)
    const up = { a: 'price', b: 'prevHigh', condition: 'cu' }

    it('reads the sequence as the chart does', () => {
      const mon = at('2026-03-16T23:00:00Z')
      const tue = at('2026-03-17T00:00:00Z')
      expect(mon).to.be.greaterThan(0)
      expect(tue).to.equal(mon + 1)
      expect(r[mon].inSession).to.equal(1)
      expect(r[mon].price).to.equal(74884.67)
      expect(r[mon].prevHigh).to.equal(69516.65) // the Monday before
      expect(r[tue].inSession).to.equal(0)
      expect(r[tue].price).to.equal(75318.48)
      expect(r[tue].prevHigh).to.equal(74909.08)
      expect(r[tue].prevLow).to.equal(72270.41)
      expect(r[tue].prevSessionKey).to.equal(r[mon].sessionKey)
    })

    it('outside / always: crossing up the Monday high fires on Tue 00:00', () => {
      for (const active of ['outside', 'always']) {
        const f = fires({ ...up, active })
        expect(f, active).to.include('2026-03-17T00:00:00.000Z')
        expect(
          f.filter((x) => x >= '2026-03-16T00:00:00.000Z'),
          active,
        ).to.deep.equal(['2026-03-17T00:00:00.000Z'])
      }
      // the same with the operands swapped (prevHigh crossed down by price)
      expect(
        fires({
          a: 'prevHigh',
          b: 'price',
          condition: 'cd',
          active: 'outside',
        }),
      ).to.include('2026-03-17T00:00:00.000Z')
    })

    it('1.13.0 missed it; gt holds on 00:00 and 01:00', () => {
      const tue = at('2026-03-17T00:00:00Z')
      expect(
        v113SessionLevelsCondition(r[tue], r[tue - 1], {
          ...up,
          active: 'outside',
        }),
      ).to.equal(false)
      for (const i of [tue, tue + 1]) {
        expect(
          sessionLevelsCondition(r[i], r[i - 1], {
            a: 'price',
            b: 'prevHigh',
            condition: 'gt',
            active: 'outside',
          }),
        ).to.equal(true)
      }
      expect(
        sessionLevelsCondition(r[tue + 1], r[tue], {
          ...up,
          active: 'outside',
        }),
      ).to.equal(false)
    })

    it('session (default) never fires outside Monday', () => {
      for (const s of [up, { ...up, active: 'session' }]) {
        for (const x of fires(s)) {
          expect(new Date(x).getUTCDay()).to.equal(1)
        }
      }
    })
  })
})
