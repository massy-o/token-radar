// Token Launch Radar's model: one sealed DefiLlama snapshot in, one ranked board of
// pre-token protocols out.
//
// Where the value comes from. The snapshot's own token-bearing protocols are the only
// market evidence available, so the model prices every pre-token protocol off them:
// for each category it takes the median market-cap/TVL ratio of the tokenized peers in
// that category and shrinks it toward the global median (0.1689 over 144 peers) with a
// prior weight of 4, so a category with one wild peer cannot dominate its rows. Peer
// ratios are winsorized to [0.002, 2.2] first — 2.2 is the evidence base's own 90th
// percentile — because a single low-float outlier (the raw maximum is 400x) would
// otherwise price a whole category. The shrunk multiple is then adjusted by the
// protocol's own 7-day TVL momentum and by a maturity factor from its age:
//
//   implied = TVL x shrunkCategoryMultiple x growthMult x maturityMult
//   growthMult   = 1 + clamp(change_7d, -60, +120) / 100 x 0.5
//   maturityMult = 0.6 + 0.4 x min(age_days, 1095) / 1095   (unknown age: 365 days)
//
// A launch score (0-100) blends the implied value's log percentile, momentum, chain
// breadth, TVL percentile and maturity; it orders nothing (the gate ranks by implied
// value) but tells the reader where to look first. No protocol name is special-cased:
// one function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can re-run the arithmetic. */
export interface ModelConstants {
  ratio_floor: number;
  ratio_cap: number;
  shrink_prior_weight: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  ratio_floor: 0.002,
  ratio_cap: 2.2,
  shrink_prior_weight: 4,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the board carries it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's comparison strip carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  launch_score: number;
  tier: string;
  /** How much evidence backs the multiple: category peer count, discounted for missing data. */
  confidence: 'high' | 'medium' | 'low';
  model: {
    category_multiple: number;
    category_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row plus its farm plan, verbatim. */
export interface RadarRow extends BoardRow {
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** One category's multiple evidence, for the dashboard's model section. */
export interface CategoryMultiple {
  category: string;
  peers: number;
  median: number;
  multiple: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_median: number;
  peer_count: number;
  scanned: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  categories: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Category multiples: per-category peer medians shrunk toward the global median. */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants): { globalMedian: number; peerCount: number; table: CategoryMultiple[]; byCategory: Map<string, CategoryMultiple> } {
  const peers = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const ratioOf = (p: SnapshotProtocol): number => Math.min(model.ratio_cap, Math.max(model.ratio_floor, p.mcap_usd! / p.tvl_usd));
  const globalMedian = peers.length > 0 ? median(peers.map(ratioOf)) : 0;
  const groups = new Map<string, number[]>();
  for (const p of peers) {
    const key = p.category ?? '(uncategorised)';
    const list = groups.get(key) ?? [];
    list.push(ratioOf(p));
    groups.set(key, list);
  }
  const table: CategoryMultiple[] = [];
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of groups) {
    const med = median(ratios);
    const multiple = (ratios.length * med + model.shrink_prior_weight * globalMedian) / (ratios.length + model.shrink_prior_weight);
    const row: CategoryMultiple = { category, peers: ratios.length, median: round4(med), multiple: round4(multiple) };
    table.push(row);
    byCategory.set(category, row);
  }
  table.sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  return { globalMedian, peerCount: peers.length, table, byCategory };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiple: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.min(100_000_000_000_000, Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult)));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Whole words that mark a wrapped or staked product in a name. */
const WRAPPED_NAME = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a product may begin with. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token and a launch candidate in its
 * own right, under the same exclusions the house applied to its watchlist (no versioned
 * pools, no wrapped/staked/bridged products, no exchange fronts).
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_NAME.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** A percentile (0..1) of `value` within `sortedAsc`, by rank position. */
function percentile(sortedAsc: number[], value: number): number {
  if (sortedAsc.length <= 1) return 1;
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / (sortedAsc.length - 1);
}

/** The launch score's tier letter for a 0..100 score. */
export function tierFor(score: number): string {
  if (score >= 80) return 'S';
  if (score >= 65) return 'A';
  if (score >= 50) return 'B';
  if (score >= 35) return 'C';
  return 'D';
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is on the board, whatever the model thinks of it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol in the snapshot, however far
  // below the floor. The radar exists to see them before the floor does.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const { globalMedian, byCategory } = categoryMultiples(snapshot, model);
  const fallback: CategoryMultiple = { category: '(uncategorised)', peers: 0, median: round4(globalMedian), multiple: round4(globalMedian) };

  const scored = [...chosen.values()].map((p) => {
    const cm = byCategory.get(p.category ?? '(uncategorised)') ?? fallback;
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model, cm.multiple);
    return { p, implied, growthPct, growthMult, maturityMult, age, multiple: cm.multiple, peers: cm.peers };
  });

