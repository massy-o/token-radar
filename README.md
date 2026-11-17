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

`implied = TVL × shrunk multiple × growth × maturity`. A **launch score** (0–100) blends the implied value's log percentile (45%), momentum (20%), chain breadth (15%), TVL percentile (10%) and maturity (10%) into tiers S/A/B/C/D. The board is ordered by implied value; the score only tells you where to look first — and every row ships its five score components, so the blend can be audited exactly.

Two honesty mechanisms ride on every row:

- **Confidence** — high / medium / low, from how many tokenized peers price the row's category (≥8 / ≥3 / fewer), discounted when the protocol reports neither its age nor its momentum. A value priced off one peer is labelled as one.
- **A value range, not a point** — beside the base implied value, each row carries a conservative end priced at its category's 25th-percentile multiple, and an **above-leader flag** (▲) when the base value would price the protocol above every tokenized peer in its category. Twenty rows carry that flag; the conservative end is the planning number for them.

**Sensitivity** (computed in the model, shown on the dashboard): price every category at the one global median and the top five become Steakhouse Financial, Sentora Curator, Gauntlet, Veda, USDD. Strip the growth and maturity adjustments and they become Sentora Curator, Steakhouse Financial, Gauntlet, Nonce Capital, Polymarket International. The adjustments move values; the same names keep surfacing.

## The board

All 40 watchlist protocols (TVL ≥ $50M, no token) plus every other rankable pre-token protocol the snapshot carries — **198 rows** in all (158 of them below the watchlist floor), each with its implied value and conservative range, the model's full arithmetic, a launch-score anatomy, and an eight-step farm plan derived from its category, chains, TVL and age — including a category-specific risk step (impermanent loss, liquidation, funding flips, curator drift, redemption windows).

Top of the board (snapshot of 2026-11-14):

| # | Protocol | Category | TVL | Implied | Score | Evidence |
|---|----------|----------|-----|---------|-------|----------|
| 1 | Steakhouse Financial | Risk Curators | $2,754M | $1,251M | 87 (S) | low |
| 2 | Sentora Curator | Risk Curators | $2,758M | $1,201M | 81 (S) | low |
| 3 | Gauntlet | Risk Curators | $1,578M | $745M | 92 (S) | low |
| 4 | Polymarket International | Prediction Market | $320M | $183M | 78 (A) | low |
| 5 | Nonce Capital | Risk Curators | $514M | $173M | 62 (B) | low |
| 6 | USDD | CDP | $1,056M | $145M | 75 (A) | medium |
| 7 | Veda | Onchain Capital Allocator | $1,563M | $123M | 80 (S) | medium |
| 8 | RockawayX | Risk Curators | $293M | $114M | 81 (S) | low |
| 9 | Hive Protocol | Chain | $199M | $102M | 66 (A) | low |
| 10 | Hyperithm | Risk Curators | $222M | $100M | 81 (S) | low |

The top of the board is dominated by risk curators, and the radar says so plainly: that category's multiple rests on a single tokenized peer, so its evidence grade is **low** and its top rows are all flagged above-leader. The instrument reports its own uncertainty instead of hiding it.

## The dashboard

A static page (`dashboard/index.html`) rendering entirely from `data.js` — no network, no framework:

- the board: searchable, filterable by category / chain / tier / watchlist, sortable five ways;
- a log-log **scatter** of TVL against implied value with the parity diagonal — click any dot for its detail;
- a per-protocol **detail view**: full model arithmetic, the value range, the score anatomy, chain chips, the farm plan;
- a **compare tray**: pin up to three protocols side by side (`+ compare` on any row);
- deep links throughout (`?slug=…`, `?cat=…`, `?tier=…`, `?compare=a,b,c`).

## Run it

```
node main.ts --input <snapshot.json>   # writes board.json, data.js, dashboard/, dossier.json to /output (or $MAKEFUN_OUTPUT_DIR)
```
