import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  SessionLevelEnum,
  SessionLevels,
  SessionRuleEnum,
  sessionKey,
  sessionLevelValue,
  sessionLevelsCondition,
} from '../src/Session/Session'
import { SessionLevelsResult } from '../src/types/result'
import { createIndicator, feedCandle, getWarmupCandles } from '../src/factory'
import { IndicatorEnum } from '../src/types/config'

const at = (iso: string) => Date.parse(iso)
const bar = (
  iso: string,
  open: number,
  high: number,
  low: number,
  close: number,
) => ({
  open,
  high,
  low,
  close,
  time: at(iso),
})
type Bar = ReturnType<typeof bar>
const run = (ind: SessionLevels, bars: Bar[]) =>
  bars.map((b) => ind.next(b) as SessionLevelsResult)
const prev = (r: SessionLevelsResult) => [
  r.prevSessionKey,
  r.prevOpen,
  r.prevHigh,
  r.prevLow,
  r.prevClose,
  r.prevMid,
]
const cur = (r: SessionLevelsResult) => [r.inSession, r.sessionKey, r.curOpen]

const WEEKDAYS = [1, 2, 3, 4, 5]
const NY = 'America/New_York'

describe('sessionKey', () => {
  it('is the local opening date as yyyymmdd, or null outside the window', () => {
    const hours = { start: '08:00', end: '12:00' }
    expect(sessionKey(at('2026-10-23T08:00:00Z'), WEEKDAYS, hours)).to.equal(
      20261023,
    )
    expect(sessionKey(at('2026-10-23T12:00:00Z'), WEEKDAYS, hours)).to.equal(
      null,
    )
    // Saturday is not a session day.
    expect(sessionKey(at('2026-10-24T09:00:00Z'), WEEKDAYS, hours)).to.equal(
      null,
    )
    // Whole day: every selected day is its own session.
    expect(sessionKey(at('2026-10-23T23:59:00Z'), WEEKDAYS)).to.equal(20261023)
  })

  it('gives the after-midnight part of an overnight session the opening date, across a month end', () => {
    // Friday 18:00 → Saturday 02:00 New York, EDT (UTC-4).
    const ny = { start: '18:00', end: '02:00', timezone: NY }
    // 03:00Z on the 31st is still Friday 23:00 local.
    expect(sessionKey(at('2026-10-31T03:00:00Z'), [5], ny)).to.equal(20261030)
    // 05:30Z = Saturday 01:30 local, opened Friday.
    expect(sessionKey(at('2026-10-31T05:30:00Z'), [5], ny)).to.equal(20261030)
    // Saturday's session runs into the DST change (Sunday 02:00 EDT → 01:00
    // EST at 06:00Z): 06:30Z = 01:30 EST, opened Saturday 31 October.
    expect(sessionKey(at('2026-11-01T06:30:00Z'), [6], ny)).to.equal(20261031)
    // 07:00Z = 02:00 EST, the exclusive end.
    expect(sessionKey(at('2026-11-01T07:00:00Z'), [6], ny)).to.equal(null)
  })
})

