import { LightIndicator } from '../util/indicator'
import { lastIndexOfEnum, ohlctValue } from '../util'
import { OHLCT } from '../types/candles'
import { SessionLevelsResult } from '../types/result'
import { gt, gte, lt, lte } from '../util/math'

export enum SessionRuleEnum {
  in = 'in',
  out = 'out',
  /** Price levels: compare two session levels (see `SessionLevels`) */
  levels = 'levels',
}

/** A value a Price levels condition can read (see `sessionLevelValue`). */
export enum SessionLevelEnum {
  /** open of the first candle of the last completed session */
  prevOpen = 'prevOpen',
  /** highest high of the last completed session */
  prevHigh = 'prevHigh',
  /** (prevHigh + prevLow) / 2 */
  prevMid = 'prevMid',
  /** lowest low of the last completed session */
  prevLow = 'prevLow',
  /** close of the last candle of the last completed session */
  prevClose = 'prevClose',
  /** open of the first candle of the session in progress; none outside it */
  curOpen = 'curOpen',
  /**
   * (highest high + lowest low) / 2 of the session in progress so far,
   * including the latest candle; none outside it
   */
  curMid = 'curMid',
  /** close of the latest candle */
  price = 'price',
}

/**
 * Optional time-of-day window for a session. `start` and `end` are local
 * `HH:MM` in `timezone` (an IANA zone, default `UTC`), so a zone with daylight
 * saving keeps the session on its local clock. Missing, invalid or equal
 * `start`/`end` mean the whole day. `end` before `start` is an overnight
 * session: the part after midnight belongs to the day the session opened.
 */
export type SessionHours = {
  start?: string | null
  end?: string | null
  timezone?: string | null
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

const formatters = new Map<string, Intl.DateTimeFormat | null>()

function formatterFor(timezone: string): Intl.DateTimeFormat | null {
  if (!formatters.has(timezone)) {
    try {
      formatters.set(
        timezone,
        new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          weekday: 'short',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }),
      )
    } catch {
      // Unknown zone: fall back to UTC rather than throw inside a bot loop.
      formatters.set(timezone, null)
    }
  }
  return formatters.get(timezone) ?? null
}

/** Minutes after midnight for `HH:MM`, or null when it isn't one. */
export function parseSessionTime(value?: string | null): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim())
  if (!match) return null
  const hours = +match[1]
  const minutes = +match[2]
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Local calendar date, weekday and minutes after midnight. */
type ZonedParts = {
  year: number
  month: number
  date: number
  day: number
  minutes: number
}

function zonedParts(timestamp: number, timezone?: string | null): ZonedParts {
  const formatter =
    timezone && timezone !== 'UTC' ? formatterFor(timezone) : null
  if (!formatter) {
    const date = new Date(timestamp)
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      date: date.getUTCDate(),
      day: date.getUTCDay(),
      minutes: date.getUTCHours() * 60 + date.getUTCMinutes(),
    }
  }
  const out: ZonedParts = { year: 0, month: 0, date: 0, day: 0, minutes: 0 }
  let hour = 0
  let minute = 0
  for (const part of formatter.formatToParts(timestamp)) {
    if (part.type === 'weekday') out.day = WEEKDAYS[part.value] ?? 0
    else if (part.type === 'year') out.year = +part.value
    else if (part.type === 'month') out.month = +part.value
    else if (part.type === 'day') out.date = +part.value
    else if (part.type === 'hour') hour = +part.value
    else if (part.type === 'minute') minute = +part.value
  }
  out.minutes = hour * 60 + minute
  return out
}

/** Local weekday (0 = Sunday) and minutes after midnight in `timezone`. */
export function zonedDayAndMinutes(
  timestamp: number,
  timezone?: string | null,
): { day: number; minutes: number } {
  const { day, minutes } = zonedParts(timestamp, timezone)
  return { day, minutes }
}

/** `yyyymmdd` of a calendar date; `date` may run over the month either way. */
const dateKey = (year: number, month: number, date: number): number => {
  const d = new Date(Date.UTC(year, month - 1, date))
  return (
    d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
  )
}

/**
 * The session `timestamp` belongs to, or null when it is outside the
 * session window. The key is the local calendar date (in the session's time
 * zone) of the day the session opened, as `yyyymmdd`: the after-midnight
 * part of an overnight session carries the key of the day before, and with
 * no time-of-day window every selected day is its own session.
 * @param timestamp - Unix timestamp in milliseconds
 * @param days - Array of day numbers (0=Sunday, 1=Monday, ..., 6=Saturday)
 * @param hours - optional time-of-day window; without it the whole day counts
 */
