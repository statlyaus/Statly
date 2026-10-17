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
import {
  createAflTradeExternalReconciliationCandidate,
  retainAflTradePickOutcomes,
} from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import { gradeAflTradesOnRealizedValue } from '@/server/aflTradeIntelligence/valuation/realizedTradeGrade';

type Claim = AflTradeExternalEvidenceContent['claim'];
const digest = (character: string) => character.repeat(64);
const capturedAt = '2026-10-16T00:00:00.000Z';

function batch(suffix: string, claims: Claim[]) {
  const capture = {
    captureId: `source-capture:${digest(suffix)}`,
    artifactId: `artifact:${digest(suffix)}`,
    contentSha256: digest(suffix),
    mediaType: 'text/html',
    sourceUrl: `https://example.test/draftguru/${suffix}`,
    capturedAt,
    effectiveAt: '2024-11-12T00:00:00.000Z',
    parserVersion: 'draftguru/v2',
    fieldManifestSha256: digest('9'),
  };
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider: 'draftguru',
    captureId: capture.captureId,
    evidence: claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider: 'draftguru',
        capture,
        sourceRow: { ordinal: index + 1, sourceKey: `draftguru:${suffix}:${index + 1}` },
        claim,
        publicationEligible: false,
      })
    ),
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
}

const entity = (recordedName: string) => ({ nativeId: null, recordedName });
const PICK_ID = 'pick:2025:national:r4';

/**
 * One Draftguru trade page in the 2024 trade period: `from` sends the 2025 fourth-round pick
 * Collingwood owned to `to` for a player, and the page states the pick was not used, as Draftguru
 * reports the pick's final fate on every page it passed through.
 */
function page(
  eventId: string,
  occurredOn: string | null,
  from: string,
  to: string,
  playerName: string
): Claim[] {
  return [
    {
      kind: 'transaction',
      nativeEventId: eventId,
      seasonYear: 2024,
      occurredOn,
      transactionType: 'trade',
      title: null,
    },
    ...[from, to].map((club): Claim => ({
      kind: 'transaction_party',
      nativeEventId: eventId,
      nativePartyId: club.toLowerCase(),
      club: entity(club),
    })),
    {
      kind: 'directed_transfer',
      nativeEventId: eventId,
      nativeTransferId: PICK_ID,
      fromClub: entity(from),
      toClub: entity(to),
      asset: {
        kind: 'future_pick',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 4,
        originalClub: entity('Collingwood'),
      },
    },
    {
      kind: 'directed_transfer',
      nativeEventId: eventId,
      nativeTransferId: `player:${playerName}`,
      fromClub: entity(to),
      toClub: entity(from),
      asset: { kind: 'player', player: entity(playerName) },
    },
    {
      kind: 'pick_disposition',
      nativeEventId: eventId,
      nativeTransferId: PICK_ID,
      receivingClub: entity(to),
      disposition: 'not_used',
    },
  ];
}

const clubs = ['Collingwood', 'Hawthorn', 'Essendon', 'Richmond', 'Melbourne', 'Adelaide'];
const players = ['Player One', 'Player Two', 'Player Three', 'Player Four'];
const clubId = (club: string) => `club-${club.toLowerCase()}`;
const playerId = (player: string) => `player-${player.toLowerCase().replace(/ /g, '-')}`;
const resolution = (entityKind: 'club' | 'player', name: string, canonicalId: string) =>
  createAflTradeExternalIdentityResolution({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    provider: 'draftguru',
    entityKind,
    sourceIdentity: entity(name),
    canonicalId,
    reviewDecisionId: `review-decision:${digest('a')}`,
    reviewDecisionSha256: digest('a'),
    decidedAt: '2026-10-11T00:00:00.000Z',
    status: 'current_approved',
  });
const identityResolutions = [
  ...clubs.map((club) => resolution('club', club, clubId(club))),
  ...players.map((player) => resolution('player', player, playerId(player))),
];

function reconcile(pages: Claim[][]) {
  return reconcileAflTradeExternalEvidence({
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2024,
    sourceBatches: pages.map((claims, index) => batch('abcdef'[index]!, claims)),
    identityResolutions,
    reconciledAt: '2026-10-16T01:00:00.000Z',
  }).content;
}
type Candidate = ReturnType<typeof reconcile>;

const pickTransfer = (candidate: Candidate, from: string, to: string) =>
  candidate.transfers.find(
    (transfer) =>
      transfer.asset.kind === 'pick_entitlement' &&
      transfer.fromClubId === clubId(from) &&
      transfer.toClubId === clubId(to)
  )!;
const outcomeOf = (candidate: Candidate, from: string, to: string) =>
  candidate.pickOutcomes?.find(
    ({ transferId }) => transferId === pickTransfer(candidate, from, to).transferId
  );

// The 2024 fourth-round shape on the genuine candidate (issue 789): Collingwood → Hawthorn →
// Essendon → Richmond, every page stating "not used".
const chain = () => [
  page('2024-collingwood-hawthorn', '2024-10-07', 'Collingwood', 'Hawthorn', 'Player One'),
  page('2024-hawthorn-essendon', '2024-10-09', 'Hawthorn', 'Essendon', 'Player Two'),
  page('2024-essendon-richmond', '2024-10-11', 'Essendon', 'Richmond', 'Player Three'),
];

