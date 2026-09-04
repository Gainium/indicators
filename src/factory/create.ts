/**
 * createIndicator — maps an `IndicatorConfig` to a constructed indicator
 * instance. Previously duplicated as a ~400-line switch inside the main
 * app's indicator service; this is the single source of truth.
 *
 * The returned value is typed as `any` at the boundary because each
 * indicator type has its own generic result type and exposing that here
 * would force callers to narrow by the discriminant themselves. Callers
 * that care about the exact result type should branch on `config.type` and
 * treat the returned instance accordingly.
 */

import {
  ADR,
  ADX,
  AO,
  ATH,
  ATR,
  BBPB,
  BBWP,
  BollingerBands,
  BollingerBandsWidth,
  BullBear,
  CCI,
  DEMA,
  DIV,
  DIVUsableOscillators,
  DonchianChannels,
  ECD,
  EMA,
  HMA,
  IchimokuCloud,
  KeltnerChannel,
  KeltnerChannelPB,
  LongWick,
  MACD,
  MAR,
  McGinley,
  MFI,
  MOM,
  OBFVG,
  PC,
  PSAR,
  PriorPivot,
  QFL,
  RMA,
  RSI,
  SMA,
  StochasticOscillator,
  StochasticRSI,
  SuperTrend,
  SupportResistance,
  TEMA,
  TVTA,
  UltimateOscillator,
  VO,
  VWMA,
  WMA,
  WilliamsR,
} from '../index'
import {
  IndicatorConfig,
  IndicatorEnum,
  MAEnum,
  RangeType,
} from '../types/config'

/**
 * Constructs the indicator described by `config`. Returns `null` if the
 * `config.type` isn't wired yet (e.g. the `sr`/`tv`/`qfl` variants are
 * internally supported but not reachable from every config surface).
 */