export function sessionKey(
  timestamp: number,
  days: number[],
  hours?: SessionHours | null,
): number | null {
  const start = parseSessionTime(hours?.start)
  const end = parseSessionTime(hours?.end)
  const { year, month, date, day, minutes } = zonedParts(
    timestamp,
    hours?.timezone,
  )
  let opened = date
  if (start === null || end === null || start === end) {
    if (!days.includes(day)) return null
  } else if (start < end) {
    if (!(minutes >= start && minutes < end && days.includes(day))) return null
  } else if (minutes >= start) {
    if (!days.includes(day)) return null
  } else if (minutes < end) {
    if (!days.includes((day + 6) % 7)) return null
    opened = date - 1
  } else {
    return null
  }
  return dateKey(year, month, opened)
}

/**
 * Checks if a given timestamp falls within the configured session.
 * @param timestamp - Unix timestamp in milliseconds
 * @param days - Array of day numbers (0=Sunday, 1=Monday, ..., 6=Saturday)
 * @param rule - 'in' returns true inside the session, 'out' outside it
 * @param hours - optional time-of-day window; without it the whole day counts
 */
export function isInSession(
  timestamp: number,
  days: number[],
  rule: SessionRuleEnum | string,
  hours?: SessionHours | null,
): boolean {
  const inside = sessionKey(timestamp, days, hours) !== null
  return rule === SessionRuleEnum.out ? !inside : inside
}

enum SessionLevelsState {
  SEEN = 0, // 1 once a candle with a time has been fed
  CUR_KEY = 1, // key of the session in progress, NaN outside one
  CUR_FULL = 2, // 1 when the session in progress was seen from its first candle
  CUR_OPEN = 3,
  CUR_HIGH = 4,
  CUR_LOW = 5,
  CUR_CLOSE = 6,
  PREV_KEY = 7, // key of the last completed session, NaN until there is one
  PREV_OPEN = 8,
  PREV_HIGH = 9,
  PREV_LOW = 10,
  PREV_CLOSE = 11,
}

/**
 * Session price levels
 * Type: Time / Price Level Indicator
 *
 * Groups candles into sessions and reports the open, high, low, close and
 * midpoint of the last completed session, the open and running midpoint of
 * the session in progress and the latest close (see `SessionLevelsResult`).
 *
 * - A candle belongs to a session when its OPEN time is inside the session
 *   window — the same window as `isInSession` with rule `in`: `days`, an
 *   optional local `HH:MM` time-of-day window in an IANA time zone, overnight
 *   sessions belonging to the day they open, and every day its own session
 *   without a time-of-day window.
 * - Two in-session candles are the same session when they have the same
 *   `sessionKey`. A session is completed when a candle arrives outside it
 *   (outside the window, or with a different key); it then becomes the
 *   previous session.
 * - The first session fed is only counted once it is known to be whole: if
 *   the very first candle with a time is already inside a session, that
 *   session may have opened before the data starts, so it never becomes the
 *   previous session (the `prev*` levels stay NaN until the next one ends).
 *   `curOpen` and `curMid` still describe that session as seen so far.
 * - A candle without a usable `time` is not grouped: it updates `price`
 *   only, leaves every session untouched and reports `inSession` 0.
 *
 * Candle Input Type: OHLCT (OHLC + candle open time in ms)
 */
export class SessionLevels extends LightIndicator<SessionLevelsResult, OHLCT> {
  private readonly days: number[]
  private readonly hours: SessionHours | null

  /**
   * @param days - session weekdays (0=Sunday, 1=Monday, ..., 6=Saturday)
   * @param hours - optional time-of-day window; without it the whole day counts
   */
  constructor(days: number[], hours?: SessionHours | null) {
    super(1, ohlctValue, lastIndexOfEnum(SessionLevelsState), NaN)
    this.days = (days ?? []).map(Number)
    this.hours = hours ?? null
    this._state[SessionLevelsState.SEEN] = 0
    this._state[SessionLevelsState.CUR_FULL] = 0
  }