function grade(candidate: Candidate) {
  const pav = [
    // Each player's 2025 season at the club he joined.
    { player: 'Player One', club: 'Collingwood', value: 4 },
    { player: 'Player Two', club: 'Hawthorn', value: 7 },
    { player: 'Player Three', club: 'Essendon', value: 5 },
  ];
  return gradeAflTradesOnRealizedValue({
    candidateId: `external-reconciliation:${digest('c')}`,
    candidate,
    pavCalculations: [{ season: 2025, calculationId: 'hpn-pav-season:2025', official: true }],
    pav: pav.map(({ player, club, value }) => ({
      playerId: playerId(player),
      season: 2025,
      clubId: clubId(club),
      value,
    })),
    seasonSpells: pav.map(({ player, club }) => ({
      playerId: playerId(player),
      season: 2025,
      clubId: clubId(club),
    })),
    spellSeasons: [2025],
    reviewedArrivals: [],
    pickProjectionBenchmarkId: `hpn-pick-benchmark:${digest('b')}`,
    spellCutoffAt: '2026-10-16T00:00:00.000Z',
    gradedAt: '2026-10-16T02:00:00.000Z',
  }).content;
}
const legOf = (candidate: Candidate, batch: ReturnType<typeof grade>, from: string, to: string) =>
  batch.trades
    .flatMap(({ legs }) => legs)
    .find(({ transferId }) => transferId === pickTransfer(candidate, from, to).transferId)!;

describe('a stated not-used pick its club traded on (statlyaus/Statly#789)', () => {
  it('records every hop but the final holder as traded on, keeping what was stated', () => {
    const candidate = reconcile(chain());
    for (const [from, to] of [
      ['Collingwood', 'Hawthorn'],
      ['Hawthorn', 'Essendon'],
    ] as const)
      expect(outcomeOf(candidate, from, to)).toMatchObject({
        disposition: 'traded_on',
        outcomeStatus: 'stated',
        statedDisposition: 'not_used',
        selectionId: null,
        playerId: null,
      });
    const final = outcomeOf(candidate, 'Essendon', 'Richmond');
    expect(final?.disposition).toBe('not_used');
    expect(final).not.toHaveProperty('statedDisposition');
    // The contradiction is recorded on the outcome, never as a blocking issue.
    expect(candidate.issues.filter(({ code }) => code === 'pick_outcome_unresolved')).toHaveLength(
      0
    );
  });

  it('lets the grader value each intermediate hop by its onward return', () => {
    const candidate = reconcile(chain());
    const batch = grade(candidate);
    const tx = (from: string, to: string) => pickTransfer(candidate, from, to).transactionId;
    // Hawthorn traded the pick on for Player Two (7); Essendon for Player Three (5).
    expect(legOf(candidate, batch, 'Collingwood', 'Hawthorn')).toMatchObject({
      state: 'valued',
      basis: 'pick_traded_on_return',
      realizedValue: 7,
      onward: { transactionId: tx('Hawthorn', 'Essendon'), allocation: 'sole_asset' },
    });
    expect(legOf(candidate, batch, 'Collingwood', 'Hawthorn').reasons).toContain(
      'stated_not_used_traded_on'
    );
    expect(legOf(candidate, batch, 'Hawthorn', 'Essendon')).toMatchObject({
      state: 'valued',
      basis: 'pick_traded_on_return',
      realizedValue: 5,
      onward: { transactionId: tx('Essendon', 'Richmond') },
    });
    // Richmond, the final holder, is not traded on: its 2025 pick waits on its draft.
    const final = legOf(candidate, batch, 'Essendon', 'Richmond');
    expect(final.basis).not.toBe('pick_traded_on_return');
    expect(final.reasons).not.toContain('stated_not_used_traded_on');
  });

  it('leaves a single not-used hop unchanged', () => {
    const candidate = reconcile([chain()[0]!]);
    const outcome = outcomeOf(candidate, 'Collingwood', 'Hawthorn');
    expect(outcome?.disposition).toBe('not_used');
    expect(outcome).not.toHaveProperty('statedDisposition');
  });

  it('leaves a not-used hop unchanged when another club gave the same pick away later', () => {
    const candidate = reconcile([
      chain()[0]!,
      page('2024-melbourne-adelaide', '2024-10-09', 'Melbourne', 'Adelaide', 'Player Four'),
    ]);
    const outcome = outcomeOf(candidate, 'Collingwood', 'Hawthorn');
    expect(outcome?.disposition).toBe('not_used');
    expect(outcome).not.toHaveProperty('statedDisposition');
  });

  it('leaves a not-used hop unchanged when its club gave the pick away before receiving it', () => {
    const candidate = reconcile([
      page('2024-hawthorn-collingwood', '2024-10-03', 'Hawthorn', 'Collingwood', 'Player Four'),
      chain()[0]!,
    ]);
    const outcome = outcomeOf(candidate, 'Collingwood', 'Hawthorn');
    expect(outcome?.disposition).toBe('not_used');
    expect(outcome).not.toHaveProperty('statedDisposition');
    expect(outcomeOf(candidate, 'Hawthorn', 'Collingwood')).toMatchObject({
      disposition: 'traded_on',
      statedDisposition: 'not_used',
    });
  });

  it('refuses a candidate that overrides the final holder with no onward transfer', () => {
    const candidate = reconcile(chain());
    const final = outcomeOf(candidate, 'Essendon', 'Richmond')!;
    const tampered = {
      ...candidate,
      pickOutcomes: candidate.pickOutcomes!.map((outcome) =>
        outcome.outcomeId === final.outcomeId
          ? {
              outcomeId: outcome.outcomeId,
              transferId: outcome.transferId,
              disposition: 'traded_on' as const,
              outcomeStatus: 'stated' as const,
              selectionId: null,
              playerId: null,
              statedDisposition: 'not_used' as const,
              evidenceIds: outcome.evidenceIds,
            }
          : outcome
      ),
    };
    expect(() => createAflTradeExternalReconciliationCandidate(tampered)).toThrow(
      /gave the same pick away in a later trade/
    );
    expect(() => createAflTradeExternalReconciliationCandidate(candidate)).not.toThrow();
  });

  it('keeps a traded-on override in a derived candidate only with its onward transfer', () => {
    const candidate = reconcile(chain());
    const { transactions, transfers, draftSelections, pickCustody, pickOutcomes } = candidate;
    expect(
      retainAflTradePickOutcomes(pickOutcomes, {
        transactions,
        transfers,
        draftSelections,
        pickCustody,
      })
    ).toEqual({ pickOutcomes });
    // Without the Hawthorn → Essendon trade, Collingwood → Hawthorn can no longer show it was traded
    // on, so its override is dropped rather than refused.
    const onward = pickTransfer(candidate, 'Hawthorn', 'Essendon').transactionId;
    const kept = retainAflTradePickOutcomes(pickOutcomes, {
      transactions: transactions.filter(({ transactionId }) => transactionId !== onward),
      transfers: transfers.filter(({ transactionId }) => transactionId !== onward),
      draftSelections,
      pickCustody,
    });
    expect(kept.pickOutcomes?.map(({ transferId }) => transferId).sort()).toEqual(
      [pickTransfer(candidate, 'Essendon', 'Richmond').transferId].sort()
    );
  });
});

