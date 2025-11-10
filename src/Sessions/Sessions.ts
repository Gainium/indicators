import { LightIndicator, LightIndicatorState } from '../util/indicator'
import { SessionsResult } from '../types/result'
import { OHLCT } from '../types/candles'
import { ohlctValue, lastIndexOfEnum } from '../util'

// Define state indices for performance and readability
enum SessionsState {
  IN_SESSION = 0, // Boolean (1.0 = true, 0.0 = false) - Currently in session
  SESSION_HIGH = 1, // Current session high value
  SESSION_LOW = 2, // Current session low value
}

// Day configuration for each day of the week
interface DayConfig {
  enabled: boolean
  startMinutes: number // 0-1439 (minutes from midnight)
  endMinutes: number // 0-1439 (minutes from midnight)
}

/**
 * Sessions Indicator
 *
 * Tracks whether current time is within user-configured trading sessions
 * based on day of week and time ranges. Each day can have its own enable/disable
 * setting and start/end times.
 *
 * Supports midnight crossover (e.g., 22:00-02:00).
 * All times are in UTC.
 */
export class Sessions extends LightIndicator<SessionsResult, OHLCT> {
  // Configuration for each day (Sunday=0 through Saturday=6)
  private readonly dayConfigs: DayConfig[]

  /**
   * Constructs a Sessions indicator.
   *
   * @param enableSunday Enable trading on Sunday
   * @param sundayStart Sunday session start time "HH:MM" (UTC)
   * @param sundayEnd Sunday session end time "HH:MM" (UTC)
   * @param enableMonday Enable trading on Monday
   * @param mondayStart Monday session start time "HH:MM" (UTC)
   * @param mondayEnd Monday session end time "HH:MM" (UTC)
   * @param enableTuesday Enable trading on Tuesday
   * @param tuesdayStart Tuesday session start time "HH:MM" (UTC)
   * @param tuesdayEnd Tuesday session end time "HH:MM" (UTC)
   * @param enableWednesday Enable trading on Wednesday
   * @param wednesdayStart Wednesday session start time "HH:MM" (UTC)
   * @param wednesdayEnd Wednesday session end time "HH:MM" (UTC)
   * @param enableThursday Enable trading on Thursday
   * @param thursdayStart Thursday session start time "HH:MM" (UTC)
   * @param thursdayEnd Thursday session end time "HH:MM" (UTC)
   * @param enableFriday Enable trading on Friday
   * @param fridayStart Friday session start time "HH:MM" (UTC)
   * @param fridayEnd Friday session end time "HH:MM" (UTC)
   * @param enableSaturday Enable trading on Saturday
   * @param saturdayStart Saturday session start time "HH:MM" (UTC)
   * @param saturdayEnd Saturday session end time "HH:MM" (UTC)
   */
  constructor(
    public readonly enableSunday: boolean,
    public readonly sundayStart: string,
    public readonly sundayEnd: string,
    public readonly enableMonday: boolean,
    public readonly mondayStart: string,
    public readonly mondayEnd: string,
    public readonly enableTuesday: boolean,
    public readonly tuesdayStart: string,
    public readonly tuesdayEnd: string,
    public readonly enableWednesday: boolean,
    public readonly wednesdayStart: string,
    public readonly wednesdayEnd: string,
    public readonly enableThursday: boolean,
    public readonly thursdayStart: string,
    public readonly thursdayEnd: string,
    public readonly enableFriday: boolean,
    public readonly fridayStart: string,
    public readonly fridayEnd: string,
    public readonly enableSaturday: boolean,
    public readonly saturdayStart: string,
    public readonly saturdayEnd: string,
  ) {
    // Initialize with history size of 1 (only need current candle)
    // State size: lastIndexOfEnum gives us the highest enum value
    super(1, ohlctValue, lastIndexOfEnum(SessionsState), NaN)

    // Initialize day configs array (Sunday=0 through Saturday=6)
    this.dayConfigs = [
      {
        enabled: enableSunday,
        startMinutes: this.parseTimeToMinutes(sundayStart),
        endMinutes: this.parseTimeToMinutes(sundayEnd),
      },
      {
        enabled: enableMonday,
        startMinutes: this.parseTimeToMinutes(mondayStart),
        endMinutes: this.parseTimeToMinutes(mondayEnd),
      },
      {
        enabled: enableTuesday,
        startMinutes: this.parseTimeToMinutes(tuesdayStart),
        endMinutes: this.parseTimeToMinutes(tuesdayEnd),
      },
      {
        enabled: enableWednesday,
        startMinutes: this.parseTimeToMinutes(wednesdayStart),
        endMinutes: this.parseTimeToMinutes(wednesdayEnd),
      },
      {
        enabled: enableThursday,
        startMinutes: this.parseTimeToMinutes(thursdayStart),
        endMinutes: this.parseTimeToMinutes(thursdayEnd),
      },
      {
        enabled: enableFriday,
        startMinutes: this.parseTimeToMinutes(fridayStart),
        endMinutes: this.parseTimeToMinutes(fridayEnd),
      },
      {
        enabled: enableSaturday,
        startMinutes: this.parseTimeToMinutes(saturdayStart),
        endMinutes: this.parseTimeToMinutes(saturdayEnd),
      },
    ]

    // Initialize state with default values
    this._state[SessionsState.IN_SESSION] = 0
    this._state[SessionsState.SESSION_HIGH] = NaN
    this._state[SessionsState.SESSION_LOW] = NaN
  }

