export enum SessionRuleEnum {
  in = 'in',
  out = 'out',
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

/** Local weekday (0 = Sunday) and minutes after midnight in `timezone`. */
export function zonedDayAndMinutes(
  timestamp: number,
  timezone?: string | null,
): { day: number; minutes: number } {
  const formatter =
    timezone && timezone !== 'UTC' ? formatterFor(timezone) : null
  if (!formatter) {
    const date = new Date(timestamp)
    return {
      day: date.getUTCDay(),
      minutes: date.getUTCHours() * 60 + date.getUTCMinutes(),
    }
  }
  let day = 0
  let hour = 0
  let minute = 0
  for (const part of formatter.formatToParts(timestamp)) {
    if (part.type === 'weekday') day = WEEKDAYS[part.value] ?? 0
    else if (part.type === 'hour') hour = +part.value
    else if (part.type === 'minute') minute = +part.value
  }
  return { day, minutes: hour * 60 + minute }
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
  const start = parseSessionTime(hours?.start)
  const end = parseSessionTime(hours?.end)
  const { day, minutes } = zonedDayAndMinutes(timestamp, hours?.timezone)
  let inside: boolean
  if (start === null || end === null || start === end) {
    inside = days.includes(day)
  } else if (start < end) {
    inside = minutes >= start && minutes < end && days.includes(day)
  } else if (minutes >= start) {
    inside = days.includes(day)
  } else if (minutes < end) {
    inside = days.includes((day + 6) % 7)
  } else {
    inside = false
  }
  return rule === SessionRuleEnum.out ? !inside : inside
}
