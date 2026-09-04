# indicators — new indicator runbook

Canonical source: `new-indicator-integration` (private `skills` repo). This
is a scoped excerpt — see [SKILL.md](SKILL.md) for the narrative version.

## Where this sits

**Step 1**, first in the sequence. Nothing needs to land before this —
it's the foundation everything else bumps toward. Depends on the Step 0
feasibility verdict being written down (definition confirmed, indicator-
vs-filter decided, not a duplicate/alias of something existing).

## Checklist

```
[ ] src/<Name>/<Name>.ts   (LightIndicator subclass, or pure function for a filter)
[ ] src/types/result.ts    (result type — skip for a filter)
[ ] src/types/config.ts    (IndicatorEnum entry; IndicatorConfig union member — skip member for a filter)
[ ] src/factory/create.ts  (case branch — skip for a filter)
[ ] src/factory/warmup.ts  (case branch — skip for a filter)
[ ] src/factory/feed.ts    (only if input shape isn't already dispatched)
[ ] src/index.ts           (export)
[ ] package.json + CHANGELOG.md
[ ] npm run build && npm run lint
[ ] publish/tag the version
```

## Verify before calling it done

- `getWarmupCandles(config)` returns a sane number for the new type (not 0,
  not undefined) — `app-sh`, `market-archive`, and the backtester's
  `indicatorLoader` all depend on getting this number right (the backtester
  actually keeps its own hand-set copy, so double-check it matches).
- `createIndicator(config)` actually returns an instance of your class, not
  `null` — this is the single most common integration failure (forgot a
  factory file).
- Feed it a real candle series (via the test harness in `app-sh` once that
  lands, or a local script here) and confirm `calculate()` returns `null`
  during warmup and a real result once stable.
