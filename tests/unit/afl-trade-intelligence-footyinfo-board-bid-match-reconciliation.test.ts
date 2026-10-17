import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import {
  AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
  createAflTradeExternalIdentityResolution,
  reconcileAflTradeExternalEvidence,
} from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import { parseAflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { isAflTradePickSideReconciliationIssue } from '@/server/aflTradeIntelligence/source/pickLineageDeferral';

/**
 * Footyinfo matched bids in reconciliation (parser v2, issue 789): one `draftBoardBidMatches` record
 * per bid-match row, its clubs and nominee resolved, so the candidate conserves the row.
 */
type Claim = AflTradeExternalEvidenceContent['claim'];
const digest = (character: string) => character.repeat(64);
const capturedAt = '2026-10-17T00:00:00.000Z';

function board(claims: Claim[]) {
  const capture = {
    captureId: `source-capture:${digest('7')}`,
    artifactId: `artifact:${digest('7')}`,
    contentSha256: digest('7'),
    mediaType: 'text/html',
    sourceUrl: 'https://www.footyinfo.com/draft/2021',
    capturedAt,
    effectiveAt: capturedAt,
    parserVersion: 'footyinfo-draft-board-parser/v2',
    fieldManifestSha256: digest('9'),
  };
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider: 'footyinfo',
    captureId: capture.captureId,
    evidence: claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'footyinfo',
        capture,
        sourceRow: { ordinal: index + 1, sourceKey: `2021:national:${index + 1}` },
        claim,
        publicationEligible: false,
      })
    ),
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
}

const club = (nativeId: string, recordedName: string) => ({ nativeId, recordedName });
const WBD = club('WBD', 'Western Bulldogs');
const GWS = club('GWS', 'GWS');
const HAW = club('HAW', 'Hawthorn');
const darcy = { nativeId: 'sam-darcy', recordedName: 'Sam Darcy' };

const selection: Claim = {
  kind: 'draft_selection',
  draftYear: 2021,
  draftType: 'national',
  selectionNumber: 2,
  roundNumber: 1,
  player: darcy,
  selectedByClub: WBD,
};
const boardPick = (holder: typeof WBD, overrides: Partial<Claim> = {}): Claim =>
  ({
    kind: 'draft_board_pick',
    draftYear: 2021,
    draftType: 'national',
    roundNumber: 1,
    recordedPickNumber: 2,
    status: 'selected',
    club: holder,
    player: darcy,
    route: [],
    routeLabel: 'matched_bid',
    bid: { club: GWS, basis: 'father_son' },
    points: 2517,
    note: null,
    ...overrides,
  }) as Claim;
/** Hawthorn holds a removed pick, so its code is an entity the board states. */
const hawthornPick: Claim = {
  kind: 'draft_board_pick',
  draftYear: 2021,
  draftType: 'national',
  roundNumber: 4,
  recordedPickNumber: null,
  status: 'removed',
  club: HAW,
  route: [],
  routeLabel: null,
  bid: null,
  points: null,
  note: null,
};

/** Darcy's match, shortened to his last spent pick (Hawthorn's 45) and the leftover pick 61. */
const bidMatch = (originalClubCode = 'HAW'): Claim => ({
  kind: 'draft_board_bid_match',
  draftYear: 2021,
  draftType: 'national',
  nativePickId: '5733',
  selectionNumber: 2,
  roundNumber: 1,
  club: WBD,
  player: darcy,
  bid: { club: GWS, basis: 'father_son' },
  points: 2517,
  pointsUsed: 212,
  consumedPicks: [
    {
      nativePickId: '5727',
      label: 'R3 (HAW) - Pick 45',
      originalNumber: 45,
      originalClubCode,
      holdingClubCode: 'WBD',
      pointsUsed: 347,
    },
  ],
  leftoverPicks: [{ nativePickId: '5792', holdingClubCode: 'WBD', points: 135 }],
});

function identity(entityKind: 'club' | 'player', sourceIdentity: typeof WBD, canonicalId: string) {
  return createAflTradeExternalIdentityResolution({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    provider: 'footyinfo',
    entityKind,
    sourceIdentity,
    canonicalId,
    reviewDecisionId: `review-decision:${digest('a')}`,
    reviewDecisionSha256: digest('a'),
    decidedAt: '2026-10-11T00:00:00.000Z',
    status: 'current_approved',
  });
}
const identities = [
  identity('club', WBD, 'club-western-bulldogs'),
  identity('club', GWS, 'club-gws'),
  identity('club', HAW, 'club-hawthorn'),
  identity('player', darcy, 'player-sam-darcy'),
];