  /** Close the session in progress; a whole one becomes the previous session. */
  private complete() {
    const s = this._state
    if (s[SessionLevelsState.CUR_FULL] === 1) {
      s[SessionLevelsState.PREV_KEY] = s[SessionLevelsState.CUR_KEY]
      s[SessionLevelsState.PREV_OPEN] = s[SessionLevelsState.CUR_OPEN]
      s[SessionLevelsState.PREV_HIGH] = s[SessionLevelsState.CUR_HIGH]
      s[SessionLevelsState.PREV_LOW] = s[SessionLevelsState.CUR_LOW]
      s[SessionLevelsState.PREV_CLOSE] = s[SessionLevelsState.CUR_CLOSE]
    }
    s[SessionLevelsState.CUR_KEY] = NaN
    s[SessionLevelsState.CUR_FULL] = 0
    s[SessionLevelsState.CUR_OPEN] = NaN
    s[SessionLevelsState.CUR_HIGH] = NaN
    s[SessionLevelsState.CUR_LOW] = NaN
    s[SessionLevelsState.CUR_CLOSE] = NaN
  }

  protected calculate(): SessionLevelsResult | null {
    const candle = this._history.last
    const s = this._state
    const time = candle.time
    const timed = typeof time === 'number' && isFinite(time)
    if (timed) {
      const key = sessionKey(time, this.days, this.hours) ?? NaN
      if (!isNaN(key) && key === s[SessionLevelsState.CUR_KEY]) {
        s[SessionLevelsState.CUR_HIGH] = Math.max(
          s[SessionLevelsState.CUR_HIGH],
          candle.high,
        )
        s[SessionLevelsState.CUR_LOW] = Math.min(
          s[SessionLevelsState.CUR_LOW],
          candle.low,
        )
        s[SessionLevelsState.CUR_CLOSE] = candle.close
      } else {
        if (!isNaN(s[SessionLevelsState.CUR_KEY])) {
          this.complete()
        }
        if (!isNaN(key)) {
          s[SessionLevelsState.CUR_KEY] = key
          s[SessionLevelsState.CUR_FULL] = s[SessionLevelsState.SEEN]
          s[SessionLevelsState.CUR_OPEN] = candle.open
          s[SessionLevelsState.CUR_HIGH] = candle.high
          s[SessionLevelsState.CUR_LOW] = candle.low
          s[SessionLevelsState.CUR_CLOSE] = candle.close
        }
      }
      s[SessionLevelsState.SEEN] = 1
    }
    const inSession = timed && !isNaN(s[SessionLevelsState.CUR_KEY])
    const prevHigh = s[SessionLevelsState.PREV_HIGH]
    const prevLow = s[SessionLevelsState.PREV_LOW]
    return {
      prevOpen: s[SessionLevelsState.PREV_OPEN],
      prevHigh,
      prevMid: (prevHigh + prevLow) / 2,
      prevLow,
      prevClose: s[SessionLevelsState.PREV_CLOSE],
      curOpen: inSession ? s[SessionLevelsState.CUR_OPEN] : NaN,
      curMid: inSession
        ? (s[SessionLevelsState.CUR_HIGH] + s[SessionLevelsState.CUR_LOW]) / 2
        : NaN,
      price: candle.close,
      inSession: inSession ? 1 : 0,
      sessionKey: inSession ? s[SessionLevelsState.CUR_KEY] : NaN,
      prevSessionKey: s[SessionLevelsState.PREV_KEY],
    }
  }
}

// Results that went through JSON carry null where the indicator wrote NaN.
const num = (v: number | null | undefined): number =>
  v === null || v === undefined ? NaN : +v

/** The value of `level` in a `SessionLevels` result; NaN when it has none. */
export const sessionLevelValue = (
  result: SessionLevelsResult | null | undefined,
  level: SessionLevelEnum | string,
): number => {
  if (!result) {
    return NaN
  }
  switch (level) {
    case SessionLevelEnum.prevOpen:
      return num(result.prevOpen)
    case SessionLevelEnum.prevHigh:
      return num(result.prevHigh)
    case SessionLevelEnum.prevMid:
      return num(result.prevMid)
    case SessionLevelEnum.prevLow:
      return num(result.prevLow)
    case SessionLevelEnum.prevClose:
      return num(result.prevClose)
    case SessionLevelEnum.curOpen:
      return num(result.curOpen)
    case SessionLevelEnum.curMid:
      return num(result.curMid)
    case SessionLevelEnum.price:
      return num(result.price)
    default:
      return NaN
  }
}

/** On which candles a Price levels condition is evaluated. */
export enum SessionLevelsActiveEnum {
  /** only inside the session (the behaviour before `active` existed) */
  session = 'session',
  /** only outside the session (e.g. the Monday range on the other days) */
  outside = 'outside',
  /** inside and outside the session */
  always = 'always',
}