export function createIndicator(config: IndicatorConfig): any {
  switch (config.type) {
    case IndicatorEnum.st:
      return new SuperTrend(config.factor, config.atrLength)

    case IndicatorEnum.dc:
      return new DonchianChannels(config.length)

    case IndicatorEnum.pp:
      return new PriorPivot(
        config.ppHighLeft,
        config.ppHighRight,
        config.ppLowLeft,
        config.ppLowRight,
        config.ppMult,
      )

    case IndicatorEnum.pc:
      return new PC(config.pcUp, config.pcDown)

    case IndicatorEnum.rsi:
      return new RSI(
        config.interval,
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
      )

    case IndicatorEnum.atr:
      return new ATR(config.interval)

    case IndicatorEnum.adr:
      return new ADR(config.interval)

    case IndicatorEnum.ecd:
      return new ECD()

    case IndicatorEnum.ath:
      return new ATH(config.lookback)

    case IndicatorEnum.vo:
      return new VO(
        config.voShort,
        config.voLong,
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
      )

    case IndicatorEnum.psar:
      return new PSAR(config.start, config.inc, config.max)

    case IndicatorEnum.div:
      return new DIV(
        config.oscillators.map((v) =>
          v.toLowerCase(),
        ) as DIVUsableOscillators[],
        config.leftBars ?? 3,
        config.rightBars ?? 1,
        config.rangeLower ?? 1,
        config.rangeUpper ?? 60,
      )

    case IndicatorEnum.mom:
      return new MOM(
        config.interval,

        // @ts-ignore — MOM accepts a source string (e.g. 'close'/'hlc3').
        config.source,
        config.percentile,
        config.percentileLookback,
        config.percentilePercentage,
      )

    case IndicatorEnum.mar:
      return new MAR(
        config.mar1type,
        config.mar1length,
        config.mar2type,
        config.mar2length,
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
        config.trendFilter,
        config.trendFilterLookback,
        config.trendFilterValue,
        config.trendFilterType,
      )

    case IndicatorEnum.mfi:
      return new MFI(
        config.interval,
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
      )

    case IndicatorEnum.adx:
      return new ADX(
        config.interval,
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
      )

    case IndicatorEnum.bbw: {
      const bb = new BollingerBands(
        config.interval,
        config.bbwMult ?? 2,
        config.bbwMa ?? MAEnum.sma,
        config.bbwMaLength ?? 20,
      )
      return new BollingerBandsWidth(
        bb,
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
      )
    }

    case IndicatorEnum.bbpb: {
      const bb = new BollingerBands(
        config.interval,
        config.bbwMult ?? 2,
        config.bbwMa ?? MAEnum.sma,
        config.bbwMaLength ?? 20,
      )
      return new BBPB(
        bb,
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
      )
    }

    case IndicatorEnum.kcpb: {
      const kc = new KeltnerChannel(
        config.interval,
        config.multiplier ?? 2,
        config.ma ?? MAEnum.ema,
        config.range ?? RangeType.atr,
        config.rangeLength ?? 10,
      )
      return new KeltnerChannelPB(
        kc,
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
      )
    }

    case IndicatorEnum.kc:
      return new KeltnerChannel(
        config.interval,
        config.multiplier ?? 2,
        config.ma ?? MAEnum.ema,
        config.range ?? RangeType.atr,
        config.rangeLength ?? 10,
      )

    case IndicatorEnum.bbwp: {
      const bb = new BollingerBands(config.interval, 1, MAEnum.sma, 20)
      return new BBWP(bb, config.lookback)
    }

    case IndicatorEnum.bb:
      return new BollingerBands(
        config.interval,
        config.bbwMult ?? 2,
        config.bbwMa ?? MAEnum.sma,
        config.bbwMaLength ?? 20,
      )

    case IndicatorEnum.macd: {
      const MaSource = config.maSource === MAEnum.sma ? SMA : EMA
      const MaSignal = config.maSignal === MAEnum.sma ? SMA : EMA
      return new MACD(
        new MaSource(config.shortInterval),
        new MaSource(config.longInterval),
        new MaSignal(config.signalInterval),
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
      )
    }

    case IndicatorEnum.stoch:
      return new StochasticOscillator(config.k, config.ksmooth, config.dsmooth)

    case IndicatorEnum.cci:
      return new CCI(
        config.interval,
        'hlc3',
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
      )

    case IndicatorEnum.ao:
      return new AO(
        5,
        34,
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
      )

    case IndicatorEnum.stochRSI:
      return new StochasticRSI(
        config.interval,
        config.k,
        config.ksmooth,
        config.dsmooth,
      )

    case IndicatorEnum.wr:
      return new WilliamsR(
        config.interval,
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
      )

    case IndicatorEnum.bullBear:
      return new BullBear(config.interval)

    case IndicatorEnum.uo:
      return new UltimateOscillator(
        config.fast,
        config.middle,
        config.slow,
        config.percentile,
        +(config.percentileLookback ?? '0'),
        +(config.percentilePercentage ?? '0'),
      )

    case IndicatorEnum.ic:
      return new IchimokuCloud(
        config.conversionPeriods,
        config.basePeriods,
        config.laggingSpan2Periods,
        config.laggingSpan,
      )

    case IndicatorEnum.ma:
      switch (config.maType) {
        case MAEnum.ema:
          return new EMA(config.interval)
        case MAEnum.sma:
          return new SMA(config.interval)
        case MAEnum.wma:
          return new WMA(config.interval)
        case MAEnum.hma:
          return new HMA(config.interval)
        case MAEnum.vwma:
          return new VWMA(config.interval)
        case MAEnum.dema:
          return new DEMA(config.interval)
        case MAEnum.tema:
          return new TEMA(config.interval)
        case MAEnum.rma:
          return new RMA(config.interval)
        default:
          return null
      }

    case IndicatorEnum.tv:
      return new TVTA(config.checkLevel, config.useAsEntryExitPoints)

    case IndicatorEnum.sr:
      return new SupportResistance(config.leftBars, config.rightBars)

    case IndicatorEnum.qfl:
      return new QFL(
        config.basePeriods,
        config.pumpPeriods,
        config.pump,
        config.baseCrack,
      )

    case IndicatorEnum.obfvg:
      return new OBFVG()

    case IndicatorEnum.lw:
      return new LongWick(config.lwThreshold ?? 2, config.lwMaxDuration ?? 1000)

    case IndicatorEnum.mg:
      return new McGinley(config.mgLength ?? 14)

    default:
      return null
  }
}
