import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  SessionLevelEnum,
  SessionLevels,
  SessionLevelsActiveEnum,
  SessionLevelsConditionSettings,
  sessionLevelValue,
  sessionLevelsCondition,
} from '../src/Session/Session'
import { SessionLevelsResult } from '../src/types/result'
import { gt, gte, lt, lte } from '../src/util/math'

/**
 * `sessionLevelsCondition` exactly as shipped in 1.11.0 (before `active`),
 * kept here to prove that a missing `active` changes nothing.
 */
const num = (v: number | null | undefined): number =>
  v === null || v === undefined ? NaN : +v
const sameKey = (a: number, b: number) => a === b || (isNaN(a) && isNaN(b))
const legacySessionLevelsCondition = (
  last: SessionLevelsResult | null | undefined,
  prev: SessionLevelsResult | null | undefined,
  settings: SessionLevelsConditionSettings,
): boolean => {
  if (!last || num(last.inSession) !== 1) {
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
  if (
    !prev ||
    num(prev.inSession) !== 1 ||
    isNaN(num(last.sessionKey)) ||
    num(prev.sessionKey) !== num(last.sessionKey) ||
    !sameKey(num(prev.prevSessionKey), num(last.prevSessionKey))
  ) {
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
function walk(count: number, seed = 1357) {
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

const LEVELS = Object.values(SessionLevelEnum)
const CONDITIONS = ['cu', 'cd', 'gt', 'lt', 'xx', undefined]

describe('sessionLevelsCondition active', () => {
  it('without active (or with active session / unknown) is identical to 1.11.0 on a long random walk', () => {
    const configs: Array<
      [number[], { start?: string; end?: string; timezone?: string } | null]
    > = [
      [[1], null], // Monday range
      [[1, 2, 3, 4, 5], { start: '08:00', end: '16:30' }],
      [
        [0, 1, 2, 3, 4, 5, 6],
        { start: '22:00', end: '03:00', timezone: 'America/New_York' },
      ],
    ]
    let checked = 0
    let fired = 0
    const mismatches: string[] = []
    for (const [days, hours] of configs) {
      const ind = new SessionLevels(days, hours)
      const results = walk(3000).map((c) => ind.next(c) as SessionLevelsResult)
      // also through JSON (NaN → null), as the engine stores them
      const json = results.map((r) => JSON.parse(JSON.stringify(r)))
      for (const rs of [results, json]) {
        for (let i = 1; i < rs.length; i++) {
          for (const a of LEVELS) {
            for (const b of [
              SessionLevelEnum.prevHigh,
              SessionLevelEnum.prevLow,
              SessionLevelEnum.curMid,
              SessionLevelEnum.price,
            ]) {
              for (const condition of CONDITIONS) {
                const base: SessionLevelsConditionSettings = { a, b, condition }
                const old = legacySessionLevelsCondition(rs[i], rs[i - 1], base)
                for (const active of [undefined, null, 'session', 'nonsense']) {
                  const settings =
                    active === undefined ? base : { ...base, active }
                  if (
                    sessionLevelsCondition(rs[i], rs[i - 1], settings) !== old
                  ) {
                    mismatches.push(
                      `${days} ${i} ${a} ${b} ${condition} ${active}`,
                    )
                  }
                }
                checked++
                if (old) fired++
              }
            }
          }
        }
      }
    }
    expect(mismatches.slice(0, 5)).to.deep.equal([])
    expect(checked).to.be.greaterThan(100_000)
    expect(fired).to.be.greaterThan(100)
  })

  describe('Monday range (days = Monday, whole day, 1h candles)', () => {
    // Monday 2026-09-07 high 110 / low 95; Tuesday crosses 110 at 05:00
    const t = (iso: string) => Date.parse(iso)
    const c = (iso: string, close: number, high = close, low = close) => ({
      open: close,
      high,
      low,
      close,
      time: t(iso),
    })
    const bars = [
      c('2026-09-06T23:00:00Z', 100), // Sunday (data starts outside)
      c('2026-09-07T00:00:00Z', 100, 101, 95), // Monday opens
      c('2026-09-07T12:00:00Z', 108, 110, 100),
      c('2026-09-07T23:00:00Z', 109.5), // last Monday candle
      c('2026-09-08T00:00:00Z', 112), // Tuesday: jumps above 110 (prev was inside)
      c('2026-09-08T01:00:00Z', 108),
      c('2026-09-08T05:00:00Z', 111), // Tuesday crosses up 110
      c('2026-09-08T06:00:00Z', 109), // crosses down
      c('2026-09-14T00:00:00Z', 111.5), // next Monday: in session again
      c('2026-09-14T01:00:00Z', 105),
    ]
    const ind = new SessionLevels([1])
    const r = bars.map((b) => ind.next(b) as SessionLevelsResult)
    const up = { a: 'price', b: 'prevHigh', condition: 'cu' }
    const cond = (i: number, s: SessionLevelsConditionSettings) =>
      sessionLevelsCondition(r[i], r[i - 1], s)

    it('carries the last completed session outside it', () => {
      expect(r[4].inSession).to.equal(0)
      expect(r[4].prevHigh).to.equal(110)
      expect(r[4].prevLow).to.equal(95)
      expect(r[4].curOpen).to.be.NaN
      expect(r[7].prevSessionKey).to.equal(20260907)
    })

    it('outside: fires on the out-of-session crossing only', () => {
      const s = { ...up, active: SessionLevelsActiveEnum.outside }
      const fires = r
        .map((_, i) => (i > 0 && cond(i, s) ? i : -1))
        .filter((i) => i >= 0)
      expect(fires).to.deep.equal([6])
      const down = { ...s, condition: 'cd' }
      expect(cond(7, down)).to.equal(true)
    })

    it('a session ending is not a crossing (prev inside, last outside)', () => {
      expect(cond(4, { ...up, active: 'outside' })).to.equal(false)
      expect(cond(4, { ...up, active: 'always' })).to.equal(false)
    })

    it('a session starting is not a crossing (prev outside, last inside)', () => {
      // bar 8 → 9 is inside; bar 7 → 8: prev outside, last inside, new prev session? same
      expect(r[8].inSession).to.equal(1)
      expect(
        cond(8, {
          a: 'price',
          b: 'prevHigh',
          condition: 'cu',
          active: 'always',
        }),
      ).to.equal(false)
    })

    it('outside never fires inside the session; session never fires outside', () => {
      const gtS = { a: 'price', b: 'prevHigh', condition: 'gt' }
      expect(
        sessionLevelsCondition(r[8], null, { ...gtS, active: 'outside' }),
      ).to.equal(false)
      expect(
        sessionLevelsCondition(r[4], null, { ...gtS, active: 'outside' }),
      ).to.equal(true)
      expect(sessionLevelsCondition(r[4], null, gtS)).to.equal(false)
      expect(
        sessionLevelsCondition(r[4], null, { ...gtS, active: 'session' }),
      ).to.equal(false)
    })

    it('always: evaluated inside and outside', () => {
      const gtS = {
        a: 'price',
        b: 'prevHigh',
        condition: 'gt',
        active: 'always',
      }
      // r[8]: inside, prev session is still Monday 09-07 (110) → 111.5 > 110
      expect(sessionLevelsCondition(r[4], null, gtS)).to.equal(true)
      expect(sessionLevelsCondition(r[8], null, gtS)).to.equal(true)
      expect(cond(6, { ...up, active: 'always' })).to.equal(true)
    })

    it('reading a current-session level outside the session is false', () => {
      for (const b of ['curOpen', 'curMid']) {
        for (const condition of ['gt', 'lt', 'cu', 'cd']) {
          expect(
            cond(6, { a: 'price', b, condition, active: 'outside' }),
            `${b} ${condition}`,
          ).to.equal(false)
        }
      }
    })

    it('needs the same previous session on both outside candles', () => {
      const last = { ...r[6] }
      const prevR = { ...r[5], prevSessionKey: 20260831 }
      expect(
        sessionLevelsCondition(last, prevR, { ...up, active: 'outside' }),
      ).to.equal(false)
      expect(
        sessionLevelsCondition(
          JSON.parse(JSON.stringify(r[6])),
          JSON.parse(JSON.stringify(r[5])),
          { ...up, active: 'outside' },
        ),
      ).to.equal(true)
      expect(
        sessionLevelsCondition(r[6], null, { ...up, active: 'outside' }),
      ).to.equal(false)
    })
  })

  it('inside crossings with active always match the session rule', () => {
    const ind = new SessionLevels([1, 2, 3, 4, 5], {
      start: '08:00',
      end: '16:00',
    })
    const rs = walk(2000, 999).map((c) => ind.next(c) as SessionLevelsResult)
    let inside = 0
    for (let i = 1; i < rs.length; i++) {
      if (rs[i].inSession !== 1) continue
      for (const condition of ['cu', 'cd', 'gt', 'lt']) {
        const s = { a: 'price', b: 'curMid', condition }
        expect(
          sessionLevelsCondition(rs[i], rs[i - 1], { ...s, active: 'always' }),
        ).to.equal(sessionLevelsCondition(rs[i], rs[i - 1], s))
        inside++
      }
    }
    expect(inside).to.be.greaterThan(1000)
  })
})
