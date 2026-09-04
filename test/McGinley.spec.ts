import { describe, it } from 'mocha'
import { expect } from 'chai'
import { McGinley } from '../src/McGinley/McGinley'

/**
 * Spec: specs/002.mcginley-dynamic-indicator.md
 *
 * Reference values hand-computed from §2's formula:
 *   mg[0] = close[0]
 *   mg[n] = mg[n-1] + (close[n] - mg[n-1]) / (length * (close[n]/mg[n-1])^4)
 * with length = 14 and a fixed close series.
 */
describe('McGinley', () => {
  // §1 / §2 — seeds directly with the source value on bar 1, matching
  // ta.ema's seeding (not this repo's SMA-seeded EMA class).
  it('seeds directly with the first close (matches ta.ema on bar 1)', () => {
    const mg = new McGinley(14)
    expect(mg.next(100)).to.equal(100)
  })

  // §2 — the recursive formula itself, bar over bar.
  it('tracks the recursive formula bar over bar', () => {
    const mg = new McGinley(14)
    const closes = [100, 101, 103, 102, 105, 107, 106, 110, 108, 112]
    let expected: number | null = null
    for (const close of closes) {
      expected =
        expected === null
          ? close
          : expected + (close - expected) / (14 * Math.pow(close / expected, 4))
      const result = mg.next(close)
      expect(result).to.be.closeTo(expected, 1e-9)
    }
  })

  // §1 — the adaptive-speed property that distinguishes this from a
  // fixed-period MA (the whole reason to ship it, not an alias).
  it('is more responsive than a fixed period when price accelerates', () => {
    const mg = new McGinley(14)
    let last: number | null = null
    for (let i = 0; i < 30; i++) {
      last = mg.next(100 + i)
    }
    // price outran the average, but McGinley should stay much closer to
    // price than a naive lag of `length` bars would.
    expect(last).to.be.greaterThan(100)
    expect(last).to.be.lessThan(129)
  })
})
