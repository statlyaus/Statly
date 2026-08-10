export const AFL_TRADE_FITZROY_CAPABILITY_SCHEMA_VERSION =
  'afl-trade-fitzroy-capabilities/v1' as const;
export const AFL_TRADE_FITZROY_PINNED_VERSION = '1.7.0' as const;

export type AflTradeFitzRoyCompetition = 'AFLM' | 'AFLW';

export type AflTradeFitzRoyMetric =
  | 'match_universe'
  | 'match_appearance'
  | 'goals'
  | 'brownlow_votes'
  | 'coaches_votes'
  | 'all_australian'
  | 'rising_star'
  | 'player_identity'
  | 'advanced_player_stats';

export type AflTradeFitzRoyProvider =
  'official_afl' | 'afl_tables' | 'footywire' | 'fryzigg' | 'afl_coaches_association';

export type AflTradeFitzRoyRoundBehaviour =
  'supported' | 'ignored_returns_season' | 'not_applicable';

export type AflTradeFitzRoyCaptureOrigin =
  'live_upstream' | 'cached_dataset' | 'cached_then_live_delta';

export type AflTradeFitzRoyIdentifierQuality =
  | 'provider_identifier'
  | 'source_local_identifier'
  | 'name_and_context_only'
  | 'capture_probe_required';

export interface AflTradeFitzRoyCapability {
  capabilityId: string;
  fitzRoyVersion: typeof AFL_TRADE_FITZROY_PINNED_VERSION;
  provider: AflTradeFitzRoyProvider;
  directFunction: string;
  competitions: readonly AflTradeFitzRoyCompetition[];
  metrics: readonly AflTradeFitzRoyMetric[];
  retrievalGrain: 'match' | 'season' | 'player_snapshot';
  roundBehaviour: AflTradeFitzRoyRoundBehaviour;
  captureOrigin: AflTradeFitzRoyCaptureOrigin;
  documentedMinimumSeason: number | null;
  identifiers: Readonly<{
    player: AflTradeFitzRoyIdentifierQuality;
    match: AflTradeFitzRoyIdentifierQuality;
    club: AflTradeFitzRoyIdentifierQuality;
  }>;
  intendedRole: 'candidate_primary' | 'candidate_secondary' | 'reconciliation_only';
  requiredCaptureChecks: readonly string[];
  knownCautions: readonly string[];
}

/**
 * Technical capability evidence for the pinned fitzRoy release. It is not a source-rights grant, a
 * provider priority list, or proof that a field is complete for a particular season. Every selected
 * capability still requires an approved source decision and a representative capture contract.
 */