function reconcile(claims: Claim[], resolutions = identities) {
  const source = board(claims);
  const candidate = parseAflTradeExternalReconciliationCandidate(
    reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2021,
      sourceBatches: [source],
      identityResolutions: resolutions,
      reconciledAt: '2026-10-17T01:00:00.000Z',
    })
  ).content;
  return { candidate, rows: source.content.evidence };
}

describe('Footyinfo matched bids in reconciliation (issue 789)', () => {
  it('carries each bid match with its clubs and nominee resolved and cites its row', () => {
    const { candidate, rows } = reconcile([selection, boardPick(WBD), hawthornPick, bidMatch()]);
    const bidRow = rows.find(({ content }) => content.claim.kind === 'draft_board_bid_match')!;
    expect(candidate.draftBoardBidMatches).toEqual([
      {
        bidMatchId: expect.stringMatching(/^external-draft-board-bid-match:[0-9a-f]{64}$/),
        draftYear: 2021,
        draftType: 'national',
        nativePickId: '5733',
        selectionNumber: 2,
        roundNumber: 1,
        clubId: 'club-western-bulldogs',
        playerId: 'player-sam-darcy',
        bidClubId: 'club-gws',
        basis: 'father_son',
        points: 2517,
        pointsUsed: 212,
        consumedPicks: [
          {
            nativePickId: '5727',
            label: 'R3 (HAW) - Pick 45',
            originalNumber: 45,
            originalClubId: 'club-hawthorn',
            holdingClubId: 'club-western-bulldogs',
            pointsUsed: 347,
          },
        ],
        leftoverPicks: [
          { nativePickId: '5792', holdingClubId: 'club-western-bulldogs', points: 135 },
        ],
        evidenceIds: [bidRow.evidenceId],
      },
    ]);
    // Every staged row is cited by the candidate: the bid match only by its own record.
    const cited = new Set(
      [
        ...candidate.draftSelections,
        ...(candidate.draftBoardPicks ?? []),
        ...(candidate.draftBoardBidMatches ?? []),
      ].flatMap(({ evidenceIds }) => evidenceIds)
    );
    expect(rows.filter(({ evidenceId }) => !cited.has(evidenceId))).toEqual([]);
    expect(candidate.issues).toEqual([]);
  });

  it('reports a bidding club with no resolution as a pick-side board-pick issue', () => {
    const { candidate, rows } = reconcile(
      [selection, boardPick(WBD), hawthornPick, bidMatch()],
      identities.filter(({ content }) => content.sourceIdentity.nativeId !== 'GWS')
    );
    expect(candidate.draftBoardBidMatches?.[0]).toMatchObject({ bidClubId: null });
    const issue = candidate.issues.find(({ subjectKey }) => subjectKey === 'board-pick:club:GWS')!;
    expect(issue).toMatchObject({ code: 'identity_unresolved' });
    // Only the bid match resolves the bidder; the board pick states it but reads its holder only.
    expect(issue.evidenceIds).toEqual([
      rows.find(({ content }) => content.claim.kind === 'draft_board_bid_match')!.evidenceId,
    ]);
    expect(isAflTradePickSideReconciliationIssue(issue)).toBe(true);
  });

  it('leaves a spent pick’s club null when no club the board states carries its code', () => {
    const { candidate } = reconcile([selection, boardPick(WBD), hawthornPick, bidMatch('ZZZ')]);
    expect(candidate.draftBoardBidMatches?.[0]?.consumedPicks[0]).toMatchObject({
      originalClubId: null,
      holdingClubId: 'club-western-bulldogs',
    });
    expect(candidate.issues).toEqual([
      expect.objectContaining({ code: 'identity_unresolved', subjectKey: 'board-pick:club:ZZZ' }),
    ]);
  });

  it('adds no draftBoardBidMatches key without a matched bid, so candidate ids are unchanged', () => {
    expect(reconcile([selection, boardPick(WBD), hawthornPick]).candidate).not.toHaveProperty(
      'draftBoardBidMatches'
    );
  });
});