describe('an undated swap back, ordered by the Draftguru pick-trade sequence (statlyaus/Statly#789)', () => {
  // The 2024 St Kilda and Essendon shape: Collingwood → Hawthorn, then Hawthorn → Collingwood, both
  // pages undated and both stating "not used", as Draftguru stamps the final fate on every hop.
  const swapBack = (first: string, second: string) => [
    page(first, null, 'Collingwood', 'Hawthorn', 'Player One'),
    page(second, null, 'Hawthorn', 'Collingwood', 'Player Two'),
  ];

  it('keeps the final holder’s hop not used and values the first hop by its onward return', () => {
    const candidate = reconcile(
      swapBack('2024-picks-collingwood-hawthorn-25', '2024-picks-collingwood-hawthorn-30')
    );
    expect(outcomeOf(candidate, 'Collingwood', 'Hawthorn')).toMatchObject({
      disposition: 'traded_on',
      statedDisposition: 'not_used',
    });
    const final = outcomeOf(candidate, 'Hawthorn', 'Collingwood');
    expect(final?.disposition).toBe('not_used');
    expect(final).not.toHaveProperty('statedDisposition');
    // Hawthorn traded the pick back for Player Two (7 at Hawthorn).
    expect(legOf(candidate, grade(candidate), 'Collingwood', 'Hawthorn')).toMatchObject({
      state: 'valued',
      basis: 'pick_traded_on_return',
      realizedValue: 7,
      onward: { transactionId: pickTransfer(candidate, 'Hawthorn', 'Collingwood').transactionId },
    });
  });

  it('follows the sequence, not the order the pages were captured in', () => {
    const candidate = reconcile(
      swapBack('2024-picks-collingwood-hawthorn-30', '2024-picks-collingwood-hawthorn-25')
    );
    // Hawthorn → Collingwood (25) came first, so Collingwood → Hawthorn (30) is the final hop.
    expect(outcomeOf(candidate, 'Hawthorn', 'Collingwood')).toMatchObject({
      disposition: 'traded_on',
    });
    expect(outcomeOf(candidate, 'Collingwood', 'Hawthorn')?.disposition).toBe('not_used');
  });

  it('still reads both player-trade hops as traded on, and the grader blocks the ring', () => {
    const candidate = reconcile(swapBack('2024-collingwood-hawthorn', '2024-hawthorn-collingwood'));
    for (const [from, to] of [
      ['Collingwood', 'Hawthorn'],
      ['Hawthorn', 'Collingwood'],
    ] as const) {
      expect(outcomeOf(candidate, from, to)?.disposition).toBe('traded_on');
      expect(legOf(candidate, grade(candidate), from, to).reasons).toContain(
        'traded_on_return_blocked'
      );
    }
  });
});