describe('SessionLevels', () => {
  describe('UTC 08:00–12:00 on weekdays, 1h candles', () => {
    const results = run(
      new SessionLevels(WEEKDAYS, { start: '08:00', end: '12:00' }),
      [
        bar('2026-10-22T07:00:00Z', 10, 11, 9, 10), // 0 Thu, before the session
        bar('2026-10-22T08:00:00Z', 10, 12, 9.5, 11), // 1 opens Thursday
        bar('2026-10-22T09:00:00Z', 11, 15, 10.5, 14), // 2
        bar('2026-10-22T11:00:00Z', 14, 14.5, 8, 9), // 3
        bar('2026-10-22T12:00:00Z', 9, 9.5, 8.5, 9), // 4 closes it
        bar('2026-10-23T08:00:00Z', 20, 21, 19, 20), // 5 opens Friday
        bar('2026-10-23T09:00:00Z', 20, 22, 18, 16), // 6
      ],
    )

    it('has no levels before a session completes', () => {
      expect(cur(results[0])).to.deep.equal([0, NaN, NaN])
      expect(results[0].price).to.equal(10)
      for (let i = 0; i <= 3; i++) {
        expect(
          prev(results[i]).every((v) => isNaN(v)),
          `bar ${i}`,
        ).to.equal(true)
      }
    })

    it('tracks the session in progress', () => {
      expect(cur(results[1])).to.deep.equal([1, 20261022, 10])
      expect(cur(results[3])).to.deep.equal([1, 20261022, 10])
      expect(results[3].price).to.equal(9)
    })

    it('completes the session on the first candle outside it', () => {
      // open 10, high 15, low 8, close 9, mid 11.5
      expect(prev(results[4])).to.deep.equal([20261022, 10, 15, 8, 9, 11.5])
      expect(cur(results[4])).to.deep.equal([0, NaN, NaN])
    })

    it('rolls over to the next session, keeping the previous levels', () => {
      expect(cur(results[5])).to.deep.equal([1, 20261023, 20])
      expect(prev(results[5])).to.deep.equal([20261022, 10, 15, 8, 9, 11.5])
      expect(prev(results[6])).to.deep.equal(prev(results[5]))
      expect(results[6].price).to.equal(16)
    })
  })

  it('does not use a session that was already open when the data starts', () => {
    const results = run(
      new SessionLevels(WEEKDAYS, { start: '08:00', end: '12:00' }),
      [
        bar('2026-10-22T09:00:00Z', 11, 15, 10.5, 14), // mid-session: partial
        bar('2026-10-22T12:00:00Z', 9, 9.5, 8.5, 9),
        bar('2026-10-23T08:00:00Z', 20, 21, 19, 20),
        bar('2026-10-23T09:00:00Z', 20, 22, 18, 16),
        bar('2026-10-23T12:00:00Z', 16, 17, 15, 16.5),
      ],
    )
    expect(cur(results[0])).to.deep.equal([1, 20261022, 11])
    expect(isNaN(results[1].prevHigh)).to.equal(true)
    expect(isNaN(results[3].prevHigh)).to.equal(true)
    expect(prev(results[4])).to.deep.equal([20261023, 20, 22, 18, 16, 20])
  })

  it('gives an overnight session to the day it opens', () => {
    const results = run(
      new SessionLevels([4, 5], { start: '22:00', end: '06:00' }),
      [
        bar('2026-10-22T21:00:00Z', 1, 1, 1, 1), // Thu, before
        bar('2026-10-22T22:00:00Z', 2, 3, 1.5, 2.5), // Thursday's session
        bar('2026-10-23T03:00:00Z', 2.5, 4, 2, 3.5), // Fri 03:00, still Thursday's
        bar('2026-10-23T06:00:00Z', 3.5, 3.6, 3.4, 3.5), // closes it
        bar('2026-10-23T23:00:00Z', 5, 6, 4.5, 5.5), // Friday's session
        bar('2026-10-24T01:00:00Z', 5.5, 7, 5, 6), // Sat 01:00, still Friday's
      ],
    )
    expect(cur(results[1])).to.deep.equal([1, 20261022, 2])
    expect(cur(results[2])).to.deep.equal([1, 20261022, 2])
    expect(prev(results[3])).to.deep.equal([20261022, 2, 4, 1.5, 3.5, 2.75])
    expect(cur(results[3])).to.deep.equal([0, NaN, NaN])
    expect(cur(results[5])).to.deep.equal([1, 20261023, 5])
  })

  it('treats consecutive whole-day sessions as separate sessions', () => {
    const results = run(new SessionLevels([0, 1, 2, 3, 4, 5, 6]), [
      bar('2026-10-21T12:00:00Z', 1, 2, 0.5, 1.5), // Wed, partial
      bar('2026-10-22T00:00:00Z', 2, 3, 1, 2), // Thu
      bar('2026-10-22T12:00:00Z', 2, 5, 1.5, 4),
      bar('2026-10-23T00:00:00Z', 4, 4.5, 3.5, 4.2), // Fri
    ])
    expect(cur(results[1])).to.deep.equal([1, 20261022, 2])
    // Wednesday was partial and is not used.
    expect(isNaN(results[2].prevHigh)).to.equal(true)
    expect(prev(results[3])).to.deep.equal([20261022, 2, 5, 1, 4, 3])
    expect(cur(results[3])).to.deep.equal([1, 20261023, 4])
  })

  it('follows the local session clock across a DST change (New York)', () => {
    const results = run(
      new SessionLevels(WEEKDAYS, {
        start: '09:30',
        end: '16:00',
        timezone: NY,
      }),
      [
        bar('2026-10-30T12:30:00Z', 100, 100, 100, 100), // Fri 08:30 EDT
        bar('2026-10-30T13:30:00Z', 100, 105, 99, 104), // 09:30 EDT opens
        bar('2026-10-30T19:30:00Z', 104, 106, 103, 105), // 15:30 EDT
        bar('2026-10-30T20:30:00Z', 105, 105, 105, 105), // 16:30 EDT closes
        bar('2026-11-02T13:30:00Z', 108, 109, 107, 108), // Mon 08:30 EST: before
        bar('2026-11-02T14:30:00Z', 110, 112, 109, 111), // 09:30 EST opens
        bar('2026-11-02T20:30:00Z', 111, 113, 110, 112), // 15:30 EST
        bar('2026-11-02T21:00:00Z', 112, 112, 112, 112), // 16:00 EST closes
      ],
    )
    expect(cur(results[0])).to.deep.equal([0, NaN, NaN])
    expect(cur(results[1])).to.deep.equal([1, 20261030, 100])
    expect(prev(results[3])).to.deep.equal([20261030, 100, 106, 99, 105, 102.5])
    // 13:30Z was in the session on Friday but is before it after the change.
    expect(cur(results[4])).to.deep.equal([0, NaN, NaN])
    expect(cur(results[5])).to.deep.equal([1, 20261102, 110])
    expect(cur(results[6])).to.deep.equal([1, 20261102, 110])
    expect(prev(results[7])).to.deep.equal([20261102, 110, 113, 109, 112, 111])
  })

  it('does not group a candle without a time', () => {
    const ind = new SessionLevels(WEEKDAYS, { start: '08:00', end: '12:00' })
    run(ind, [
      bar('2026-10-22T07:00:00Z', 10, 11, 9, 10),
      bar('2026-10-22T08:00:00Z', 10, 15, 9.5, 11),
    ])
    const untimed = ind.next({
      open: 11,
      high: 50,
      low: 1,
      close: 30,
      time: NaN,
    })
    expect(cur(untimed as SessionLevelsResult)).to.deep.equal([0, NaN, NaN])
    expect(untimed?.price).to.equal(30)
    const [next, closed] = run(ind, [
      bar('2026-10-22T09:00:00Z', 11, 14, 10, 12),
      bar('2026-10-22T12:00:00Z', 12, 12, 12, 12),
    ])
    // Same session continues; the untimed candle's 50 / 1 never count.
    expect(cur(next)).to.deep.equal([1, 20261022, 10])
    expect(prev(closed)).to.deep.equal([20261022, 10, 15, 9.5, 12, 12.25])
  })

  it('does not count an untimed first candle as seeing the session open', () => {
    const ind = new SessionLevels(WEEKDAYS, { start: '08:00', end: '12:00' })
    ind.next({ open: 1, high: 1, low: 1, close: 1, time: NaN })
    const [, closed] = run(ind, [
      bar('2026-10-22T09:00:00Z', 11, 14, 10, 12),
      bar('2026-10-22T12:00:00Z', 12, 12, 12, 12),
    ])
    expect(isNaN(closed.prevHigh)).to.equal(true)
  })

  it('continues identically after exportState / restoreState, and preview has no side effect', () => {
    const hours = { start: '08:00', end: '12:00' }
    const bars = [
      bar('2026-10-22T07:00:00Z', 10, 11, 9, 10),
      bar('2026-10-22T08:00:00Z', 10, 12, 9.5, 11),
      bar('2026-10-22T09:00:00Z', 11, 15, 10.5, 14),
      bar('2026-10-22T12:00:00Z', 9, 9.5, 8.5, 9),
      bar('2026-10-23T08:00:00Z', 20, 21, 19, 20),
      bar('2026-10-23T09:00:00Z', 20, 22, 18, 16),
      bar('2026-10-23T12:00:00Z', 16, 17, 15, 16.5),
      bar('2026-10-26T08:00:00Z', 30, 31, 29, 30),
    ]
    const a = new SessionLevels(WEEKDAYS, hours)
    const b = new SessionLevels(WEEKDAYS, hours)
    run(a, bars.slice(0, 5))
    run(b, bars.slice(0, 5))
    const state = a.exportState()
    // diverge: close the session and start another, then roll back
    run(a, [
      bar('2026-10-23T12:00:00Z', 1, 99, 0.1, 1),
      bar('2026-10-26T08:00:00Z', 5, 6, 4, 5),
    ])
    a.restoreState(state)
    const p = a.preview(bar('2026-10-23T13:00:00Z', 1, 1, 1, 1))
    expect(p?.inSession).to.equal(0)
    expect(run(a, bars.slice(5))).to.deep.equal(run(b, bars.slice(5)))
  })
})

