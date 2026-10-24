---
name: new-indicator-integration-indicators
description: This repo's slice of adding a brand-new indicator to Gainium — the LightIndicator subclass (or pure function for a time filter) and its mandatory factory registration. Everything else on the platform reaches the math through this factory. Use when scoping or implementing a new-indicator PR in indicators.
---

# New indicator integration — indicators' part

Canonical source: `new-indicator-integration` in Gainium's internal
`skills` repo (private — this file is a scoped copy synced from there; edit
the source, not this copy, if it needs updating).

## Global objective

Gainium's indicator math is written **once**, here, and consumed four
times: main-app's bot engine, the backtester, market-archive's historical
RPC, and the dashboard chart study. Three of those four reach it through
this repo's **factory** — so a normal indicator, correctly registered here,
is nearly zero-code everywhere except the backtester and the chart.

## This repo's part

First decide **indicator vs. filter** (this should already be decided by
whoever scoped the integration — confirm before writing code):

**Normal indicator** — extend `LightIndicator<ResultType, InputType>` and
implement `calculate()`. State lives in a `Float64Array` indexed by an
enum. Input type is one of `number`, `HL`, `HLC`, `OHLC`, `OHLCV` — pick
what the math needs. Return your result type once stable, `null` during
warmup. If you hold a child indicator or extra buffers, override
`exportState()`/`restoreState()` to serialize them.

Then register in the factory — **defining + exporting the class is not
enough**:

| File | What to add |
|---|---|
| `src/<Name>/<Name>.ts` | the `LightIndicator` subclass |
| `src/types/result.ts` | `export type <Name>Result = { … }` |
| `src/types/config.ts` → `IndicatorEnum` | enum entry, e.g. `lw = 'LW'` |
| `src/types/config.ts` → `IndicatorConfig` union | discriminated member |
| `src/factory/create.ts` | import the class + `case IndicatorEnum.<x>: return new <Class>(…)` |
| `src/factory/warmup.ts` | `case IndicatorEnum.<x>: return <N>` — candles needed before the result is trustworthy |
| `src/factory/feed.ts` | **always** — add the class to the `instanceof` list of its input shape. Dispatch is per class: a class missing here makes `feedCandle()` a silent no-op |
| `src/index.ts` | `export * from './<Name>/<Name>'` |
| `test/<name>.spec.ts` | hand-traced candle scenarios, warmup, `exportState`/`restoreState` round trip, factory create/warmup/feed |
| `package.json` + `CHANGELOG.md` | bump version, changelog line |

> **Forgetting the factory is the #1 footgun**: the class compiles and
> exports, but `createIndicator()` never returns it (or `feedCandle()`
> never feeds it), so main-app and market-archive silently can't use it.

**Recommended: export the bot-condition decision too.** main-app and the
backtester each implement every condition's decision separately. For a new
indicator, export it from here as a pure `(last, prev, settings) =>
boolean` (tolerating `null` where JSON turned `NaN` into `null`) and have
both call it — see `oteCondition` in `src/OTE/OTE.ts`. Live bots and
backtests then fire on the same bars by construction.

**Pine Script thresholds in absolute price units** (points/ticks) don't
transfer to a library used on every symbol — convert them to a percentage
of price, and cap any history the script lets grow unbounded.

**Time/calendar filter** — a pure function, no class, no
`LightIndicator`, no `IndicatorConfig` member, no factory entry. Only needs
an `IndicatorEnum` entry + an `index.ts` export. Everything else about it
is implemented by consumers downstream. Don't use this shape for a "simple"
real indicator — it skips the factory entirely, which breaks market-archive
and the backtester's normal flow.

Then `npm test && npm run build && npm run lint`, commit, **push** —
consumers pin this repo by commit sha in their lockfiles, so the push is
the publish, and nothing downstream moves until its lock is bumped.

## Sister repos

All public, same repo family as this one:

- **backtester** — hand-wires each indicator separately (doesn't use this
  repo's factory), but imports the class + result type from here and keeps
  its own warmup length in sync with what you set in `factory/warmup.ts`.
- **app-sh** — the main-app core; calls this repo's factory directly
  (`createIndicator`/`feedCandle`/`getWarmupCandles`), no per-indicator
  branch needed there for a normal indicator.
- **main-dash-sh** — the dashboard core; its `customIndicators.js` chart
  study is a separate, hand-drawn re-implementation of the same math in
  TradingView's study primitives — it does not import this repo, so the
  math has to be kept in sync by hand between the two.
- **content** — the help doc the dashboard's indicator catalog links to.

Gainium's main-app and dashboard services (both ship as part of the
self-hosted bundle too, alongside this repo) bump this package
independently once you publish — not this repo's concern beyond
publishing a correct version.