export type SessionLevelsConditionSettings = {
  /** left operand; missing = price */
  a?: SessionLevelEnum | string
  /** right operand; missing = prevHigh */
  b?: SessionLevelEnum | string
  /** 'cd' | 'cu' | 'gt' | 'lt'; missing = 'cu' */
  condition?: string
  /** where the condition is evaluated; missing / unknown = session */
  active?: SessionLevelsActiveEnum | string | null
}

/** Both keys are the same session, treating "none" (NaN) as equal to "none". */
const sameKey = (a: number, b: number) => a === b || (isNaN(a) && isNaN(b))

const PREV_LEVELS: string[] = [
  SessionLevelEnum.prevOpen,
  SessionLevelEnum.prevHigh,
  SessionLevelEnum.prevMid,
  SessionLevelEnum.prevLow,
  SessionLevelEnum.prevClose,
]

/** One operand is the price and the other a previous-session level. */
const isPriceVsPrevLevel = (a: string, b: string) =>
  (a === SessionLevelEnum.price && PREV_LEVELS.includes(b)) ||
  (b === SessionLevelEnum.price && PREV_LEVELS.includes(a))

/**
 * The bot-condition decision of the Session "Price levels" rule, shared by
 * the live engine and the backtester so both fire on the same bars. `last`
 * is the newest bar, `prev` the one before it (only needed for crossings).
 *
 * - `active` decides where it is evaluated: `session` (missing / unknown)
 *   only on candles inside the session (`last.inSession` is 1), `outside`
 *   only on candles outside it, `always` on both. Elsewhere it is false.
 *   Outside a session the previous-session levels are those of the last
 *   completed session and the current-session levels (`curOpen`, `curMid`)
 *   have no value, so a condition reading them is false there.
 * - False when either operand has no value (NaN / null) or A and B are the
 *   same field.
 * - `gt` / `lt`: A is above / below B on `last`.
 * - `cd` / `cu`: A crossed down / up through B between `prev` and `last`
 *   (touching counts on `last`), and only when both bars see the SAME
 *   previous session and are in the same place: the SAME session, or both
 *   outside any session — the levels jumping because a session started or
 *   ended is not a crossing. A candle without a time counts as outside.
 *   One exception (`outside` / `always` only, since 1.14.0): on the FIRST
 *   candle after a session ends — `prev` inside the session that `last`
 *   now reports as its previous session — a pairing of `price` with a
 *   `prev*` level is a crossing when the two closes are on opposite sides
 *   of the level `last` sees (e.g. the Monday range broken on the first
 *   hour of Tuesday). Any other pairing stays false on that candle.
 */
export const sessionLevelsCondition = (
  last: SessionLevelsResult | null | undefined,
  prev: SessionLevelsResult | null | undefined,
  settings: SessionLevelsConditionSettings,
): boolean => {
  if (!last) {
    return false
  }
  const active = settings.active
  const lastIn = num(last.inSession) === 1
  if (
    active === SessionLevelsActiveEnum.always
      ? false
      : active === SessionLevelsActiveEnum.outside
        ? lastIn
        : !lastIn
  ) {
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
  if (!prev) {
    return false
  }
  if (
    !lastIn &&
    num(prev.inSession) === 1 &&
    !isNaN(num(prev.sessionKey)) &&
    num(prev.sessionKey) === num(last.prevSessionKey) &&
    isPriceVsPrevLevel(a, b)
  ) {
    // The first candle after a session ends (only reachable with `outside`
    // / `always`): `prev` is the session's last candle and that session has
    // just become the previous session, so every `prev*` level jumped
    // between the two bars. Comparing each bar with its own level would
    // either never fire (today's rule) or fire on the jump itself. Instead
    // both closes are compared with the ONE level the newest bar sees: the
    // price side is read from each bar, the level side from `last` only.
    // The jump cannot create a false crossing: the level is constant across
    // the test, and `prev` is a candle of that session, so its close lies
    // within the session's low / high — at or below `prevHigh` and at or
    // above `prevLow` (equal to `prevClose`, so that one never crosses
    // here). A crossing therefore needs the newest close to really move
    // through the completed session's level, as a chart crossover would.
    const prevA = a === SessionLevelEnum.price ? num(prev.price) : lastA
    const prevB = b === SessionLevelEnum.price ? num(prev.price) : lastB
    if (isNaN(prevA) || isNaN(prevB)) {
      return false
    }
    return condition === 'cd'
      ? gt(prevA, prevB) && lte(lastA, lastB)
      : lt(prevA, prevB) && gte(lastA, lastB)
  }
  if (!sameKey(num(prev.prevSessionKey), num(last.prevSessionKey))) {
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
