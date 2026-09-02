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
  readonly canonicalPlayerClubId: string;
  readonly canonicalMatchId: string;
  readonly canonicalClubName: string;
  readonly resolvedPlayerName: string;
  readonly identityMappingEvidenceId: string | null;
  readonly identityMappingReviewDecisionId: string | null;
}

export interface LocalScopedAflcaReviewedIdentityMapping {
  readonly seasonYear: number;
  readonly recordedPlayerName: string;
  readonly canonicalClubName: string;
  readonly canonicalPlayerClubId: string;
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

function unorderedRoundMatchKey(value: {
  seasonYear: number;
  roundNumber: number;
  homeClubName: string;
  awayClubName: string;
}): string {
  return [
    value.seasonYear,
    value.roundNumber,
    ...[value.homeClubName, value.awayClubName].sort(),
  ].join('\u0000');
}

function orderedSeasonMatchKey(value: {
  seasonYear: number;
  homeClubName: string;
  awayClubName: string;
}): string {
  return [value.seasonYear, value.homeClubName, value.awayClubName].join('\u0000');
}

function addCandidate(index: Map<string, Set<string>>, key: string, matchKeyValue: string): void {
  const candidates = index.get(key) ?? new Set<string>();
  candidates.add(matchKeyValue);
  index.set(key, candidates);
}

function soleCandidate(candidates: ReadonlySet<string> | undefined): string | undefined {
  return candidates?.size === 1 ? [...candidates][0] : undefined;
}

function compactName(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '');
}

function fallbackNameKey(value: string): string {
  const tokens = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .split(/ +/u);
  const first = tokens[0]?.[0];
  const last = tokens.at(-1);
  if (first === undefined || last === undefined) {
    throw new TypeError('A reconciled player name must contain a first and last token.');
  }
  return `${first}\u0000${last}`;
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
}) {
  if (input.expectedParticipants.length === 0 || input.votes.length === 0) {
    throw new TypeError('Scoped AFLCA reconciliation requires factual participants and votes.');
  }
  const participantsByMatch = new Map<string, LocalScopedAflTablesParticipant[]>();
  const canonicalMatchByKey = new Map<string, string>();
  const matchKeysByUnorderedRound = new Map<string, Set<string>>();
  const matchKeysByOrderedSeason = new Map<string, Set<string>>();
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
    addCandidate(matchKeysByUnorderedRound, unorderedRoundMatchKey(participant), key);
    addCandidate(matchKeysByOrderedSeason, orderedSeasonMatchKey(participant), key);
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
    const resolvedMatchKey =
      (participantsByMatch.has(exactKey) ? exactKey : undefined) ??
      soleCandidate(
        matchKeysByUnorderedRound.get(
          unorderedRoundMatchKey({ ...vote, homeClubName, awayClubName })
        )
      ) ??
      soleCandidate(
        matchKeysByOrderedSeason.get(orderedSeasonMatchKey({ ...vote, homeClubName, awayClubName }))
      );
    if (resolvedMatchKey === undefined) {
      throw new TypeError('A scoped AFLCA row does not resolve to one reviewed AFL Tables match.');
    }
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
      ({ recordedPlayerName }) =>
        compactName(recordedPlayerName) === compactName(parsedPlayer.playerName)
    );
    if (candidates.length === 0) {
      const fallbackKey = fallbackNameKey(parsedPlayer.playerName);
      candidates = clubParticipants.filter(
        ({ recordedPlayerName }) => fallbackNameKey(recordedPlayerName) === fallbackKey
      );
    }
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
    if (candidates.length !== 1) {
      throw new TypeError(
        `A scoped AFLCA row must resolve to exactly one AFL Tables player: ` +
          `${vote.seasonYear} round ${vote.roundNumber}, ${vote.recordedPlayerName}, ` +
          `${candidates.length} candidates.`
      );
    }
    const player = candidates[0]!;
    observedMatchKeys.add(resolvedMatchKey);
    voteTotalByMatch.set(
      resolvedMatchKey,
      (voteTotalByMatch.get(resolvedMatchKey) ?? 0) + vote.numericVotes
    );
    reconciled.push({
      ...vote,
      canonicalPlayerClubId: requireText(player.canonicalPlayerClubId, 'canonical player-club ID'),
      canonicalMatchId,
      canonicalClubName: parsedPlayer.clubName,
      resolvedPlayerName: player.recordedPlayerName,
      identityMappingEvidenceId,
      identityMappingReviewDecisionId,
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
  const evidenceSetSha256 = sha256AflTradeCanonicalJson(reconciled);
  return {
    matchCount: observedMatchKeys.size,
    voteRowCount: reconciled.length,
    totalVotes: reconciled.reduce((sum, row) => sum + row.numericVotes, 0),
    evidenceSetSha256,
    reconciled,
  } as const;
}
