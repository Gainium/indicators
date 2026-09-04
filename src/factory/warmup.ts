/**
 * getWarmupCandles — returns the minimum number of historical candles an
 * indicator config needs before its `result` is trustworthy. Previously
 * computed inline in the indicator service's constructor; lifted here so
 * the archive service (and any other consumer that wants to pin-point-
 * evaluate) uses the same numbers.
 *
 * Values match the service's `this.length = …` assignments exactly.
 */

import { IndicatorConfig, IndicatorEnum, MAEnum } from '../types/config'

export function getWarmupCandles(config: IndicatorConfig): number {
  // Helpers to keep the switch compact.
  const pct = (c: { percentileLookback?: number }): number =>
    +(c.percentileLookback ?? '0')

  const pctExtra = (c: {
    percentile?: boolean
    percentileLookback?: number
  }): number => (c.percentile ? pct(c) : 0)

  switch (config.type) {
    case IndicatorEnum.st:
      return 750
    case IndicatorEnum.dc:
      return config.length + 1
    case IndicatorEnum.pp:
      return (
        Math.max(
          config.ppHighLeft + config.ppHighRight,
          config.ppLowLeft + config.ppLowRight,
          1000,
        ) + 1
      )
    case IndicatorEnum.pc:
      return 1
    case IndicatorEnum.rsi:
    case IndicatorEnum.adx:
    case IndicatorEnum.wr:
    case IndicatorEnum.cci:
    case IndicatorEnum.mfi:
      return config.interval + pctExtra(config)
    case IndicatorEnum.atr:
    case IndicatorEnum.adr:
    case IndicatorEnum.bullBear:
      return config.interval
    case IndicatorEnum.ecd:
      return 2
    case IndicatorEnum.ath:
      return config.lookback + 1
    case IndicatorEnum.vo:
      return config.voLong + pctExtra(config)
    case IndicatorEnum.psar:
      return 100
    case IndicatorEnum.div:
      return 200
    case IndicatorEnum.mom:
      return Math.max(config.interval + pctExtra(config), 100)
    case IndicatorEnum.mar:
      return Math.max(config.mar1length, config.mar2length) + pctExtra(config)
    case IndicatorEnum.bbw:
    case IndicatorEnum.bbpb: {
      const maMult =
        config.bbwMa === MAEnum.tema ? 3 : config.bbwMa === MAEnum.dema ? 2 : 1
      return (
        config.interval + (config.bbwMaLength ?? 0) * maMult + pctExtra(config)
      )
    }
    case IndicatorEnum.kcpb:
    case IndicatorEnum.kc:
      return (
        config.interval +
        (config.rangeLength ?? 10) +
        (config.type === IndicatorEnum.kcpb ? pctExtra(config) : 1)
      )
    case IndicatorEnum.bbwp:
      return config.interval + config.lookback
    case IndicatorEnum.bb: {
      const maMult =
        config.bbwMa === MAEnum.tema ? 3 : config.bbwMa === MAEnum.dema ? 2 : 1
      return config.interval + (config.bbwMaLength ?? 0) * maMult
    }
    case IndicatorEnum.macd:
      return (
        Math.max(config.longInterval + config.shortInterval) +
        config.signalInterval +
        pctExtra(config)
      )
    case IndicatorEnum.stoch:
      return config.k + config.ksmooth + config.dsmooth
    case IndicatorEnum.ao:
      return 34 + pctExtra(config)
    case IndicatorEnum.stochRSI:
      return config.interval + config.k + config.ksmooth + config.dsmooth
    case IndicatorEnum.uo:
      return (
        Math.max(config.fast, config.middle, config.slow) + pctExtra(config)
      )
    case IndicatorEnum.ic:
      return Math.max(
        config.conversionPeriods,
        config.basePeriods,
        config.laggingSpan2Periods,
        config.laggingSpan,
      )
    case IndicatorEnum.ma: {
      const mult =
        config.maType === MAEnum.tema
          ? 3
          : config.maType === MAEnum.dema
            ? 2
            : 1
      return mult * config.interval + 300
    }
    case IndicatorEnum.tv:
      return 3000
    case IndicatorEnum.sr:
      return config.leftBars + config.rightBars
    case IndicatorEnum.qfl:
      return config.basePeriods + config.pumpPeriods
    case IndicatorEnum.obfvg:
      return 1000
    case IndicatorEnum.lw:
      return 201
    case IndicatorEnum.mg:
      return config.interval + 100
    default:
      // Types that have no explicit warmup in the source service fall
      // through to a generous default. Callers may still fetch more
      // candles than needed with no harm.
      return 500
  }
}
