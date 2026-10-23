import { describe, it } from 'mocha'
import { expect } from 'chai'
import {
  isInSession,
  parseSessionTime,
  SessionRuleEnum,
} from '../src/Session/Session'

const WEEKDAYS = [1, 2, 3, 4, 5]
const at = (iso: string) => Date.parse(iso)

describe('isInSession', () => {
  it('keeps the day-only behaviour when no hours are given', () => {
    // 2026-10-23 is a Friday, 2026-10-24 a Saturday.
    expect(isInSession(at('2026-10-23T03:00:00Z'), WEEKDAYS, 'in')).to.equal(
      true,
    )
    expect(isInSession(at('2026-10-24T12:00:00Z'), WEEKDAYS, 'in')).to.equal(
      false,
    )
    expect(isInSession(at('2026-10-24T12:00:00Z'), WEEKDAYS, 'out')).to.equal(
      true,
    )
  })

  it('treats missing, invalid or equal hours as the whole day', () => {
    const ts = at('2026-10-23T23:30:00Z')
    expect(isInSession(ts, WEEKDAYS, 'in', { start: '', end: '' })).to.equal(
      true,
    )
    expect(
      isInSession(ts, WEEKDAYS, 'in', { start: '25:00', end: '10:00' }),
    ).to.equal(true)
    expect(
      isInSession(ts, WEEKDAYS, 'in', { start: '09:00', end: '09:00' }),
    ).to.equal(true)
  })

  it('applies a UTC window with an exclusive end', () => {
    const hours = { start: '08:00', end: '16:30' }
    expect(
      isInSession(at('2026-10-23T07:59:00Z'), WEEKDAYS, 'in', hours),
    ).to.equal(false)
    expect(
      isInSession(at('2026-10-23T08:00:00Z'), WEEKDAYS, 'in', hours),
    ).to.equal(true)
    expect(
      isInSession(at('2026-10-23T16:29:00Z'), WEEKDAYS, 'in', hours),
    ).to.equal(true)
    expect(
      isInSession(at('2026-10-23T16:30:00Z'), WEEKDAYS, 'in', hours),
    ).to.equal(false)
    expect(
      isInSession(
        at('2026-10-23T16:30:00Z'),
        WEEKDAYS,
        SessionRuleEnum.out,
        hours,
      ),
    ).to.equal(true)
  })

  it('follows daylight saving in the session time zone', () => {
    const ny = { start: '09:30', end: '16:00', timezone: 'America/New_York' }
    // Summer (EDT, UTC-4): 09:30 local = 13:30Z.
    expect(
      isInSession(at('2026-07-15T13:30:00Z'), WEEKDAYS, 'in', ny),
    ).to.equal(true)
    expect(
      isInSession(at('2026-07-15T13:29:00Z'), WEEKDAYS, 'in', ny),
    ).to.equal(false)
    // Winter (EST, UTC-5): 09:30 local = 14:30Z.
    expect(
      isInSession(at('2026-01-14T13:30:00Z'), WEEKDAYS, 'in', ny),
    ).to.equal(false)
    expect(
      isInSession(at('2026-01-14T14:30:00Z'), WEEKDAYS, 'in', ny),
    ).to.equal(true)
  })

  it('reads the weekday in the session time zone', () => {
    // Friday 16:00Z is already Saturday 01:00 in Tokyo, and Saturday is
    // not a session day.
    const tokyo = { start: '00:00', end: '23:59', timezone: 'Asia/Tokyo' }
    expect(
      isInSession(at('2026-10-23T16:00:00Z'), WEEKDAYS, 'in', tokyo),
    ).to.equal(false)
  })

  it('gives the after-midnight part of an overnight session to its opening day', () => {
    const overnight = { start: '22:00', end: '06:00' }
    // Friday 23:00 → open (Friday selected).
    expect(
      isInSession(at('2026-10-23T23:00:00Z'), WEEKDAYS, 'in', overnight),
    ).to.equal(true)
    // Saturday 03:00 → still Friday's session.
    expect(
      isInSession(at('2026-10-24T03:00:00Z'), WEEKDAYS, 'in', overnight),
    ).to.equal(true)
    // Monday 03:00 → Sunday's session, Sunday not selected.
    expect(
      isInSession(at('2026-10-26T03:00:00Z'), WEEKDAYS, 'in', overnight),
    ).to.equal(false)
    // Friday 12:00 → between sessions.
    expect(
      isInSession(at('2026-10-23T12:00:00Z'), WEEKDAYS, 'in', overnight),
    ).to.equal(false)
  })

  it('falls back to UTC for an unknown time zone', () => {
    const hours = { start: '08:00', end: '09:00', timezone: 'Not/AZone' }
    expect(
      isInSession(at('2026-10-23T08:30:00Z'), WEEKDAYS, 'in', hours),
    ).to.equal(true)
  })
})

describe('parseSessionTime', () => {
  it('parses HH:MM and rejects anything else', () => {
    expect(parseSessionTime('09:30')).to.equal(570)
    expect(parseSessionTime('0:05')).to.equal(5)
    expect(parseSessionTime('24:00')).to.equal(null)
    expect(parseSessionTime('9')).to.equal(null)
    expect(parseSessionTime(undefined)).to.equal(null)
  })
})