export const AFL_TRADE_FITZROY_CAPABILITIES = [
  {
    capabilityId: 'official-afl-player-stats',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'official_afl',
    directFunction: 'fetch_player_stats_afl',
    competitions: ['AFLM', 'AFLW'],
    metrics: ['match_appearance', 'goals', 'player_identity', 'advanced_player_stats'],
    retrievalGrain: 'match',
    roundBehaviour: 'supported',
    captureOrigin: 'live_upstream',
    documentedMinimumSeason: null,
    identifiers: {
      player: 'provider_identifier',
      match: 'provider_identifier',
      club: 'provider_identifier',
    },
    intendedRole: 'candidate_primary',
    requiredCaptureChecks: [
      'Verify the available competition-season and completed-match universe.',
      'Fingerprint the returned schema before normalization.',
      'Retain fixture providerId values used to request match statistics.',
    ],
    knownCautions: [
      'Availability is discovered through the official fixture endpoint and is not documented as a historical guarantee.',
      'A missing or incomplete match response must not be interpreted as a played game with zero statistics.',
    ],
  },
  {
    capabilityId: 'afl-tables-player-stats',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'afl_tables',
    directFunction: 'fetch_player_stats_afltables',
    competitions: ['AFLM'],
    metrics: [
      'match_appearance',
      'goals',
      'brownlow_votes',
      'player_identity',
      'advanced_player_stats',
    ],
    retrievalGrain: 'season',
    roundBehaviour: 'ignored_returns_season',
    captureOrigin: 'cached_then_live_delta',
    documentedMinimumSeason: null,
    identifiers: {
      player: 'source_local_identifier',
      match: 'source_local_identifier',
      club: 'name_and_context_only',
    },
    intendedRole: 'candidate_primary',
    requiredCaptureChecks: [
      'Record whether each row came from the fitzRoy_data cache or a live AFL Tables delta.',
      'Fingerprint the full-season schema and natural key.',
      'Compare the requested season range with the returned date range.',
    ],
    knownCautions: [
      'round_number is ignored and the function returns all rounds in the requested seasons.',
      'Conditional normalization can replace numeric missing values with zero, so returned zero is not automatically a measured zero.',
      'fitzRoy normalizes team and venue names before returning rows.',
    ],
  },
  {
    capabilityId: 'footywire-player-stats',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'footywire',
    directFunction: 'fetch_player_stats_footywire',
    competitions: ['AFLM'],
    metrics: ['match_appearance', 'goals', 'player_identity', 'advanced_player_stats'],
    retrievalGrain: 'season',
    roundBehaviour: 'ignored_returns_season',
    captureOrigin: 'cached_then_live_delta',
    documentedMinimumSeason: 2010,
    identifiers: {
      player: 'source_local_identifier',
      match: 'source_local_identifier',
      club: 'name_and_context_only',
    },
    intendedRole: 'candidate_secondary',
    requiredCaptureChecks: [
      'Record cached fitzRoy_data match identifiers separately from newly scraped match identifiers.',
      'Verify full-season row counts and match coverage for every requested year.',
      'Fingerprint the fixed-position HTML result before accepting schema changes.',
    ],
    knownCautions: [
      'round_number is ignored and the function returns all rounds in the requested seasons.',
      'The function clamps requested seasons to 2010 through the current calendar year.',
      'The HTML extraction path is sensitive to upstream table-layout changes.',
    ],
  },
  {
    capabilityId: 'fryzigg-player-stats',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'fryzigg',
    directFunction: 'fetch_player_stats_fryzigg',
    competitions: ['AFLM', 'AFLW'],
    metrics: ['match_appearance', 'goals', 'player_identity', 'advanced_player_stats'],
    retrievalGrain: 'season',
    roundBehaviour: 'ignored_returns_season',
    captureOrigin: 'cached_dataset',
    documentedMinimumSeason: null,
    identifiers: {
      player: 'capture_probe_required',
      match: 'capture_probe_required',
      club: 'capture_probe_required',
    },
    intendedRole: 'reconciliation_only',
    requiredCaptureChecks: [
      'Capture and digest the complete upstream RDS object before filtering.',
      'Verify identifiers, natural keys, schema, season coverage, and duplicate rows empirically.',
      'Require a successful current network and repeatability probe before promotion beyond reconciliation.',
    ],
    knownCautions: [
      'round_number is ignored and the function filters a complete remote RDS dataset by date.',
      'The pinned implementation retrieves the RDS asset over plain HTTP.',
      'The package manual does not define a stable returned schema or season floor.',
    ],
  },
  {
    capabilityId: 'official-afl-results',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'official_afl',
    directFunction: 'fetch_results_afl',
    competitions: ['AFLM', 'AFLW'],
    metrics: ['match_universe'],
    retrievalGrain: 'match',
    roundBehaviour: 'supported',
    captureOrigin: 'live_upstream',
    documentedMinimumSeason: null,
    identifiers: {
      player: 'capture_probe_required',
      match: 'provider_identifier',
      club: 'provider_identifier',
    },
    intendedRole: 'candidate_primary',
    requiredCaptureChecks: [
      'Verify every concluded match in the requested competition-season.',
      'Retain official season, round, and match provider identifiers.',
    ],
    knownCautions: [
      'Historical availability is not guaranteed by the manual and must be measured.',
      'Only concluded matches are returned by the pinned implementation.',
    ],
  },
  {
    capabilityId: 'afl-tables-results',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'afl_tables',
    directFunction: 'fetch_results_afltables',
    competitions: ['AFLM'],
    metrics: ['match_universe'],
    retrievalGrain: 'match',
    roundBehaviour: 'supported',
    captureOrigin: 'live_upstream',
    documentedMinimumSeason: null,
    identifiers: {
      player: 'capture_probe_required',
      match: 'source_local_identifier',
      club: 'name_and_context_only',
    },
    intendedRole: 'candidate_primary',
    requiredCaptureChecks: [
      'Verify historical season and finals coverage against the player-stat match universe.',
      'Retain the source game identifier and original round label.',
    ],
    knownCautions: [
      'fitzRoy derives a dense round number and normalizes club and venue names.',
      'The returned match universe must be reconciled before it becomes the games denominator.',
    ],
  },
  {
    capabilityId: 'official-afl-player-details',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'official_afl',
    directFunction: 'fetch_player_details_afl',
    competitions: ['AFLM', 'AFLW'],
    metrics: ['player_identity'],
    retrievalGrain: 'player_snapshot',
    roundBehaviour: 'not_applicable',
    captureOrigin: 'live_upstream',
    documentedMinimumSeason: 2012,
    identifiers: {
      player: 'provider_identifier',
      match: 'capture_probe_required',
      club: 'provider_identifier',
    },
    intendedRole: 'candidate_primary',
    requiredCaptureChecks: [
      'Capture point-in-time squad membership and provider identifiers with retrieval time.',
      'Verify historical current=false coverage separately from current squads.',
    ],
    knownCautions: [
      'The pinned implementation expands historical current=false requests from 2012 to the requested season.',
      'Squad membership is evidence for identity and custody review, not transaction lineage by itself.',
    ],
  },
  {
    capabilityId: 'afl-tables-player-details',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'afl_tables',
    directFunction: 'fetch_player_details_afltables',
    competitions: ['AFLM'],
    metrics: ['player_identity'],
    retrievalGrain: 'player_snapshot',
    roundBehaviour: 'not_applicable',
    captureOrigin: 'live_upstream',
    documentedMinimumSeason: null,
    identifiers: {
      player: 'source_local_identifier',
      match: 'capture_probe_required',
      club: 'name_and_context_only',
    },
    intendedRole: 'candidate_secondary',
    requiredCaptureChecks: [
      'Measure historical player coverage and identity-field null rates.',
      'Retain the source player identifier and every club context used for resolution.',
    ],
    knownCautions: [
      'The direct function returns historical data and has no season argument.',
      'Name matching alone is insufficient to auto-merge canonical players.',
    ],
  },
  {
    capabilityId: 'footywire-player-details',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'footywire',
    directFunction: 'fetch_player_details_footywire',
    competitions: ['AFLM'],
    metrics: ['player_identity'],
    retrievalGrain: 'player_snapshot',
    roundBehaviour: 'not_applicable',
    captureOrigin: 'live_upstream',
    documentedMinimumSeason: null,
    identifiers: {
      player: 'source_local_identifier',
      match: 'capture_probe_required',
      club: 'name_and_context_only',
    },
    intendedRole: 'candidate_secondary',
    requiredCaptureChecks: [
      'Measure current and historical modes separately.',
      'Verify date-of-birth, debut, club, and identifier coverage before identity use.',
    ],
    knownCautions: [
      'Returned fields differ between current and historical modes.',
      'The manual does not define a stable schema or season floor.',
    ],
  },
  {
    capabilityId: 'aflca-coaches-votes',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'afl_coaches_association',
    directFunction: 'fetch_coaches_votes',
    competitions: ['AFLM', 'AFLW'],
    metrics: ['coaches_votes'],
    retrievalGrain: 'match',
    roundBehaviour: 'supported',
    captureOrigin: 'live_upstream',
    documentedMinimumSeason: 2006,
    identifiers: {
      player: 'name_and_context_only',
      match: 'name_and_context_only',
      club: 'name_and_context_only',
    },
    intendedRole: 'candidate_primary',
    requiredCaptureChecks: [
      'Build a match key from season, round/finals, and the two clubs before player resolution.',
      'Verify every requested round and distinguish a true no-vote result from a scrape failure.',
    ],
    knownCautions: [
      'The function scrapes the AFL Coaches Association rather than AFL, AFL Tables, or FootyWire.',
      'The pinned implementation warns that no data exists before 2006 and silently removes per-round scrape errors.',
    ],
  },
  {
    capabilityId: 'footywire-brownlow-awards',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'footywire',
    directFunction: 'fetch_awards_brownlow',
    competitions: ['AFLM'],
    metrics: ['brownlow_votes'],
    retrievalGrain: 'season',
    roundBehaviour: 'not_applicable',
    captureOrigin: 'live_upstream',
    documentedMinimumSeason: null,
    identifiers: {
      player: 'name_and_context_only',
      match: 'capture_probe_required',
      club: 'name_and_context_only',
    },
    intendedRole: 'candidate_secondary',
    requiredCaptureChecks: [
      'Compare season totals with match-grain AFL Tables Brownlow votes where both are available.',
      'Reject upstream table-shape changes instead of accepting positional matches silently.',
    ],
    knownCautions: [
      'The function returns season-level vote totals rather than match-grain observations.',
      'The scraper detects a table by column count and is sensitive to upstream layout changes.',
    ],
  },
  {
    capabilityId: 'footywire-all-australian',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'footywire',
    directFunction: 'fetch_awards_allaustralian',
    competitions: ['AFLM'],
    metrics: ['all_australian'],
    retrievalGrain: 'season',
    roundBehaviour: 'not_applicable',
    captureOrigin: 'live_upstream',
    documentedMinimumSeason: null,
    identifiers: {
      player: 'name_and_context_only',
      match: 'capture_probe_required',
      club: 'name_and_context_only',
    },
    intendedRole: 'candidate_primary',
    requiredCaptureChecks: [
      'Verify team and squad modes independently for each season.',
      'Capture source labels before canonical player and club resolution.',
    ],
    knownCautions: [
      'The pinned scraper selects fixed HTML row ranges.',
      'A successful response does not prove historical completeness.',
    ],
  },
  {
    capabilityId: 'footywire-rising-star',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    provider: 'footywire',
    directFunction: 'fetch_rising_star',
    competitions: ['AFLM'],
    metrics: ['rising_star'],
    retrievalGrain: 'season',
    roundBehaviour: 'supported',
    captureOrigin: 'live_upstream',
    documentedMinimumSeason: null,
    identifiers: {
      player: 'name_and_context_only',
      match: 'name_and_context_only',
      club: 'name_and_context_only',
    },
    intendedRole: 'candidate_primary',
    requiredCaptureChecks: [
      'Treat nomination and statistics modes as separate schemas.',
      'Verify round and season coverage before publishing an achievement.',
    ],
    knownCautions: [
      'The manual does not document a historical season floor.',
      'Achievement identity still requires canonical player and club resolution.',
    ],
  },
] as const satisfies readonly AflTradeFitzRoyCapability[];

export function listAflTradeFitzRoyCapabilities(input: {
  competition: AflTradeFitzRoyCompetition;
  metric: AflTradeFitzRoyMetric;
  season: number;
}): readonly AflTradeFitzRoyCapability[] {
  if (!Number.isInteger(input.season) || input.season < 1897) return [];

  return AFL_TRADE_FITZROY_CAPABILITIES.filter(
    (capability) =>
      (capability.competitions as readonly AflTradeFitzRoyCompetition[]).includes(
        input.competition
      ) &&
      (capability.metrics as readonly AflTradeFitzRoyMetric[]).includes(input.metric) &&
      (capability.documentedMinimumSeason === null ||
        input.season >= capability.documentedMinimumSeason)
  );
}
