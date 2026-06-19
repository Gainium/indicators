# indicators (`@gainium/indicators`)

## 📚 Platform knowledge base

A curated, auto-updated AI-agent knowledge base for the **whole Gainium platform** lives in the
private repo **`gainium-0-knowledge`** (`github.com/aressanch/gainium-0-knowledge`).
Local checkouts — Mac: `~/Git/Gainium Local/0-knowledge` · VPS: `/root/git/0-knowledge`.

Consult it before non-trivial work: `ARCHITECTURE.md` (service graph + danger boundaries),
`subsystems/<area>.md` (how each area works & breaks), `bug-patterns/`, `runbooks/`,
`domain/glossary.md`. Query 3.7k historical bugs by symptom:
`python3 <kb>/_raw/scripts/bugs.py find "<terms>"`. It is auto-enriched daily from agent session digests.

**Library, not a service.** Canonical TA indicator library (45+), published as a github npm dep.
Map: [`../0-knowledge/ARCHITECTURE.md`](../0-knowledge/ARCHITECTURE.md).

## Run / test
- build `npm run build` (or `yarn`) · watch `build:watch` · test `npm test` · lint `npm run lint`

## Coupling
- Imported by **main-app**, **main-app-sh (core)**, **market-archive**, **backtester** (via package.json
  `@gainium/indicators`). It's the **canonical** TA lib — the unused `trading-signals-tv-suitable` lib was removed.
- A change to indicator output (values, `IndicatorEnum`, warmup math) silently changes bot signals,
  backtests, and archived indicator results across every consumer. Treat the public API + numeric output as a
  contract; bump the version and coordinate consumers.

## Rules
- Pure library: no ports, no I/O. Keep it deterministic and side-effect-free.
