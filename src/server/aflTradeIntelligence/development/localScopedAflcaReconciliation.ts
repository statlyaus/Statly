import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';

export interface LocalScopedAflTablesParticipant {
  readonly seasonYear: number;
  readonly roundNumber: number;
  readonly homeClubName: string;
  readonly awayClubName: string;
  readonly recordedPlayerName: string;
  readonly recordedClubName: string;
  readonly canonicalPlayerClubId: string;
  readonly canonicalMatchId: string;
}

export interface LocalScopedAflcaVote {
  readonly providerDecodedRowId: string;
  readonly identityCandidateId: string;
  readonly matchCandidateId: string;
  readonly seasonYear: number;
  readonly roundNumber: number;
  readonly awardScope: string;
  readonly homeClubName: string;
  readonly awayClubName: string;
  readonly recordedPlayerName: string;
  readonly numericVotes: number;
}

export interface LocalScopedAflcaReconciledVote extends LocalScopedAflcaVote {
  readonly canonicalPlayerClubId: string | null;
  readonly canonicalMatchId: string;
  readonly canonicalClubName: string;
  readonly resolvedPlayerName: string | null;
  readonly identityResolution: 'exact_reviewed_match' | 'reviewed_mapping' | 'unresolved';
  readonly identityMappingEvidenceId: string | null;
  readonly identityMappingReviewDecisionId: string | null;
  readonly matchMappingEvidenceId: string | null;
  readonly matchMappingReviewDecisionId: string | null;
}

export interface LocalScopedAflcaReviewedIdentityMapping {
  readonly seasonYear: number;
  readonly recordedPlayerName: string;
  readonly canonicalClubName: string;
  readonly canonicalPlayerClubId: string;
  readonly evidenceId: string;
  readonly reviewDecisionId: string;
}

export interface LocalScopedAflcaReviewedMatchMapping {
  readonly source: {
    readonly seasonYear: number;
    readonly roundNumber: number;
    readonly homeClubName: string;
    readonly awayClubName: string;
  };
  readonly target: {
    readonly seasonYear: number;
    readonly roundNumber: number;
    readonly homeClubName: string;
    readonly awayClubName: string;
  };
  readonly evidenceId: string;
  readonly reviewDecisionId: string;
}

const AFLCA_CLUB_NAMES: Readonly<Record<string, string>> = {
  'Adelaide Crows': 'Adelaide',
  'Brisbane Lions': 'Brisbane Lions',
  Carlton: 'Carlton',
  Collingwood: 'Collingwood',
  Essendon: 'Essendon',
  Fremantle: 'Fremantle',
  'Geelong Cats': 'Geelong',
  'Gold Coast Suns': 'Gold Coast',
  'GWS Giants': 'Greater Western Sydney',
  Hawthorn: 'Hawthorn',
  Melbourne: 'Melbourne',
  'North Melbourne': 'North Melbourne',
  'Port Adelaide': 'Port Adelaide',
  Richmond: 'Richmond',
  'St Kilda': 'St Kilda',
  'Sydney Swans': 'Sydney',
  'West Coast Eagles': 'West Coast',
  'Western Bulldogs': 'Western Bulldogs',
};

const AFLCA_CLUB_SUFFIXES: Readonly<Record<string, string>> = {
  ADEL: 'Adelaide',
  BL: 'Brisbane Lions',
  CARL: 'Carlton',
  COLL: 'Collingwood',
  ESS: 'Essendon',
  FRE: 'Fremantle',
  GCFC: 'Gold Coast',
  GEEL: 'Geelong',
  GWS: 'Greater Western Sydney',
  HAW: 'Hawthorn',
  MELB: 'Melbourne',
  NMFC: 'North Melbourne',
  PORT: 'Port Adelaide',
  RICH: 'Richmond',
  STK: 'St Kilda',
  SYD: 'Sydney',
  WB: 'Western Bulldogs',
  WCE: 'West Coast',
};

function requireText(value: string, label: string): string {
  const result = value.trim();
  if (result.length === 0) throw new TypeError(`${label} must be non-empty.`);
  return result;
}

function canonicalAflcaClub(value: string): string {
  const club = AFLCA_CLUB_NAMES[requireText(value, 'AFLCA club')];
  if (club === undefined) {
    throw new TypeError(`AFLCA club ${value} is outside the reviewed club vocabulary.`);
  }
  return club;
}

function matchKey(value: {
  seasonYear: number;
  roundNumber: number;
  homeClubName: string;
  awayClubName: string;
}): string {
  if (
    !Number.isSafeInteger(value.seasonYear) ||
    !Number.isSafeInteger(value.roundNumber) ||
    value.roundNumber < 0
  ) {
    throw new TypeError('Scoped AFLCA match season and round must be non-negative integers.');
  }
  return [
    value.seasonYear,
    value.roundNumber,
    requireText(value.homeClubName, 'home club'),
    requireText(value.awayClubName, 'away club'),
  ].join('\u0000');
}

function reviewedIdentityKey(value: { seasonYear: number; recordedPlayerName: string }): string {
  return `${value.seasonYear}\u0000${requireText(value.recordedPlayerName, 'recorded player name')}`;
}