  // Launch score inputs, ranked across the whole board so the score is relative evidence.
  const logImplied = scored.map((s) => Math.log10(s.implied)).sort((a, b) => a - b);
  const logTvl = scored.map((s) => Math.log10(Math.max(1, s.p.tvl_usd))).sort((a, b) => a - b);
  const momentum = scored.map((s) => finite(s.p.change_7d, 0)).sort((a, b) => a - b);
  for (const s of scored as Array<(typeof scored)[number] & { score: number }>) {
    const breadth = Math.min(s.p.chains.length, 10) / 10;
    const maturity = Math.min((s.age ?? model.unknown_age_days) / model.maturity_days, 1);
    s.score = Math.round(
      100 *
        (0.45 * percentile(logImplied, Math.log10(s.implied)) +
          0.2 * percentile(momentum, finite(s.p.change_7d, 0)) +
          0.15 * breadth +
          0.1 * percentile(logTvl, Math.log10(Math.max(1, s.p.tvl_usd))) +
          0.1 * maturity),
    );
  }

  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const score = (s as { score: number }).score;
    // Confidence: a multiple priced off many tokenized peers is evidence; off one peer it
    // is a hint. Missing age and momentum data each cost a level of trust.
    let confidence: 'high' | 'medium' | 'low' = s.peers >= 8 ? 'high' : s.peers >= 3 ? 'medium' : 'low';
    if (s.age === null && s.p.change_7d === null) confidence = confidence === 'high' ? 'medium' : 'low';
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      on_watchlist: watch.has(s.p.slug),
      age_days: s.age,
      implied_value_usd: s.implied,
      launch_score: score,
      tier: tierFor(score),
      confidence,
      model: {
        category_multiple: s.multiple,
        category_peers: s.peers,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age),
    };
  });
}

/** A step as one string: the action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check it weekly.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core position, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator')) return `Allocate $${capital} into a ${name}-curated vault on ${chain}; curator vaults are where this protocol's own activity is counted`;
  if (c.includes('allocator')) return `Deposit $${capital} into ${name}'s flagship allocation vault on ${chain} and keep the vault shares in the wallet`;
  if (c.includes('lend') || c.includes('collateral')) return `Supply $${capital} of USDC or ETH as collateral on ${name} (${chain}) and leave the supply position open`;
  if (c.includes('cdp')) return `Open a small collateral position on ${name} on ${chain}: deposit $${capital} of collateral and mint a modest amount of its stablecoin`;
  if (c.includes('dex')) return `Provide $${capital} of two-sided liquidity to ${name}'s highest-volume pool on ${chain} and keep the LP position open`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s largest yield vault on ${chain} and keep the receipt token in the wallet`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis-trading vault on ${chain} and hold the vault shares`;
  if (c.includes('rwa')) return `Subscribe $${capital} to ${name}'s tokenised real-world asset on ${chain} and hold it in the wallet`;
  if (c.includes('deriv') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} and hold one small hedged position open`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the native staking asset through ${name} on ${chain} and keep the receipt token`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name}'s chain, hold its gas token and make the wallet a regular user of its native apps`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and hold one position in an active market until it settles`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of ${name}'s stable asset on ${chain} and hold it in the wallet`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`;
}

/** The weekly qualifying action, flavoured by the category. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex')) return `Make one swap or liquidity adjustment on ${p.name} each week so the wallet reads as a returning user, not a one-off`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Adjust the position on ${p.name} once a week (a small top-up, borrow or repay) so the wallet stays active across snapshots`;
  if (c.includes('chain')) return `Run one transaction on the chain each week (a transfer, a swap, a contract call) so the wallet ages as a native user`;
  return `Make one qualifying action on ${p.name} each week (a deposit, a claim, a vote or a top-up) so the activity spans several snapshots`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from
 * the protocol's own record (category, chains, TVL, age) — never a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const steps: Array<[string, string, string]> = [
    [
      `Start from a fresh wallet funded only with what this one position needs, its seed phrase written down offline and never pasted into a site`,
      'under $3 of gas to make the wallet active',
      '5 minutes',
    ],
    [actionFor(p, capital, chain), `$${capital} of capital plus about $${gas} of gas`, '15 minutes to set up'],
  ];
  if (p.chains.length >= 3) {
    steps.push([
      `Repeat a smaller position on a second chain ${p.name} runs on (${p.chains[1]}): multi-chain activity is the pattern launch snapshots usually reward`,
      `about $${Math.max(25, Math.round(capital / 2))} of capital plus bridge fees`,
      '20 minutes',
    ]);
  } else {
    steps.push([
      `Deepen the same position once after a week instead of opening a second one: ${p.name} counts its activity on ${chain}, so consistency there is worth more than spreading thin`,
      `about $${Math.max(25, Math.round(capital / 2))} of extra capital`,
      '10 minutes',
    ]);
  }
  steps.push(
    [weeklyFor(p), 'about $2 of gas a week', '10 minutes a week'],
    [
      `Hold every position for at least ${hold} days: a launch snapshot taken tomorrow should still find the capital in place`,
      `the $${capital} stays deployed`,
      `${hold} days`,
    ],
    [
      `When a points, rewards or claim page appears, reach it only from ${p.name}'s own site or verified account, and never pay a fee to claim an airdrop`,
      'nothing to check; a claim fee is a scam',
      '10 minutes',
    ],
    [
      `Log the wallet, the dates and every transaction hash in a farm diary, so the position can be proved, repeated or unwound without guesswork`,
      'nothing but the log',
      '5 minutes',
    ],
  );
  return steps.map(([text, cost, time]) => stepText(text, cost, time));
}

/** The live-token protocols, by market cap, for the dashboard's comparison strip. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { globalMedian, peerCount, table } = categoryMultiples(snapshot, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_median: round4(globalMedian),
    peer_count: peerCount,
    scanned: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    total_implied_usd: board.reduce((a, r) => a + r.implied_value_usd, 0),
    categories: table,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows (the gate takes 100 to 4000)`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