describe('sessionLevelValue', () => {
  const r: SessionLevelsResult = {
    prevOpen: 1,
    prevHigh: 2,
    prevMid: 3,
    prevLow: 4,
    prevClose: 5,
    curOpen: 6,
    curMid: 6.5,
    price: 7,
    inSession: 1,
    sessionKey: 20261023,
    prevSessionKey: 20261022,
  }

  it('reads every level and NaN for anything else', () => {
    expect(
      Object.values(SessionLevelEnum).map((l) => sessionLevelValue(r, l)),
    ).to.deep.equal([1, 2, 3, 4, 5, 6, 6.5, 7])
    expect(sessionLevelValue(r, 'nope')).to.be.NaN
    expect(sessionLevelValue(null, SessionLevelEnum.price)).to.be.NaN
  })
})

describe('sessionLevelsCondition', () => {
  // previous session high 110, low 90; current session open 102
  const r = (over: Partial<SessionLevelsResult> = {}): SessionLevelsResult => ({
    prevOpen: 100,
    prevHigh: 110,
    prevMid: 100,
    prevLow: 90,
    prevClose: 105,
    curOpen: 102,
    curMid: 103,
    price: 105,
    inSession: 1,
    sessionKey: 20261023,
    prevSessionKey: 20261022,
    ...over,
  })
  const s = (
    condition: string,
    a = SessionLevelEnum.price,
    b = SessionLevelEnum.prevHigh,
  ) => ({
    a,
    b,
    condition,
  })

  it('compares A with B for gt / lt', () => {
    expect(sessionLevelsCondition(r({ price: 111 }), null, s('gt'))).to.equal(
      true,
    )
    expect(sessionLevelsCondition(r({ price: 109 }), null, s('gt'))).to.equal(
      false,
    )
    expect(sessionLevelsCondition(r({ price: 110 }), null, s('gt'))).to.equal(
      false,
    )
    expect(sessionLevelsCondition(r({ price: 109 }), null, s('lt'))).to.equal(
      true,
    )
    expect(
      sessionLevelsCondition(
        r(),
        null,
        s('gt', SessionLevelEnum.curOpen, SessionLevelEnum.prevMid),
      ),
    ).to.equal(true)
  })

  it('detects crossings within one session, touching counts', () => {
    const p = r({ price: 109 })
    expect(sessionLevelsCondition(r({ price: 110 }), p, s('cu'))).to.equal(true)
    expect(sessionLevelsCondition(r({ price: 112 }), p, s('cu'))).to.equal(true)
    expect(sessionLevelsCondition(r({ price: 108 }), p, s('cu'))).to.equal(
      false,
    )
    expect(
      sessionLevelsCondition(r({ price: 112 }), r({ price: 111 }), s('cu')),
    ).to.equal(false)
    expect(
      sessionLevelsCondition(r({ price: 110 }), r({ price: 111 }), s('cd')),
    ).to.equal(true)
    expect(
      sessionLevelsCondition(r({ price: 111 }), r({ price: 112 }), s('cd')),
    ).to.equal(false)
  })

  it('defaults to price crossing up the previous session high', () => {
    expect(
      sessionLevelsCondition(r({ price: 111 }), r({ price: 109 }), {}),
    ).to.equal(true)
  })

  it('never fires outside the session', () => {
    expect(
      sessionLevelsCondition(r({ price: 111, inSession: 0 }), null, s('gt')),
    ).to.equal(false)
    expect(
      sessionLevelsCondition(
        r({ price: 111, inSession: 0 }),
        r({ price: 109 }),
        s('cu'),
      ),
    ).to.equal(false)
  })

  it('is false without a value, for the same field, or for an unknown condition', () => {
    expect(
      sessionLevelsCondition(r({ prevHigh: NaN, price: 111 }), null, s('gt')),
    ).to.equal(false)
    expect(
      sessionLevelsCondition(
        r({ curOpen: NaN }),
        null,
        s('gt', SessionLevelEnum.price, SessionLevelEnum.curOpen),
      ),
    ).to.equal(false)
    expect(
      sessionLevelsCondition(
        r({ price: 111 }),
        r({ price: 109, prevHigh: NaN }),
        s('cu'),
      ),
    ).to.equal(false)
    expect(
      sessionLevelsCondition(
        r(),
        null,
        s('gt', SessionLevelEnum.prevHigh, SessionLevelEnum.prevHigh),
      ),
    ).to.equal(false)
    expect(
      sessionLevelsCondition(
        r(),
        r(),
        s('cu', SessionLevelEnum.price, SessionLevelEnum.price),
      ),
    ).to.equal(false)
    expect(sessionLevelsCondition(r({ price: 111 }), null, s('bw'))).to.equal(
      false,
    )
    expect(
      sessionLevelsCondition(
        r({ price: 111 }),
        null,
        s('gt', SessionLevelEnum.price, 'nope' as never),
      ),
    ).to.equal(false)
    expect(sessionLevelsCondition(null, null, s('gt'))).to.equal(false)
  })

  it('does not count a crossing across a rollover', () => {
    const last = r({ price: 111 })
    // a different current session
    expect(
      sessionLevelsCondition(
        last,
        r({ price: 109, sessionKey: 20261022 }),
        s('cu'),
      ),
    ).to.equal(false)
    // the same current session but a different previous one
    expect(
      sessionLevelsCondition(
        last,
        r({ price: 109, prevSessionKey: 20261021 }),
        s('cu'),
      ),
    ).to.equal(false)
    // the bar before was outside the session
    expect(
      sessionLevelsCondition(
        last,
        r({ price: 109, inSession: 0, sessionKey: NaN }),
        s('cu'),
      ),
    ).to.equal(false)
    expect(sessionLevelsCondition(last, null, s('cu'))).to.equal(false)
  })

  it('crosses within the first session when neither bar has a previous session', () => {
    const none = { prevSessionKey: NaN, prevHigh: NaN }
    expect(
      sessionLevelsCondition(
        r({ ...none, price: 103 }),
        r({ ...none, price: 101 }),
        s('cu', SessionLevelEnum.price, SessionLevelEnum.curOpen),
      ),
    ).to.equal(true)
  })

  it('tolerates results that went through JSON', () => {
    const json = (v: SessionLevelsResult) =>
      JSON.parse(JSON.stringify(v)) as SessionLevelsResult
    const none = { prevSessionKey: NaN, prevHigh: NaN }
    expect(
      sessionLevelsCondition(
        json(r({ price: 111 })),
        json(r({ price: 109 })),
        s('cu'),
      ),
    ).to.equal(true)
    expect(
      sessionLevelsCondition(json(r({ ...none, price: 111 })), null, s('gt')),
    ).to.equal(false)
    expect(
      sessionLevelsCondition(
        json(r({ ...none, price: 103 })),
        json(r({ ...none, price: 101 })),
        s('cu', SessionLevelEnum.price, SessionLevelEnum.curOpen),
      ),
    ).to.equal(true)
    const outside = json(
      r({ price: 111, inSession: 0, curOpen: NaN, sessionKey: NaN }),
    )
    expect(sessionLevelsCondition(outside, null, s('gt'))).to.equal(false)
    expect(
      sessionLevelsCondition(
        { ...r({ price: 111 }), inSession: null } as never,
        null,
        s('gt'),
      ),
    ).to.equal(false)
  })

  it('ignores the level jump of a rollover on real indicator output', () => {
    // Tue is outside the session, so Wednesday's session is whole.
    const results = run(new SessionLevels([3, 4, 5]), [
      bar('2026-10-20T12:00:00Z', 10, 10, 10, 10), // Tue
      bar('2026-10-21T00:00:00Z', 10, 12, 9, 11), // Wed
      bar('2026-10-21T12:00:00Z', 11, 20, 10, 12), // Wed high 20
      bar('2026-10-22T00:00:00Z', 12, 13, 11, 12.5), // Thu: prev high 20
      bar('2026-10-22T12:00:00Z', 12.5, 14, 12, 13), // Thu high 14
      bar('2026-10-23T00:00:00Z', 13, 16, 13, 15), // Fri: prev high 14
      bar('2026-10-23T12:00:00Z', 15, 15, 13, 13.5), // back below 14
    ])
    const fires = (cond: string) =>
      results.map((last, i) =>
        sessionLevelsCondition(last, results[i - 1] ?? null, s(cond)),
      )
    // 13 < 20 then 15 >= 14 is a rollover, not a crossing up.
    expect(fires('cu')).to.deep.equal([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
    expect(fires('gt')).to.deep.equal([
      false,
      false,
      false,
      false,
      false,
      true,
      false,
    ])
    expect(fires('cd')).to.deep.equal([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ])
  })
})

describe('SessionLevels factory registration', () => {
  const config = {
    type: IndicatorEnum.session,
    sessionRule: 'levels',
    sessionDays: WEEKDAYS,
    sessionStart: '08:00',
    sessionEnd: '12:00',
    sessionTimezone: 'UTC',
  } as const

  it('creates an indicator for Price levels only', () => {
    expect(createIndicator(config)).to.be.instanceOf(SessionLevels)
    expect(
      createIndicator({ ...config, sessionRule: SessionRuleEnum.levels }),
    ).to.be.instanceOf(SessionLevels)
    expect(createIndicator({ ...config, sessionRule: 'in' } as never)).to.equal(
      null,
    )
    expect(
      createIndicator({ ...config, sessionRule: 'out' } as never),
    ).to.equal(null)
    expect(createIndicator({ type: IndicatorEnum.session } as never)).to.equal(
      null,
    )
    expect(getWarmupCandles(config)).to.equal(1500)
  })

  it('feeds the candle open time from `t`', () => {
    const ind = createIndicator(config)
    const feed = (
      iso: string | null,
      o: number,
      h: number,
      l: number,
      c: number,
    ) => feedCandle(ind, { o, h, l, c, v: 1, ...(iso ? { t: at(iso) } : {}) })
    feed('2026-10-22T07:00:00Z', 10, 11, 9, 10)
    feed('2026-10-22T08:00:00Z', 10, 15, 9, 11)
    expect(cur(ind.result)).to.deep.equal([1, 20261022, 10])
    feed(null, 11, 11, 11, 11)
    expect(cur(ind.result)).to.deep.equal([0, NaN, NaN])
    expect(ind.result.price).to.equal(11)
    feed('2026-10-22T12:00:00Z', 9, 9, 9, 9)
    expect(prev(ind.result)).to.deep.equal([20261022, 10, 15, 9, 11, 12])
  })
})

describe('SessionLevels current session midpoint (curMid)', () => {
  const hours = { start: '08:00', end: '12:00' }
  // UTC 08:00–12:00 on weekdays, 1h candles
  const bars = [
    bar('2026-10-22T07:00:00Z', 10, 11, 9, 10), // 0 Thu, before the session
    bar('2026-10-22T08:00:00Z', 10, 12, 9.5, 11), // 1 opens: H12 L9.5
    bar('2026-10-22T09:00:00Z', 11, 15, 10.5, 14), // 2 new high: H15 L9.5
    bar('2026-10-22T10:00:00Z', 14, 14.5, 11, 12), // 3 no new extreme
    bar('2026-10-22T11:00:00Z', 12, 13, 8, 9), // 4 new low: H15 L8
    bar('2026-10-22T12:00:00Z', 9, 9.5, 8.5, 9), // 5 closes it
    bar('2026-10-23T08:00:00Z', 20, 21, 19, 20), // 6 opens Friday: H21 L19
    bar('2026-10-23T09:00:00Z', 20, 22, 18, 16), // 7 H22 L18
    bar('2026-10-23T10:00:00Z', 18.5, 21.5, 18.5, 21), // 8 no new extreme
  ]
  const mids = (results: SessionLevelsResult[]) => results.map((r) => r.curMid)

  it('is the running (high + low) / 2 of the session in progress, NaN outside', () => {
    const results = run(new SessionLevels(WEEKDAYS, hours), bars)
    expect(mids(results)).to.deep.equal([
      NaN,
      10.75, // (12 + 9.5) / 2
      12.25, // (15 + 9.5) / 2 — moves on the new high
      12.25, // unchanged
      11.5, // (15 + 8) / 2 — moves on the new low
      NaN, // outside
      20, // (21 + 19) / 2 — reset: Thursday's 15 / 8 do not carry over
      20, // (22 + 18) / 2
      20,
    ])
    // Thursday's completed session is unaffected: mid of 15 / 8.
    expect(results[6].prevMid).to.equal(11.5)
  })

  it('reads through sessionLevelValue', () => {
    const results = run(new SessionLevels(WEEKDAYS, hours), bars.slice(0, 3))
    expect(sessionLevelValue(results[2], SessionLevelEnum.curMid)).to.equal(
      12.25,
    )
    expect(sessionLevelValue(results[0], SessionLevelEnum.curMid)).to.be.NaN
    const json = JSON.parse(JSON.stringify(results[0])) as SessionLevelsResult
    expect(sessionLevelValue(json, SessionLevelEnum.curMid)).to.be.NaN
  })

  it('describes a session already open when the data starts, as seen so far', () => {
    const results = run(new SessionLevels(WEEKDAYS, hours), bars.slice(2, 6))
    // first timed candle at 09:00 is inside: H15 L10.5, then L8
    expect(mids(results)).to.deep.equal([12.75, 12.75, 11.5, NaN])
    // ...but that partial session never becomes the previous session
    expect(isNaN(results[3].prevMid)).to.equal(true)
  })

  it('is NaN on a candle without a time, whose extremes never count', () => {
    const ind = new SessionLevels(WEEKDAYS, hours)
    run(ind, bars.slice(0, 2))
    const untimed = ind.next({
      open: 11,
      high: 50,
      low: 1,
      close: 30,
      time: NaN,
    }) as SessionLevelsResult
    expect(untimed.curMid).to.be.NaN
    const [next] = run(ind, [bars[2]])
    expect(next.curMid).to.equal(12.25)
  })

  it('counts price crossing the moving midpoint within a session', () => {
    const results = run(new SessionLevels(WEEKDAYS, hours), bars)
    const fires = (cond: string) =>
      results.map((last, i) =>
        sessionLevelsCondition(last, results[i - 1] ?? null, {
          a: SessionLevelEnum.price,
          b: SessionLevelEnum.curMid,
          condition: cond,
        }),
      )
    // price vs curMid: 11 > 10.75, 14 > 12.25, 12 < 12.25, 9 < 11.5 | out |
    // 20 = 20 (first bar of the session), 16 < 20, 21 > 20
    expect(fires('cd')).to.deep.equal([
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ])
    expect(fires('cu')).to.deep.equal([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ])
    expect(fires('gt')).to.deep.equal([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
    ])
  })

  it('does not count a crossing across a rollover', () => {
    // Whole-day sessions Wed–Fri; Tuesday is outside, so Wednesday is whole.
    const results = run(new SessionLevels([3, 4, 5]), [
      bar('2026-10-20T12:00:00Z', 10, 10, 10, 10), // Tue, outside
      bar('2026-10-21T00:00:00Z', 10, 12, 9, 11), // Wed: mid 10.5, price above
      bar('2026-10-21T12:00:00Z', 11, 20, 10, 12), // H20 L9: mid 14.5, below
      bar('2026-10-22T00:00:00Z', 12, 13, 11, 12.5), // Thu: mid 12, price above
      bar('2026-10-22T12:00:00Z', 12.5, 14, 12, 12.2), // H14 L11: 12.5, below
    ])
    expect(mids(results)).to.deep.equal([NaN, 10.5, 14.5, 12, 12.5])
    const fires = (cond: string) =>
      results.map((last, i) =>
        sessionLevelsCondition(last, results[i - 1] ?? null, {
          a: SessionLevelEnum.price,
          b: SessionLevelEnum.curMid,
          condition: cond,
        }),
      )
    // 12 < 14.5 then 12.5 >= 12 is the new session's midpoint, not a crossing.
    expect(fires('cu')).to.deep.equal([false, false, false, false, false])
    // Thursday's midpoint rising through price is a crossing down.
    expect(fires('cd')).to.deep.equal([false, false, true, false, true])
  })

  it('continues identically after exportState / restoreState', () => {
    const a = new SessionLevels(WEEKDAYS, hours)
    const b = new SessionLevels(WEEKDAYS, hours)
    run(a, bars.slice(0, 3))
    run(b, bars.slice(0, 3))
    const state = a.exportState()
    // diverge inside the same session with new extremes, then roll back
    const [diverged] = run(a, [bar('2026-10-22T10:00:00Z', 1, 99, 0.1, 1)])
    expect(diverged.curMid).to.equal(49.55)
    a.restoreState(state)
    const p = a.preview(bar('2026-10-22T10:00:00Z', 1, 99, 0.1, 1))
    expect(p?.curMid).to.equal(49.55)
    // a fresh instance restored from the same state continues the same way
    const c = new SessionLevels(WEEKDAYS, hours)
    c.restoreState(state)
    const expected = run(b, bars.slice(3))
    expect(mids(expected)).to.deep.equal([12.25, 11.5, NaN, 20, 20, 20])
    expect(run(a, bars.slice(3))).to.deep.equal(expected)
    expect(run(c, bars.slice(3))).to.deep.equal(expected)
  })
})