function parseAflcaPlayer(value: string): { playerName: string; clubName: string } {
  const match = /^(?<playerName>.+) \((?<clubSuffix>[A-Z]+)\)$/u.exec(
    requireText(value, 'AFLCA player name')
  );
  const playerName = match?.groups?.playerName?.trim();
  const clubSuffix = match?.groups?.clubSuffix;
  const clubName = clubSuffix === undefined ? undefined : AFLCA_CLUB_SUFFIXES[clubSuffix];
  if (playerName === undefined || playerName.length === 0 || clubName === undefined) {
    throw new TypeError('AFLCA player identity must retain one reviewed club suffix.');
  }
  return { playerName, clubName };
}

export function reconcileLocalScopedAflcaVotes(input: {
  readonly expectedParticipants: readonly LocalScopedAflTablesParticipant[];
  readonly votes: readonly LocalScopedAflcaVote[];
  readonly reviewedIdentityMappings?: readonly LocalScopedAflcaReviewedIdentityMapping[];
  readonly reviewedMatchMappings?: readonly LocalScopedAflcaReviewedMatchMapping[];
}) {
  if (input.expectedParticipants.length === 0 || input.votes.length === 0) {
    throw new TypeError('Scoped AFLCA reconciliation requires factual participants and votes.');
  }
  const participantsByMatch = new Map<string, LocalScopedAflTablesParticipant[]>();
  const canonicalMatchByKey = new Map<string, string>();
  for (const participant of input.expectedParticipants) {
    const key = matchKey(participant);
    const existingMatchId = canonicalMatchByKey.get(key);
    if (existingMatchId !== undefined && existingMatchId !== participant.canonicalMatchId) {
      throw new TypeError('One AFL Tables match key resolved to conflicting canonical matches.');
    }
    canonicalMatchByKey.set(key, requireText(participant.canonicalMatchId, 'canonical match ID'));
    const participants = participantsByMatch.get(key) ?? [];
    participants.push(participant);
    participantsByMatch.set(key, participants);
  }

  const seenRows = new Set<string>();
  const observedMatchKeys = new Set<string>();
  const voteTotalByMatch = new Map<string, number>();
  const reconciled: LocalScopedAflcaReconciledVote[] = [];
  const reviewedIdentityMappings = new Map<string, LocalScopedAflcaReviewedIdentityMapping>();
  for (const mapping of input.reviewedIdentityMappings ?? []) {
    const key = reviewedIdentityKey(mapping);
    if (
      reviewedIdentityMappings.has(key) ||
      !/^artifact:[a-f0-9]{64}$/u.test(mapping.evidenceId) ||
      !/^local-scoped-aflca-identity-mapping:[a-f0-9]{64}$/u.test(mapping.reviewDecisionId) ||
      !/^local_player_club:reconciled-aflca:[^:]+:[^:]+$/u.test(mapping.canonicalPlayerClubId)
    ) {
      throw new TypeError('A reviewed AFLCA identity mapping is malformed or duplicated.');
    }
    reviewedIdentityMappings.set(key, mapping);
  }
  const usedReviewedIdentityMappings = new Set<string>();
  const reviewedMatchMappings = new Map<string, LocalScopedAflcaReviewedMatchMapping>();
  for (const mapping of input.reviewedMatchMappings ?? []) {
    const sourceKey = matchKey(mapping.source);
    const targetKey = matchKey(mapping.target);
    if (
      reviewedMatchMappings.has(sourceKey) ||
      sourceKey === targetKey ||
      !participantsByMatch.has(targetKey) ||
      !/^artifact:[a-f0-9]{64}$/u.test(mapping.evidenceId) ||
      !/^local-scoped-aflca-match-mapping:[a-f0-9]{64}$/u.test(mapping.reviewDecisionId)
    ) {
      throw new TypeError('A reviewed AFLCA match mapping is malformed or duplicated.');
    }
    reviewedMatchMappings.set(sourceKey, mapping);
  }
  const usedReviewedMatchMappings = new Set<string>();
  for (const vote of input.votes) {
    if (vote.awardScope !== 'home_and_away') {
      throw new TypeError('Scoped AFLCA reconciliation accepts only home_and_away evidence.');
    }
    if (
      !Number.isSafeInteger(vote.numericVotes) ||
      vote.numericVotes <= 0 ||
      vote.numericVotes > 10
    ) {
      throw new TypeError(
        'AFLCA coaches votes must be exact positive integers no greater than 10.'
      );
    }
    if (seenRows.has(vote.providerDecodedRowId)) {
      throw new TypeError('Scoped AFLCA reconciliation received a duplicate decoded row.');
    }
    seenRows.add(requireText(vote.providerDecodedRowId, 'decoded row ID'));
    const homeClubName = canonicalAflcaClub(vote.homeClubName);
    const awayClubName = canonicalAflcaClub(vote.awayClubName);
    const exactKey = matchKey({ ...vote, homeClubName, awayClubName });
    const reviewedMatch = reviewedMatchMappings.get(exactKey);
    const resolvedMatchKey = participantsByMatch.has(exactKey)
      ? exactKey
      : reviewedMatch === undefined
        ? undefined
        : matchKey(reviewedMatch.target);
    if (resolvedMatchKey === undefined) {
      throw new TypeError('A scoped AFLCA row does not resolve to one reviewed AFL Tables match.');
    }
    if (reviewedMatch !== undefined) usedReviewedMatchMappings.add(exactKey);
    const participants = participantsByMatch.get(resolvedMatchKey);
    const canonicalMatchId = canonicalMatchByKey.get(resolvedMatchKey);
    if (participants === undefined || canonicalMatchId === undefined) {
      throw new TypeError('A scoped AFLCA row lost its reviewed AFL Tables match authority.');
    }
    const parsedPlayer = parseAflcaPlayer(vote.recordedPlayerName);
    if (![homeClubName, awayClubName].includes(parsedPlayer.clubName)) {
      throw new TypeError('The AFLCA player club is outside its reviewed match.');
    }
    const clubParticipants = participants.filter(
      ({ recordedClubName }) => recordedClubName === parsedPlayer.clubName
    );
    let identityMappingEvidenceId: string | null = null;
    let identityMappingReviewDecisionId: string | null = null;
    let candidates = clubParticipants.filter(
      ({ recordedPlayerName }) => recordedPlayerName === parsedPlayer.playerName
    );
    if (candidates.length === 0) {
      const reviewedKey = reviewedIdentityKey(vote);
      const reviewed = reviewedIdentityMappings.get(reviewedKey);
      if (reviewed !== undefined && reviewed.canonicalClubName === parsedPlayer.clubName) {
        candidates = [
          {
            ...participants[0]!,
            recordedPlayerName: parsedPlayer.playerName,
            recordedClubName: parsedPlayer.clubName,
            canonicalPlayerClubId: reviewed.canonicalPlayerClubId,
          },
        ];
        usedReviewedIdentityMappings.add(reviewedKey);
        identityMappingEvidenceId = reviewed.evidenceId;
        identityMappingReviewDecisionId = reviewed.reviewDecisionId;
      }
    }
    if (candidates.length > 1) {
      throw new TypeError(
        `A scoped AFLCA row must resolve to exactly one AFL Tables player: ` +
          `${vote.seasonYear} round ${vote.roundNumber}, ${vote.recordedPlayerName}, ` +
          `${candidates.length} candidates.`
      );
    }
    const player = candidates[0] ?? null;
    observedMatchKeys.add(resolvedMatchKey);
    voteTotalByMatch.set(
      resolvedMatchKey,
      (voteTotalByMatch.get(resolvedMatchKey) ?? 0) + vote.numericVotes
    );
    reconciled.push({
      ...vote,
      canonicalPlayerClubId:
        player === null
          ? null
          : requireText(player.canonicalPlayerClubId, 'canonical player-club ID'),
      canonicalMatchId,
      canonicalClubName: parsedPlayer.clubName,
      resolvedPlayerName: player?.recordedPlayerName ?? null,
      identityResolution:
        player === null
          ? 'unresolved'
          : identityMappingReviewDecisionId === null
            ? 'exact_reviewed_match'
            : 'reviewed_mapping',
      identityMappingEvidenceId,
      identityMappingReviewDecisionId,
      matchMappingEvidenceId: reviewedMatch?.evidenceId ?? null,
      matchMappingReviewDecisionId: reviewedMatch?.reviewDecisionId ?? null,
    });
  }

  if (
    observedMatchKeys.size !== participantsByMatch.size ||
    [...participantsByMatch.keys()].some((key) => !observedMatchKeys.has(key))
  ) {
    throw new TypeError('Scoped AFLCA evidence does not cover every reviewed AFL Tables match.');
  }
  for (const [key, total] of voteTotalByMatch) {
    if (total !== 30) {
      throw new TypeError(`Scoped AFLCA match ${key} must contain exactly 30 coaches votes.`);
    }
  }
  if (usedReviewedIdentityMappings.size !== reviewedIdentityMappings.size) {
    throw new TypeError(
      'Every reviewed AFLCA identity mapping must resolve one retained vote row.'
    );
  }
  if (usedReviewedMatchMappings.size !== reviewedMatchMappings.size) {
    throw new TypeError('Every reviewed AFLCA match mapping must resolve retained vote rows.');
  }
  const evidenceSetSha256 = sha256AflTradeCanonicalJson(reconciled);
  return {
    matchCount: observedMatchKeys.size,
    voteRowCount: reconciled.length,
    resolvedVoteRowCount: reconciled.filter(
      ({ canonicalPlayerClubId }) => canonicalPlayerClubId !== null
    ).length,
    unresolvedIdentityRowCount: reconciled.filter(
      ({ canonicalPlayerClubId }) => canonicalPlayerClubId === null
    ).length,
    totalVotes: reconciled.reduce((sum, row) => sum + row.numericVotes, 0),
    evidenceSetSha256,
    reconciled,
  } as const;
}
