import { gt, gte, lt, lte } from './math'

/**
 * A number read from an indicator result that may have gone through JSON:
 * `null` / `undefined` (JSON turns NaN into null; missing keys are undefined)
 * become NaN, anything else is coerced with `+`.
 */
export const resultNumber = (v: number | null | undefined): number =>
  v === null || v === undefined ? NaN : +v

/**
 * The generic two-line comparison of the bot engine's indicator conditions,
 * shared by the new indicators' decisions so they fire exactly where the
 * engine's value / band / Stochastic comparisons fire.
 *
 * `last` / `prev` are the indicator side (e.g. the close, or %K) on the newest
 * and the previous bar, `value` / `prevValue` the line it is compared with
 * (a band, %D, a level) on the same two bars. `condition` is the bot's
 * `indicatorCondition`:
 *
 * - `gt`: `last` above `value`; `lt`: `last` below `value` (`prev` unused).
 * - `cu` (crossing up): `last` above `value` now, and `prev` at or below
 *   `prevValue` before. `cd` (crossing down): `last` below `value` now, and
 *   `prev` at or above `prevValue` before. Touching counts on the previous
 *   bar, not on the newest one — exactly the engine's
 *   `(lt(value, last) && gte(prevValue, prev))` /
 *   `(gt(value, last) && lte(prevValue, prev))`.
 * - anything else: false.
 *
 * Comparisons use the package's epsilon helpers (`gt`/`lt`/`gte`/`lte`), and
 * every comparison with NaN is false, so a missing value never fires.
 */
export const lineCondition = (
  condition: string | null | undefined,
  last: number,
  value: number,
  prev: number = NaN,
  prevValue: number = NaN,
): boolean => {
  switch (condition) {
    case 'gt':
      return gt(last, value)
    case 'lt':
      return lt(last, value)
    case 'cu':
      return lt(value, last) && gte(prevValue, prev)
    case 'cd':
      return gt(value, last) && lte(prevValue, prev)
    default:
      return false
  }
}
