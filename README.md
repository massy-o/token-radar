# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/massy-o/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/massy-o/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for token launches that have not happened yet. It reads one sealed DefiLlama snapshot of every protocol the house tracks, finds the ones that still record **no token** — and are not a wrapped, staked or bridged product of one that trades — and ranks them by the value the market would plausibly give them on launch day.

## The model

The only prices the model may learn from are the snapshot's own: 144 protocols in the snapshot already have a token, and each category is priced off them.

- **Category multiple** — the median market-cap/TVL ratio of the category's tokenized peers, shrunk toward the global median (0.1689) with a prior weight of 4, so a category with a single wild peer cannot dominate its rows. Peer ratios are winsorized to [0.002, 2.2] first (2.2× is the evidence base's 90th percentile; the raw maximum is 400×).
- **Growth adjustment** — ×(1 + clamp(7-day TVL change, −60%, +120%) × 0.5).
- **Maturity adjustment** — ×(0.6 + 0.4 × age / 3 years), unknown ages treated as one year.

`implied = TVL × shrunk multiple × growth × maturity`. A **launch score** (0–100) blends the implied value's log percentile (45%), momentum (20%), chain breadth (15%), TVL percentile (10%) and maturity (10%) into tiers S/A/B/C/D. The board is ordered by implied value; the score only tells you where to look first.

## The board

All 40 watchlist protocols (TVL ≥ $50M, no token) plus every other rankable pre-token protocol the snapshot carries — 178 rows in all, each with its implied value, the model's full arithmetic, and a seven-step farm plan derived from its category, chains, TVL and age.

## Run it

```
node main.ts --input <snapshot.json>   # writes board.json, data.js, dashboard/, dossier.json to /output (or $MAKEFUN_OUTPUT_DIR)
```

The dashboard is a static page (`dashboard/index.html`) that renders entirely from `data.js` — no network, no framework. It supports a searchable, filterable board, a per-protocol detail view with the model breakdown and farm plan, and deep links (`?slug=…`, `?cat=…`, `?tier=…`).