  /**
   * Parse time string "HH:MM" to minutes since midnight
   * @param timeStr Time string in format "HH:MM"
   * @returns Minutes since midnight (0-1439)
   */
  private parseTimeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number)
    return hours * 60 + minutes
  }

  /**
   * Check if current time is within session range
   * Handles midnight crossover (e.g., 22:00-02:00)
   * @param currentMinutes Current time in minutes since midnight
   * @param startMinutes Session start time in minutes
   * @param endMinutes Session end time in minutes
   * @returns True if current time is in range
   */
  private isTimeInRange(
    currentMinutes: number,
    startMinutes: number,
    endMinutes: number,
  ): boolean {
    if (startMinutes <= endMinutes) {
      // Normal range: e.g., 09:00 (540) to 17:00 (1020)
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes
    } else {
      // Crosses midnight: e.g., 22:00 (1320) to 02:00 (120)
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes
    }
  }

  /**
   * Calculate session status and high/low levels
   */
  protected calculate(): SessionsResult | null {
    const s = this._state
    const candle = this._history.last

    // Get timestamp from candle and convert to UTC date components
    const date = new Date(candle.timestamp)
    const dayOfWeek = date.getUTCDay() // 0-6 (0=Sunday)
    const currentMinutes = date.getUTCHours() * 60 + date.getUTCMinutes()

    // Get configuration for current day
    const dayConfig = this.dayConfigs[dayOfWeek]

    // Store previous session state
    const prevInSession = s[SessionsState.IN_SESSION] === 1

    // Check if currently in session
    const inSession =
      dayConfig.enabled &&
      this.isTimeInRange(
        currentMinutes,
        dayConfig.startMinutes,
        dayConfig.endMinutes,
      )

    // Update session state
    s[SessionsState.IN_SESSION] = inSession ? 1 : 0

    // Handle session start (transition from out-of-session to in-session)
    if (inSession && !prevInSession) {
      s[SessionsState.SESSION_HIGH] = candle.high
      s[SessionsState.SESSION_LOW] = candle.low
    }

    // Update session high/low if in session
    if (inSession) {
      if (
        isNaN(s[SessionsState.SESSION_HIGH]) ||
        candle.high > s[SessionsState.SESSION_HIGH]
      ) {
        s[SessionsState.SESSION_HIGH] = candle.high
      }
      if (
        isNaN(s[SessionsState.SESSION_LOW]) ||
        candle.low < s[SessionsState.SESSION_LOW]
      ) {
        s[SessionsState.SESSION_LOW] = candle.low
      }
    }

    // Always return a result (indicator is always stable)
    return {
      inSession: inSession,
      sessionHigh: s[SessionsState.SESSION_HIGH],
      sessionLow: s[SessionsState.SESSION_LOW],
      price: candle.close,
    }
  }

  /**
   * Export the state of the indicator
   */
  override exportState(): LightIndicatorState {
    return {
      parent: super.exportState(),
      circ: [],
      bin: [],
    }
  }

  /**
   * Restore the state of the indicator
   */
  override restoreState(state: LightIndicatorState): void {
    if (!state.parent) {
      throw new Error('Invalid state: parent state is missing')
    }

    // Restore parent state
    super.restoreState(state.parent)
  }
}
