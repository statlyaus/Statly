/**
 * Development-lane trade grading over direct HPN PAV. For a trade made after season Y, the at-trade
 * view is season Y and the realized view is season Y + 1 at the receiving club, matching the governed
 * method. Anything the lane cannot value exactly (picks, unresolved or ambiguous players, parse issues,
 * a player who played Y + 1 elsewhere) makes the trade incomplete: it is reported, never graded.
 */

/** AFL Tables club spellings, with the Draftguru and common variants that denote the same club. */
const AFL_CLUB_ALIASES: Readonly<Record<string, readonly string[]>> = {
  Adelaide: ['Adelaide Crows'],
  'Brisbane Lions': ['Brisbane'],
  Carlton: [],
  Collingwood: [],
  Essendon: [],
  Fremantle: [],
  Geelong: ['Geelong Cats'],
  'Gold Coast': ['Gold Coast Suns'],
  'Greater Western Sydney': ['GWS', 'GWS Giants'],
  Hawthorn: [],
  Melbourne: [],
  'North Melbourne': ['Kangaroos'],
  'Port Adelaide': [],
  Richmond: [],
  'St Kilda': [],
  Sydney: ['Sydney Swans'],
  'West Coast': ['West Coast Eagles'],
  'Western Bulldogs': [],
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const CLUB_BY_NAME = new Map(
  Object.entries(AFL_CLUB_ALIASES).flatMap(([club, aliases]) =>
    [club, ...aliases].map((name) => [normalize(name), club] as const)
  )
);

/** The AFL Tables spelling of a club, or null for any name outside the reviewed list. */
export function canonicalAflClub(name: string): string | null {
  return CLUB_BY_NAME.get(normalize(name)) ?? null;
}

export interface LocalHpnPavSeasonView {
  readonly pav: ReadonlyMap<string, number>;
  readonly players: ReadonlyMap<
    string,
    { readonly names: ReadonlySet<string>; readonly teams: ReadonlySet<string> }
  >;
}

export interface LocalHpnPavTradeLeg {
  readonly fromClub: string;
  readonly toClub: string;
  readonly assetKind: string;
  readonly playerName: string | null;
}

export interface LocalHpnPavTradeVerdict {
  readonly tradeId: string;
  readonly status: 'complete' | 'incomplete';
  readonly reasons: readonly string[];
  readonly legs: readonly {
    readonly assetKind: string;
    readonly player: string | null;
    readonly playerId: string | null;
    readonly fromClub: string;
    readonly toClub: string;
    readonly atTradePav: number | null;
    readonly realizedPav: number | null;
  }[];
  readonly clubs: readonly {
    readonly club: string;
    readonly atTradeNet: number;
    readonly realizedNet: number | null;
    readonly grade: number | null;
  }[];
}

/** The unique identity with this name who played for the giving club in the at-trade season. */
function resolvePlayer(
  view: LocalHpnPavSeasonView,
  name: string,
  fromClub: string
): { playerId: string } | { reason: string } {
  const matches = [...view.players].filter(
    ([, player]) =>
      [...player.names].some((candidate) => normalize(candidate) === normalize(name)) &&
      [...player.teams].some((team) => canonicalAflClub(team) === fromClub)
  );
  if (matches.length === 1) return { playerId: matches[0]![0] };
  return {
    reason:
      matches.length === 0
        ? `${name} did not play for ${fromClub} in the at-trade season`
        : `${name} matches ${matches.length} players at ${fromClub}`,
  };
}

const round = (value: number) => Number(value.toFixed(4));

type ValuedLeg = LocalHpnPavTradeVerdict['legs'][number];
type LegOutcome = { readonly leg: ValuedLeg; readonly reason: string | null };

/** Realized value at the receiving club, or the reason it cannot be credited there. */
function realizedValue(
  realized: LocalHpnPavSeasonView,
  playerId: string,
  playerName: string,
  toClub: string
): { value: number } | { reason: string } {
  const later = realized.players.get(playerId);
  // No appearances in the realized season is a measured zero for the receiving club.
  if (later === undefined) return { value: 0 };
  const laterClubs = new Set([...later.teams].map(canonicalAflClub));
  if (laterClubs.size !== 1 || !laterClubs.has(toClub)) {
    return { reason: `${playerName} did not play the realized season only for ${toClub}` };
  }
  return { value: realized.pav.get(playerId) ?? 0 };
}

/** Values one leg, or records why the direct lane cannot value it. */
function valueLeg(
  leg: LocalHpnPavTradeLeg,
  atTrade: LocalHpnPavSeasonView,
  realized: LocalHpnPavSeasonView | null
): LegOutcome {
  const fromClub = canonicalAflClub(leg.fromClub);
  const toClub = canonicalAflClub(leg.toClub);
  const unvalued = {
    assetKind: leg.assetKind,
    player: leg.playerName,
    fromClub: fromClub ?? leg.fromClub,
    toClub: toClub ?? leg.toClub,
    playerId: null,
    atTradePav: null,
    realizedPav: null,
  };
  if (fromClub === null || toClub === null) {
    return {
      leg: unvalued,
      reason: `unknown club: ${fromClub === null ? leg.fromClub : leg.toClub}`,
    };
  }
  if (leg.assetKind !== 'player' || !leg.playerName) {
    return { leg: unvalued, reason: `${leg.assetKind} leg is not valued by the direct PAV lane` };
  }
  const resolved = resolvePlayer(atTrade, leg.playerName, fromClub);
  if ('reason' in resolved) return { leg: unvalued, reason: resolved.reason };
  const later =
    realized === null ? null : realizedValue(realized, resolved.playerId, leg.playerName, toClub);
  return {
    leg: {
      ...unvalued,
      playerId: resolved.playerId,
      atTradePav: atTrade.pav.get(resolved.playerId) ?? 0,
      realizedPav: later !== null && 'value' in later ? later.value : null,
    },
    reason: later !== null && 'reason' in later ? later.reason : null,
  };
}

/** Each club's net value: received legs add, surrendered legs subtract. */
function clubNets(legs: readonly ValuedLeg[]) {
  const clubs = new Map<string, { atTrade: number; realized: number }>();
  for (const leg of legs) {
    if (leg.atTradePav === null) continue;
    for (const [club, sign] of [
      [leg.fromClub, -1],
      [leg.toClub, 1],
    ] as const) {
      const net = clubs.get(club) ?? { atTrade: 0, realized: 0 };
      net.atTrade += sign * leg.atTradePav;
      net.realized += sign * (leg.realizedPav ?? 0);
      clubs.set(club, net);
    }
  }
  return clubs;
}

export function gradeLocalHpnPavTrade(input: {
  readonly tradeId: string;
  readonly legs: readonly LocalHpnPavTradeLeg[];
  readonly parseIssues: readonly string[];
  readonly atTrade: LocalHpnPavSeasonView;
  readonly realized: LocalHpnPavSeasonView | null;
}): LocalHpnPavTradeVerdict {
  const outcomes = input.legs.map((leg) => valueLeg(leg, input.atTrade, input.realized));
  const reasons = [
    ...input.parseIssues.map((issue) => `parse issue: ${issue}`),
    ...outcomes.flatMap(({ reason }) => (reason === null ? [] : [reason])),
  ];
  const legs = outcomes.map(({ leg }) => leg);
  const complete = reasons.length === 0;
  const graded = complete && input.realized !== null;
  return {
    tradeId: input.tradeId,
    status: complete ? 'complete' : 'incomplete',
    reasons,
    legs,
    clubs: [...clubNets(legs)].map(([club, net]) => ({
      club,
      atTradeNet: round(net.atTrade),
      realizedNet: graded ? round(net.realized) : null,
      grade: graded ? round(net.realized - net.atTrade) : null,
    })),
  };
}
