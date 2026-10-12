import { describe, expect, it } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  authenticateAflTradeExternalCanonicalPromotionProposal,
  createAflTradeExternalCanonicalPromotionRequest,
  deriveAflTradeExternalCanonicalPromotionProposal,
  parseAflTradeExternalCanonicalPromotionRequest,
} from '@/server/aflTradeIntelligence/source/externalCanonicalPromotionContracts';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import {
  AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
  createAflTradeExternalIdentityResolution,
  reconcileAflTradeExternalEvidence,
} from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import {
  createAflTradeExternalReconciliationCandidate,
  parseAflTradeExternalReconciliationCandidate,
} from '@/server/aflTradeIntelligence/source/externalReconciliationCandidateContracts';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
  createAflTradeHistoricalCompletionReconciliationAuthority,
} from '@/server/aflTradeIntelligence/source/externalReconciliationSourceAuthorityContracts';
import {
  pickDefinitionDisposition,
  resolveWrittenPickDefinitions,
} from '@/server/aflTradeIntelligence/source/postgresExternalCanonicalPromotionRepository';
import {
  aflTradeCanonicalDraftKind,
  aflTradeDeferredCustodyIds,
  aflTradePickLineageDeferralScope,
  aflTradePromotedCustodyIds,
  aflTradePromotedDrafts,
  aflTradePromotedTransactions,
  aflTradePromotionWriteScope,
  isAflTradePickSideReconciliationIssue,
  isAflTradeUsableCustodyStatus,
  type AflTradeCurrentCanonicalPickCustody,
  type AflTradeCurrentCanonicalTransaction,
} from '@/server/aflTradeIntelligence/source/pickLineageDeferral';

const digest = (character: string) => character.repeat(64);
const capturedAt = '2026-08-09T04:00:00.000Z';
const completionId = `external-historical-capture-completion:${digest('9')}`;
const decisionId = `review-decision:${digest('d')}`;
const gws = { nativeId: null, recordedName: 'GWS' };
const bulldogs = { nativeId: 'western-bulldogs', recordedName: 'Western Bulldogs' };

function batch(
  provider: AflTradeExternalEvidenceContent['provider'],
  suffix: string,
  claims: AflTradeExternalEvidenceContent['claim'][]
) {
  const capture: AflTradeExternalEvidenceContent['capture'] = {
    captureId: `source-capture:${digest(suffix)}`,
    artifactId: `artifact:${digest(suffix)}`,
    contentSha256: digest(suffix),
    mediaType: 'text/html',
    sourceUrl: `https://example.test/${provider}/2025/${suffix}`,
    capturedAt,
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: `${provider}/v1`,
    fieldManifestSha256: digest('f'),
  };
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider,
    captureId: capture.captureId,
    evidence: claims.map((claim, index) =>
      createAflTradeExternalEvidenceEnvelope({
        schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
        provider,
        capture,
        sourceRow: { ordinal: index + 1, sourceKey: `${provider}:${index + 1}` },
        claim,
        publicationEligible: false,
      })
    ),
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
}

function resolution(
  provider: AflTradeExternalEvidenceContent['provider'],
  entityKind: 'club' | 'player',
  sourceIdentity: { nativeId: string | null; recordedName: string },
  canonicalId: string
) {
  return createAflTradeExternalIdentityResolution({
    schemaVersion: AFL_TRADE_EXTERNAL_IDENTITY_RESOLUTION_SCHEMA_VERSION,
    provider,
    entityKind,
    sourceIdentity,
    canonicalId,
    reviewDecisionId: `review-decision:${digest('a')}`,
    reviewDecisionSha256: digest('a'),
    decidedAt: '2026-08-09T03:00:00.000Z',
    status: 'current_approved',
  });
}

// A 2025 trade: a player one way (fully resolved) and pick 14 the other way with no custody evidence,
// so its lineage is unresolved. The 2025 national draft selection at 14 names a player nobody has
// reviewed, so that selection's identity is unresolved too. Both are pick-side (#869).
const draftguru = batch('draftguru', 'a', [
  {
    kind: 'transaction',
    nativeEventId: '2025-gws-bulldogs',
    seasonYear: 2025,
    occurredOn: '2025-10-15',
    transactionType: 'trade',
    title: 'GWS and Western Bulldogs trade',
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2025-gws-bulldogs',
    nativePartyId: 'gws',
    club: gws,
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2025-gws-bulldogs',
    nativePartyId: 'western-bulldogs',
    club: bulldogs,
  },
  {
    kind: 'directed_transfer',
    nativeEventId: '2025-gws-bulldogs',
    nativeTransferId: 'harry-kyle',
    fromClub: bulldogs,
    toClub: gws,
    asset: { kind: 'player', player: { nativeId: 'harry-kyle', recordedName: 'Harry Kyle' } },
  },
  {
    kind: 'directed_transfer',
    nativeEventId: '2025-gws-bulldogs',
    nativeTransferId: 'pick-14',
    fromClub: gws,
    toClub: bulldogs,
    asset: { kind: 'current_pick', draftYear: 2025, draftType: 'national', recordedPickNumber: 14 },
  },
  {
    kind: 'draft_selection',
    draftYear: 2025,
    draftType: 'national',
    selectionNumber: 14,
    roundNumber: 1,
    player: { nativeId: 'unreviewed-draftee', recordedName: 'Unreviewed Draftee' },
    selectedByClub: bulldogs,
  },
]);

const resolutions = [
  resolution('draftguru', 'club', gws, 'club-gws'),
  resolution('draftguru', 'club', bulldogs, 'club-western-bulldogs'),
  resolution(
    'draftguru',
    'player',
    { nativeId: 'harry-kyle', recordedName: 'Harry Kyle' },
    'player-harry-kyle'
  ),
];

const sourceAuthority = createAflTradeHistoricalCompletionReconciliationAuthority({
  schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
  kind: 'historical_plan_completion',
  completionId,
  completionSha256: digest('9'),
  planId: `external-historical-capture-plan:${digest('8')}`,
  planSha256: digest('7'),
  targetSetSha256: digest('6'),
  resultSetSha256: digest('5'),
  completionSourceBatchSetSha256: digest('4'),
  candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson([draftguru.batchId]),
  completedAt: '2026-08-09T04:30:00.000Z',
});

function reconcile(
  deferral: boolean,
  authority: boolean = true,
  promotedDraftSelectionIds?: readonly string[],
  promotedTransactions?: readonly AflTradeCurrentCanonicalTransaction[]
) {
  return reconcileAflTradeExternalEvidence({
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2025,
    sourceBatches: [draftguru],
    identityResolutions: resolutions,
    ...(authority ? { sourceAuthority } : {}),
    reconciledAt: '2026-08-09T05:00:00.000Z',
    ...(deferral ? { pickLineageDeferral: { decisionId } } : {}),
    ...(promotedDraftSelectionIds === undefined ? {} : { promotedDraftSelectionIds }),
    ...(promotedTransactions === undefined ? {} : { promotedTransactions }),
  });
}

const selection14 = createAflTradeContentAddress('external-draft-selection', {
  draftYear: 2025,
  draftType: 'national',
  selectionNumber: 14,
});

describe('reconciliation under a reviewed pick-side deferral (#869)', () => {
  it('without the option every issue is blocking and the candidate carries no deferral', () => {
    const candidate = reconcile(false);
    expect(candidate.content.pickLineageDeferral).toBeUndefined();
    expect(candidate.content.issues.length).toBeGreaterThan(0);
    expect(candidate.content.issues.every(({ severity }) => severity === 'blocking')).toBe(true);
    expect(candidate.content.issues.map(({ code }) => code).sort()).toEqual([
      'identity_unresolved',
      'lineage_unresolved',
    ]);
  });

  it('with the option the same inputs give the same candidate except severities and the decision', () => {
    const plain = reconcile(false);
    const deferred = reconcile(true);
    const { pickLineageDeferral, issues, transactions, ...deferredRest } = deferred.content;
    const { issues: plainIssues, transactions: plainTransactions, ...plainRest } = plain.content;
    expect(canonicalizeAflTradeJson(deferredRest)).toBe(canonicalizeAflTradeJson(plainRest));
    expect(pickLineageDeferral).toEqual({ decisionId });
    // The exchange is complete once its parties and every asset are identified; the pick's unresolved
    // custody is its lineage, which the deferral covers, so only the transaction status differs.
    expect(plainTransactions.map(({ status }) => status)).toEqual(['unresolved']);
    expect(transactions.map(({ status }) => status)).toEqual(['single_source']);
    expect(transactions.map(({ status: _status, ...rest }) => rest)).toEqual(
      plainTransactions.map(({ status: _status, ...rest }) => rest)
    );
    expect(issues.map(({ severity: _severity, ...rest }) => rest)).toEqual(
      plainIssues.map(({ severity: _severity, ...rest }) => rest)
    );
    expect(issues.every(({ severity }) => severity === 'deferred')).toBe(true);
    expect(deferred.candidateId).not.toBe(plain.candidateId);
    // Stored candidates still parse, and a deferred candidate parses through the same contract.
    expect(parseAflTradeExternalReconciliationCandidate(deferred).candidateId).toBe(
      deferred.candidateId
    );
  });

  it('keeps a player-side identity issue blocking under the deferral', () => {
    const unresolvedPlayer = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2025,
      sourceBatches: [draftguru],
      identityResolutions: resolutions.slice(0, 2),
      sourceAuthority,
      reconciledAt: '2026-08-09T05:00:00.000Z',
      pickLineageDeferral: { decisionId },
    });
    const blocking = unresolvedPlayer.content.issues.filter(
      ({ severity }) => severity === 'blocking'
    );
    expect(blocking).toEqual([
      expect.objectContaining({
        code: 'identity_unresolved',
        subjectKey: 'transfer:harry-kyle:player',
      }),
    ]);
    expect(blocking.some((issue) => isAflTradePickSideReconciliationIssue(issue))).toBe(false);
    expect(unresolvedPlayer.content.pickLineageDeferral).toEqual({ decisionId });
  });

  it('refuses the option on a candidate with no completion authority', () => {
    expect(() => reconcile(true, false)).toThrow(/completion authority/);
  });

  it('classifies subjects: lineage, custody, selection and pick-outcome are pick-side; transfer and transaction are not', () => {
    const pickSide = [
      { code: 'lineage_unresolved', subjectKey: 'lineage:external-transfer:x' },
      {
        code: 'pick_identity_conflict',
        subjectKey: 'pick-custody:draft-pick:x|2025-11-01T00:00:00.000Z',
      },
      { code: 'pick_outcome_unresolved', subjectKey: 'pick-outcome:e:t' },
      { code: 'identity_unresolved', subjectKey: 'selection:2025:national:14:player' },
      { code: 'identity_unresolved', subjectKey: 'selection:2025:national:14:club' },
      { code: 'identity_unresolved', subjectKey: 'pick-outcome:t:receiving-club' },
      // The club whose future pick is traded (candidate four's concession entitlements).
      {
        code: 'identity_unresolved',
        subjectKey: 'transfer:future-pick:2023:national:2:north-melbourne-concession:original-club',
      },
      { code: 'identity_unresolved', subjectKey: 'transfer:t:original-club' },
    ];
    const playerSide = [
      { code: 'identity_unresolved', subjectKey: 'transfer:t:player' },
      { code: 'identity_unresolved', subjectKey: 'transfer:t:from' },
      { code: 'identity_unresolved', subjectKey: 'transfer:t:to' },
      // The role is the suffix: a native transfer id containing the words is not the original club.
      { code: 'identity_unresolved', subjectKey: 'transfer:original-club:from' },
      { code: 'identity_unresolved', subjectKey: 'transfer:t:original-club:to' },
      { code: 'identity_resolution_conflict', subjectKey: 'transfer:t:original-club' },
      { code: 'identity_unresolved', subjectKey: 'custody:external-evidence:x:current' },
      { code: 'identity_unresolved', subjectKey: 'draft-session:2025:national:1:member:player' },
      { code: 'transaction_incomplete', subjectKey: 'transaction:e' },
      { code: 'selection_conflict', subjectKey: 'selection:2025:national:14' },
      { code: 'identity_resolution_conflict', subjectKey: 'draftguru|club|x' },
    ];
    expect(pickSide.map(isAflTradePickSideReconciliationIssue)).toEqual(pickSide.map(() => true));
    expect(playerSide.map(isAflTradePickSideReconciliationIssue)).toEqual(
      playerSide.map(() => false)
    );
  });
});

// A 2023 trade whose future pick names an original club nobody can review: Draftguru labels the
// North Melbourne concession entitlements as if they were clubs, and the owner rejected those names
// as club identities (statlyaus/Statly#869). The pick cannot be identified, so its custody cannot be:
// the original-club identity and the lineage are both pick-side.
const concession = { nativeId: null, recordedName: 'North Melbourne concession' };
const concessionTrade = batch('draftguru', 'b', [
  {
    kind: 'transaction',
    nativeEventId: '2023-gws-bulldogs',
    seasonYear: 2023,
    occurredOn: '2023-10-11',
    transactionType: 'trade',
    title: 'GWS and Western Bulldogs trade',
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2023-gws-bulldogs',
    nativePartyId: 'gws',
    club: gws,
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2023-gws-bulldogs',
    nativePartyId: 'western-bulldogs',
    club: bulldogs,
  },
  {
    kind: 'directed_transfer',
    nativeEventId: '2023-gws-bulldogs',
    nativeTransferId: 'harry-kyle',
    fromClub: bulldogs,
    toClub: gws,
    asset: { kind: 'player', player: { nativeId: 'harry-kyle', recordedName: 'Harry Kyle' } },
  },
  {
    kind: 'directed_transfer',
    nativeEventId: '2023-gws-bulldogs',
    nativeTransferId: 'future-pick:2024:national:1:north-melbourne-concession-1',
    fromClub: gws,
    toClub: bulldogs,
    asset: {
      kind: 'future_pick',
      draftYear: 2024,
      draftType: 'national',
      roundNumber: 1,
      originalClub: concession,
    },
  },
]);

function reconcileConcession(deferral: boolean) {
  return reconcileAflTradeExternalEvidence({
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2023,
    sourceBatches: [concessionTrade],
    identityResolutions: resolutions,
    sourceAuthority: createAflTradeHistoricalCompletionReconciliationAuthority({
      ...sourceAuthority,
      candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson([concessionTrade.batchId]),
    }),
    reconciledAt: '2026-08-09T05:00:00.000Z',
    ...(deferral ? { pickLineageDeferral: { decisionId } } : {}),
  });
}
const originalClubSubject =
  'transfer:future-pick:2024:national:1:north-melbourne-concession-1:original-club';

describe('a pick transfer whose original club is unresolved (#869 candidate four)', () => {
  it('without the option both the original-club identity and the lineage block', () => {
    const plain = reconcileConcession(false);
    expect(plain.content.pickLineageDeferral).toBeUndefined();
    expect(
      plain.content.issues.map(({ code, severity, subjectKey }) => ({ code, severity, subjectKey }))
    ).toEqual([
      {
        code: 'lineage_unresolved',
        severity: 'blocking',
        subjectKey: `lineage:${plain.content.transfers.find(({ asset }) => asset.kind === 'pick_entitlement')!.transferId}`,
      },
      { code: 'identity_unresolved', severity: 'blocking', subjectKey: originalClubSubject },
    ]);
    expect(plain.content.transactions.map(({ status }) => status)).toEqual(['unresolved']);
  });

  it('with the option both are deferred, the pick has no origin and no custody is written', () => {
    const deferred = reconcileConcession(true);
    expect(deferred.content.pickLineageDeferral).toEqual({ decisionId });
    expect(deferred.content.issues.map(({ severity }) => severity)).toEqual([
      'deferred',
      'deferred',
    ]);
    expect(deferred.content.issues.map(({ subjectKey }) => subjectKey)).toContain(
      originalClubSubject
    );
    const pickTransfer = deferred.content.transfers.find(
      ({ asset }) => asset.kind === 'pick_entitlement'
    )!;
    expect(pickTransfer).toMatchObject({
      status: 'unresolved',
      fromClubId: 'club-gws',
      toClubId: 'club-western-bulldogs',
      asset: { originalClubId: null, pickId: expect.stringMatching(/^draft-pick:[a-f0-9]{64}$/) },
    });
    // The exchange is complete: both parties and the traded player are identified.
    expect(deferred.content.transactions.map(({ status }) => status)).toEqual(['single_source']);
    const scope = aflTradePickLineageDeferralScope(deferred.content);
    expect(scope).toMatchObject({ deferredIssueCount: 2, blockingIssueCount: 0 });
    expect([...scope.deferredTransferIds]).toEqual([pickTransfer.transferId]);
    expect([...scope.deferredPickIds]).toEqual([(pickTransfer.asset as { pickId: string }).pickId]);
    expect([...scope.deferredDraftKeys]).toEqual([]);
    expect(aflTradePromotionWriteScope(deferred.content)).toMatchObject({
      draftSelections: [],
      pickCustody: [],
      pickLineage: [],
    });
    expect(parseAflTradeExternalReconciliationCandidate(deferred).candidateId).toBe(
      deferred.candidateId
    );
    const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
      candidate: deferred,
      proposedAt: '2026-08-09T07:31:00.000Z',
      draftEvents: [],
    });
    expect(
      authenticateAflTradeExternalCanonicalPromotionProposal({ candidate: deferred, proposal })
    ).toMatchObject({
      transactionCount: 1,
      transferCount: 2,
      pickCustodyCount: 0,
      pickRealizationCount: 0,
      pickLineageDeferral: { decisionId, deferredIssueCount: 2 },
    });
  });

  it('keeps the exchange clubs blocking: an unresolved sending club is not deferred', () => {
    const unresolvedSender = reconcileAflTradeExternalEvidence({
      environment: 'test_fixture',
      competition: 'AFLM',
      anchorSeasonYear: 2023,
      sourceBatches: [concessionTrade],
      // No GWS resolution: the party, the sender of the pick and the receiver of the player.
      identityResolutions: resolutions.slice(1),
      sourceAuthority: createAflTradeHistoricalCompletionReconciliationAuthority({
        ...sourceAuthority,
        candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson([concessionTrade.batchId]),
      }),
      reconciledAt: '2026-08-09T05:00:00.000Z',
      pickLineageDeferral: { decisionId },
    });
    const blocking = unresolvedSender.content.issues
      .filter(({ severity }) => severity === 'blocking')
      .map(({ code, subjectKey }) => ({ code, subjectKey }));
    expect(blocking).toEqual([
      { code: 'transaction_incomplete', subjectKey: 'transaction:2023-gws-bulldogs' },
      { code: 'identity_unresolved', subjectKey: 'transaction:2023-gws-bulldogs:party:gws' },
      {
        code: 'identity_unresolved',
        subjectKey: 'transfer:future-pick:2024:national:1:north-melbourne-concession-1:from',
      },
      { code: 'identity_unresolved', subjectKey: 'transfer:harry-kyle:to' },
    ]);
    expect(
      unresolvedSender.content.issues
        .filter(({ severity }) => severity === 'deferred')
        .map(({ subjectKey }) => subjectKey)
    ).toContain(originalClubSubject);
  });
});

describe('candidate contract for deferred issues', () => {
  it('refuses a deferred issue without the decision, and the decision without a deferred issue', () => {
    const deferred = reconcile(true).content;
    const { pickLineageDeferral: _dropped, ...withoutDecision } = deferred;
    expect(() => createAflTradeExternalReconciliationCandidate(withoutDecision)).toThrow(
      /requires the approved reconciliation-scope decision/
    );
    const plain = reconcile(false).content;
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...plain,
        pickLineageDeferral: { decisionId },
      })
    ).toThrow(/only by a candidate that deferred an issue/);
  });

  it('refuses a deferred player-side issue and a deferral on a legacy candidate', () => {
    const deferred = reconcile(true).content;
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...deferred,
        issues: [
          ...deferred.issues,
          {
            code: 'identity_unresolved',
            severity: 'deferred',
            subjectKey: 'transfer:harry-kyle:player',
            detail: 'A player identity marked deferred.',
            evidenceIds: deferred.issues[0]!.evidenceIds,
          },
        ],
      })
    ).toThrow(/Only a pick-side issue can be deferred/);
    for (const role of ['from', 'to'] as const) {
      expect(() =>
        createAflTradeExternalReconciliationCandidate({
          ...deferred,
          issues: [
            ...deferred.issues,
            {
              code: 'identity_unresolved',
              severity: 'deferred',
              subjectKey: `transfer:pick-14:${role}`,
              detail: 'An exchange club marked deferred.',
              evidenceIds: deferred.issues[0]!.evidenceIds,
            },
          ],
        })
      ).toThrow(/Only a pick-side issue can be deferred/);
    }
    // The original club of a traded pick is pick-side: the contract accepts it deferred.
    const concessionDeferred = reconcileConcession(true);
    expect(
      concessionDeferred.content.issues.find(({ subjectKey }) => subjectKey === originalClubSubject)
    ).toMatchObject({ severity: 'deferred' });
    expect(
      createAflTradeExternalReconciliationCandidate(concessionDeferred.content).candidateId
    ).toBe(concessionDeferred.candidateId);
    const { sourceAuthority: _authority, ...legacy } = deferred;
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...legacy,
        schemaVersion: AFL_TRADE_EXTERNAL_RECONCILIATION_SCHEMA_VERSION,
      })
    ).toThrow(/needs its authority/);
  });
});

describe('promotion of a deferred-lineage candidate', () => {
  const proposedAt = '2026-08-09T07:31:00.000Z';

  it('derives the deferral scope: the pick transfer, its pick and the 2025 draft are left unwritten', () => {
    const candidate = reconcile(true);
    const scope = aflTradePickLineageDeferralScope(candidate.content);
    const pickTransfer = candidate.content.transfers.find(
      ({ asset }) => asset.kind === 'pick_entitlement'
    )!;
    expect(scope.deferredIssueCount).toBe(2);
    expect(scope.blockingIssueCount).toBe(0);
    expect([...scope.deferredTransferIds]).toEqual([pickTransfer.transferId]);
    expect([...scope.deferredPickIds]).toEqual([(pickTransfer.asset as { pickId: string }).pickId]);
    expect([...scope.deferredDraftKeys]).toEqual(['2025|national']);
    const written = aflTradePromotionWriteScope(candidate.content);
    expect(written.draftSelections).toEqual([]);
    expect(written.pickCustody).toEqual([]);
    expect(written.pickLineage).toEqual([]);
  });

  it('refuses promotion without the deferral and derives it with, covering no deferred draft', () => {
    const plain = reconcile(false);
    expect(() =>
      deriveAflTradeExternalCanonicalPromotionProposal({
        candidate: plain,
        proposedAt,
        draftEvents: [
          {
            draftYear: 2025,
            draftType: 'national',
            eventDate: '2025-11-19',
            officialName: '2025 AFL National Draft',
          },
        ],
      })
    ).toThrow(/blocking issue cannot be promoted/);

    const deferred = reconcile(true);
    // The 2025 draft holds the deferred selection: the reviewer supplies no metadata for it.
    expect(() =>
      deriveAflTradeExternalCanonicalPromotionProposal({
        candidate: deferred,
        proposedAt,
        draftEvents: [
          {
            draftYear: 2025,
            draftType: 'national',
            eventDate: '2025-11-19',
            officialName: '2025 AFL National Draft',
          },
        ],
      })
    ).toThrow(/exactly match the candidate draft-event selection set/);
    const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
      candidate: deferred,
      proposedAt,
      draftEvents: [],
    });
    expect(proposal.content.draftEventCoverage).toEqual([]);
    const authenticated = authenticateAflTradeExternalCanonicalPromotionProposal({
      candidate: deferred,
      proposal,
    });
    expect(authenticated).toMatchObject({
      transactionCount: 1,
      transferCount: 2,
      draftSelectionCount: 0,
      pickCustodyCount: 0,
      pickRealizationCount: 0,
      pickLineageDeferral: { decisionId, deferredIssueCount: 2 },
    });
  });

  it('records the deferral on the receipt without changing earlier receipt addresses', () => {
    const base = {
      candidateId: `external-reconciliation:${digest('c')}`,
      proposalId: `external-canonical-promotion-proposal:${digest('b')}`,
      approvalDecisionId: `review-decision:${digest('a')}`,
    };
    const plain = createAflTradeExternalCanonicalPromotionRequest(base);
    const deferred = createAflTradeExternalCanonicalPromotionRequest({
      ...base,
      pickLineageDeferral: { decisionId, deferredIssueCount: 2 },
    });
    expect('pickLineageDeferral' in plain.content).toBe(false);
    expect(deferred.content.pickLineageDeferral).toEqual({ decisionId, deferredIssueCount: 2 });
    expect(deferred.promotionId).not.toBe(plain.promotionId);
    expect(parseAflTradeExternalCanonicalPromotionRequest(plain)).toEqual(plain);
    expect(() =>
      createAflTradeExternalCanonicalPromotionRequest({
        ...base,
        pickLineageDeferral: { decisionId, deferredIssueCount: 0 },
      })
    ).toThrow();
  });
});

// A deferred candidate may carry a draft that an earlier session-keyed promotion already made
// current canonical. The metadata-only path would create a second, session-less draft root with the
// same selections, so such a draft is recorded on the candidate and left to its promotion (#869).
describe('a deferred candidate whose draft is already current canonical', () => {
  it('records the draft at reconciliation only when every selection in it is promoted, and only under the deferral', () => {
    const recorded = reconcile(true, true, [selection14, 'external-draft-selection:other']);
    expect(recorded.content.pickLineageDeferral).toEqual({
      decisionId,
      promotedDrafts: [{ draftYear: 2025, draftType: 'national' }],
    });
    expect(recorded.candidateId).not.toBe(reconcile(true).candidateId);
    expect(
      reconcile(true, true, ['external-draft-selection:other']).content.pickLineageDeferral
    ).toEqual({ decisionId });
    expect(reconcile(true, true, []).candidateId).toBe(reconcile(true).candidateId);
    expect(() => reconcile(false, true, [selection14])).toThrow(/only under a pick-side deferral/);
    expect(parseAflTradeExternalReconciliationCandidate(recorded).candidateId).toBe(
      recorded.candidateId
    );
  });

  it('derives promoted drafts by draft, sorted, from the selection set', () => {
    const selections = [
      { selectionId: 'b', draftYear: 2024, draftType: 'rookie' },
      { selectionId: 'a', draftYear: 2024, draftType: 'national' },
      { selectionId: 'c', draftYear: 2023, draftType: 'national' },
      { selectionId: 'd', draftYear: 2023, draftType: 'national' },
    ];
    expect(aflTradePromotedDrafts(selections, new Set(['a', 'b', 'c']))).toEqual([
      { draftYear: 2024, draftType: 'national' },
      { draftYear: 2024, draftType: 'rookie' },
    ]);
    expect(aflTradePromotedDrafts(selections, new Set(['a', 'b', 'c', 'd']))).toEqual([
      { draftYear: 2023, draftType: 'national' },
      { draftYear: 2024, draftType: 'national' },
      { draftYear: 2024, draftType: 'rookie' },
    ]);
    expect(aflTradePromotedDrafts(selections, new Set())).toEqual([]);
  });

  it('leaves the draft and the realizations into it unwritten, and counts both', () => {
    // Hand-built content: one deferred pick (no custody) and one resolved pick whose lineage lands
    // in the already-promoted 2024 draft; a third lineage lands in a draft this candidate writes.
    const content = {
      transactions: [
        {
          transactionId: 'transaction:a',
          transferIds: ['transfer:deferred', 'transfer:resolved', 'transfer:written'],
        },
      ],
      transfers: [
        {
          transferId: 'transfer:deferred',
          transactionId: 'transaction:a',
          asset: { kind: 'pick_entitlement', pickId: 'pick:x' },
        },
        {
          transferId: 'transfer:resolved',
          transactionId: 'transaction:a',
          asset: { kind: 'pick_entitlement', pickId: 'pick:y' },
        },
        {
          transferId: 'transfer:written',
          transactionId: 'transaction:a',
          asset: { kind: 'pick_entitlement', pickId: 'pick:z' },
        },
      ],
      draftSelections: [
        { selectionId: 'sel:2024:1', draftYear: 2024, draftType: 'national', pickId: 'pick:y' },
        { selectionId: 'sel:2024:2', draftYear: 2024, draftType: 'national', pickId: 'pick:q' },
        { selectionId: 'sel:2025:1', draftYear: 2025, draftType: 'national', pickId: 'pick:z' },
      ],
      pickCustody: [
        { custodyId: 'custody:y', pickId: 'pick:y', status: 'single_source' },
        { custodyId: 'custody:z', pickId: 'pick:z', status: 'single_source' },
      ],
      pickLineage: [
        {
          lineageId: 'lineage:y',
          pickId: 'pick:y',
          transferId: 'transfer:resolved',
          selectionId: 'sel:2024:1',
        },
        {
          lineageId: 'lineage:z',
          pickId: 'pick:z',
          transferId: 'transfer:written',
          selectionId: 'sel:2025:1',
        },
      ],
      issues: [
        {
          code: 'lineage_unresolved',
          severity: 'deferred',
          subjectKey: 'lineage:transfer:deferred',
        },
      ],
      pickLineageDeferral: {
        decisionId,
        promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
      },
    };
    const scope = aflTradePickLineageDeferralScope(content);
    expect([...scope.promotedDraftKeys]).toEqual(['2024|national']);
    const written = aflTradePromotionWriteScope(content);
    expect(written.draftSelections.map(({ selectionId }) => selectionId)).toEqual(['sel:2025:1']);
    // Custody of the resolved pick is still written: only the realization into the promoted draft
    // is left out (its existing selection row keys the pick by slot, this candidate by custody).
    expect(written.pickCustody.map(({ custodyId }) => custodyId)).toEqual([
      'custody:y',
      'custody:z',
    ]);
    expect(written.pickLineage.map(({ lineageId }) => lineageId)).toEqual(['lineage:z']);
    expect(written.promotedDraftCount).toBe(1);
    expect(written.skippedRealizationCount).toBe(1);
    // Without the recorded draft the same content writes both drafts and both realizations.
    const { promotedDrafts: _drafts, ...decisionOnly } = content.pickLineageDeferral;
    const plain = aflTradePromotionWriteScope({ ...content, pickLineageDeferral: decisionOnly });
    expect(plain.draftSelections.length).toBe(3);
    expect(plain.pickLineage.length).toBe(2);
    expect(plain).toMatchObject({ promotedDraftCount: 0, skippedRealizationCount: 0 });
  });

  it('is refused by the candidate contract when it names a draft the candidate has no selection in, is unsorted, or has no decision', () => {
    const recorded = reconcile(true, true, [selection14]).content;
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...recorded,
        pickLineageDeferral: {
          decisionId,
          promotedDrafts: [{ draftYear: 2024, draftType: 'national' }],
        },
      })
    ).toThrow(/one the candidate holds a selection in/);
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...recorded,
        pickLineageDeferral: {
          decisionId,
          promotedDrafts: [
            { draftYear: 2025, draftType: 'national' },
            { draftYear: 2025, draftType: 'national' },
          ],
        },
      })
    ).toThrow(/unique and sorted/);
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...recorded,
        pickLineageDeferral: { decisionId, promotedDrafts: [] },
      })
    ).toThrow();
    const plain = reconcile(false).content;
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...plain,
        pickLineageDeferral: {
          decisionId,
          promotedDrafts: [{ draftYear: 2025, draftType: 'national' }],
        },
      })
    ).toThrow(/only by a candidate that deferred an issue/);
  });

  it('promotes through the metadata-only proposal with no coverage for the draft, and the receipt says so', () => {
    const recorded = reconcile(true, true, [selection14]);
    const proposedAt = '2026-08-09T07:31:00.000Z';
    // The reviewer may not supply metadata for a draft left to its earlier promotion.
    expect(() =>
      deriveAflTradeExternalCanonicalPromotionProposal({
        candidate: recorded,
        proposedAt,
        draftEvents: [
          {
            draftYear: 2025,
            draftType: 'national',
            eventDate: '2025-11-19',
            officialName: '2025 AFL National Draft',
          },
        ],
      })
    ).toThrow(/exactly match the candidate draft-event selection set/);
    const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
      candidate: recorded,
      proposedAt,
      draftEvents: [],
    });
    expect(proposal.content.draftEventCoverage).toEqual([]);
    const authenticated = authenticateAflTradeExternalCanonicalPromotionProposal({
      candidate: recorded,
      proposal,
    });
    expect(authenticated).toMatchObject({
      draftSelectionCount: 0,
      pickRealizationCount: 0,
      pickLineageDeferral: { decisionId, deferredIssueCount: 2, promotedDraftCount: 1 },
    });
    expect('skippedRealizationCount' in authenticated.pickLineageDeferral!).toBe(false);
    const base = {
      candidateId: recorded.candidateId,
      proposalId: proposal.proposalId,
      approvalDecisionId: `review-decision:${digest('a')}`,
    };
    const request = createAflTradeExternalCanonicalPromotionRequest({
      ...base,
      pickLineageDeferral: authenticated.pickLineageDeferral!,
    });
    expect(request.content.pickLineageDeferral).toEqual({
      decisionId,
      deferredIssueCount: 2,
      promotedDraftCount: 1,
    });
    expect(request.promotionId).not.toBe(
      createAflTradeExternalCanonicalPromotionRequest({
        ...base,
        pickLineageDeferral: { decisionId, deferredIssueCount: 2 },
      }).promotionId
    );
    expect(parseAflTradeExternalCanonicalPromotionRequest(request)).toEqual(request);
    expect(() =>
      createAflTradeExternalCanonicalPromotionRequest({
        ...base,
        pickLineageDeferral: { decisionId, deferredIssueCount: 2, promotedDraftCount: 0 },
      })
    ).toThrow();
  });
});

// A deferred candidate may carry a trade that an earlier promotion already made current canonical,
// with every transfer a promoted asset on that version. Promoting it again would write a new trade
// version over the current one and duplicate its assets, so such a transaction is recorded on the
// candidate and left to its promotion: no trade version, no asset, no custody, no realization (#869,
// owner decision 2026-10-11).
const concessionRight = batch('draftguru', 'c', [
  {
    kind: 'transaction',
    nativeEventId: '2019-geelong-gold-coast',
    seasonYear: 2019,
    occurredOn: '2019-10-16',
    transactionType: 'trade',
    title: 'Geelong and Gold Coast trade for draft picks',
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2019-geelong-gold-coast',
    nativePartyId: 'gws',
    club: gws,
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2019-geelong-gold-coast',
    nativePartyId: 'western-bulldogs',
    club: bulldogs,
  },
  {
    kind: 'directed_transfer',
    nativeEventId: '2019-geelong-gold-coast',
    nativeTransferId: 'harry-kyle',
    fromClub: bulldogs,
    toClub: gws,
    asset: { kind: 'player', player: { nativeId: 'harry-kyle', recordedName: 'Harry Kyle' } },
  },
  {
    kind: 'directed_transfer',
    nativeEventId: '2019-geelong-gold-coast',
    nativeTransferId: 'special-pick:2020MIDR1',
    fromClub: gws,
    toClub: bulldogs,
    asset: {
      kind: 'special_pick',
      entitlementType: 'assistance_concession',
      draftYear: 2020,
      selectionOrdinal: null,
      sourceLabel: '2020MIDR1 (Gold Coast concession)',
    },
  },
  // A second, ordinary trade the candidate writes.
  {
    kind: 'transaction',
    nativeEventId: '2019-bulldogs-gws',
    seasonYear: 2019,
    occurredOn: '2019-10-14',
    transactionType: 'trade',
    title: 'Western Bulldogs and GWS trade',
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2019-bulldogs-gws',
    nativePartyId: 'gws',
    club: gws,
  },
  {
    kind: 'transaction_party',
    nativeEventId: '2019-bulldogs-gws',
    nativePartyId: 'western-bulldogs',
    club: bulldogs,
  },
  {
    kind: 'directed_transfer',
    nativeEventId: '2019-bulldogs-gws',
    nativeTransferId: 'harry-kyle-back',
    fromClub: gws,
    toClub: bulldogs,
    asset: { kind: 'player', player: { nativeId: 'harry-kyle', recordedName: 'Harry Kyle' } },
  },
]);
const concessionTransactionId = createAflTradeContentAddress('external-transaction', {
  provider: 'draftguru',
  nativeEventId: '2019-geelong-gold-coast',
});
const concessionTransferIds = ['harry-kyle', 'special-pick:2020MIDR1'].map((nativeTransferId) =>
  createAflTradeContentAddress('external-transfer', {
    transactionId: concessionTransactionId,
    nativeTransferId,
  })
);

function reconcileRight(
  deferral: boolean,
  promotedTransactions?: readonly AflTradeCurrentCanonicalTransaction[]
) {
  return reconcileAflTradeExternalEvidence({
    environment: 'test_fixture',
    competition: 'AFLM',
    anchorSeasonYear: 2019,
    sourceBatches: [concessionRight],
    identityResolutions: resolutions,
    sourceAuthority: createAflTradeHistoricalCompletionReconciliationAuthority({
      ...sourceAuthority,
      candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson([concessionRight.batchId]),
    }),
    reconciledAt: '2026-08-09T05:00:00.000Z',
    ...(deferral ? { pickLineageDeferral: { decisionId } } : {}),
    ...(promotedTransactions === undefined ? {} : { promotedTransactions }),
  });
}

describe('a deferred candidate whose transaction is already current canonical', () => {
  const proposedAt = '2026-08-09T07:31:00.000Z';
  // The concession trade moves a player and a special pick: no transfer names a pick id.
  const promoted = [
    {
      transactionId: concessionTransactionId,
      transferIds: concessionTransferIds,
      reviewedLineage: false,
      transferPickIds: [],
    },
  ];

  it('derives promoted transactions only when every transfer is promoted, sorted', () => {
    const transactions = [
      { transactionId: 'transaction:b', transferIds: ['t1', 't2'] },
      { transactionId: 'transaction:a', transferIds: ['t3'] },
      { transactionId: 'transaction:c', transferIds: ['t4'] },
    ];
    const transfers = ['t1', 't2', 't3', 't4'].map((transferId) => ({
      transferId,
      asset: { kind: 'player' },
    }));
    const current = [
      {
        transactionId: 'transaction:b',
        transferIds: ['t1', 't2', 't9'],
        reviewedLineage: false,
        transferPickIds: [],
      },
      {
        transactionId: 'transaction:a',
        transferIds: ['t3'],
        reviewedLineage: false,
        transferPickIds: [],
      },
      {
        transactionId: 'transaction:c',
        transferIds: ['t5'],
        reviewedLineage: false,
        transferPickIds: [],
      },
    ];
    expect(aflTradePromotedTransactions(transactions, transfers, current)).toEqual([
      'transaction:a',
      'transaction:b',
    ]);
    expect(aflTradePromotedTransactions(transactions, transfers, [])).toEqual([]);
  });

  it('records the transaction at reconciliation only under the deferral and only when fully promoted', () => {
    const recorded = reconcileRight(true, promoted);
    expect(recorded.content.pickLineageDeferral).toEqual({
      decisionId,
      promotedTransactions: [concessionTransactionId],
    });
    expect(recorded.candidateId).not.toBe(reconcileRight(true).candidateId);
    expect(
      reconcileRight(true, [
        {
          transactionId: concessionTransactionId,
          transferIds: [concessionTransferIds[0]!],
          reviewedLineage: false,
          transferPickIds: [],
        },
      ]).content.pickLineageDeferral
    ).toEqual({ decisionId });
    expect(() => reconcileRight(false, promoted)).toThrow(/only under a pick-side deferral/);
    expect(parseAflTradeExternalReconciliationCandidate(recorded).candidateId).toBe(
      recorded.candidateId
    );
  });

  it('is refused by the candidate contract when it names a transaction the candidate does not hold, or has no decision', () => {
    const recorded = reconcileRight(true, promoted).content;
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...recorded,
        pickLineageDeferral: {
          decisionId,
          promotedTransactions: [`external-transaction:${digest('0')}`],
        },
      })
    ).toThrow(/one the candidate holds/);
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...recorded,
        pickLineageDeferral: { decisionId, promotedTransactions: [] },
      })
    ).toThrow();
    const plain = reconcileRight(false).content;
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...plain,
        pickLineageDeferral: { decisionId, promotedTransactions: [concessionTransactionId] },
      })
    ).toThrow(/only by a candidate that deferred an issue/);
  });

  it('leaves the transaction, its transfers and the special pick in it unwritten; the other trade is written', () => {
    // Without the record the special pick in the first trade refuses promotion, deferral or not.
    expect(() =>
      deriveAflTradeExternalCanonicalPromotionProposal({
        candidate: reconcileRight(true),
        proposedAt,
        draftEvents: [],
      })
    ).toThrow(/Special entitlement must be resolved before canonical promotion/);
    const recorded = reconcileRight(true, promoted);
    const scope = aflTradePromotionWriteScope(recorded.content);
    expect([...scope.deferral.promotedTransactionIds]).toEqual([concessionTransactionId]);
    expect(scope.transactions.map(({ transactionId }) => transactionId)).toEqual(
      recorded.content.transactions
        .filter(({ transactionId }) => transactionId !== concessionTransactionId)
        .map(({ transactionId }) => transactionId)
    );
    expect(scope.transfers.map(({ transactionId }) => transactionId)).toEqual(
      scope.transactions.map(({ transactionId }) => transactionId)
    );
    expect(scope.promotedTransactionCount).toBe(1);
    const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
      candidate: recorded,
      proposedAt,
      draftEvents: [],
    });
    // The reviewer supplies no date for a transaction left to its earlier promotion.
    expect(
      proposal.content.transactionDateCoverage.map(({ transactionId }) => transactionId)
    ).toEqual(scope.transactions.map(({ transactionId }) => transactionId));
    const authenticated = authenticateAflTradeExternalCanonicalPromotionProposal({
      candidate: recorded,
      proposal,
    });
    expect(authenticated).toMatchObject({
      transactionCount: 1,
      transferCount: 1,
      pickCustodyCount: 0,
      pickRealizationCount: 0,
      pickLineageDeferral: {
        decisionId,
        deferredIssueCount: 1,
        promotedTransactionCount: 1,
        promotedTransactionIds: [concessionTransactionId],
      },
    });
    const request = createAflTradeExternalCanonicalPromotionRequest({
      candidateId: recorded.candidateId,
      proposalId: proposal.proposalId,
      approvalDecisionId: `review-decision:${digest('a')}`,
      pickLineageDeferral: authenticated.pickLineageDeferral!,
    });
    expect(parseAflTradeExternalCanonicalPromotionRequest(request)).toEqual(request);
    expect(() =>
      createAflTradeExternalCanonicalPromotionRequest({
        candidateId: recorded.candidateId,
        proposalId: proposal.proposalId,
        approvalDecisionId: `review-decision:${digest('a')}`,
        pickLineageDeferral: { decisionId, deferredIssueCount: 1, promotedTransactionCount: 1 },
      })
    ).toThrow(/counted exactly/);
  });
});

// A custody observation without a usable status (an order page's holder-only special pick with no
// original club, or a row behind a deferred pick_identity_conflict) is pick-side under the
// deferral: recorded as deferred custody, counted on the receipt, written as nothing (#869, owner
// decision 2026-10-11). Without a deferral nothing changes.
describe('deferred custody observations', () => {
  const custody = (custodyId: string, pickId: string, status: string) => ({
    custodyId,
    pickId,
    status,
  });

  it('classifies usable statuses and lists the rest, sorted and unique', () => {
    expect(['single_source', 'corroborated'].map(isAflTradeUsableCustodyStatus)).toEqual([
      true,
      true,
    ]);
    expect(['unresolved', 'disputed'].map(isAflTradeUsableCustodyStatus)).toEqual([false, false]);
    expect(
      aflTradeDeferredCustodyIds([
        custody('custody:b', 'pick:1', 'unresolved'),
        custody('custody:a', 'pick:2', 'disputed'),
        custody('custody:c', 'pick:3', 'single_source'),
        custody('custody:a', 'pick:2', 'disputed'),
      ])
    ).toEqual(['custody:a', 'custody:b']);
    expect(aflTradeDeferredCustodyIds([custody('custody:c', 'pick:3', 'corroborated')])).toEqual(
      []
    );
  });

  it('leaves recorded custody unwritten and counts it; without the record the row is written', () => {
    const content = {
      transactions: [{ transactionId: 'transaction:a', transferIds: ['transfer:a'] }],
      transfers: [
        {
          transferId: 'transfer:a',
          transactionId: 'transaction:a',
          asset: { kind: 'pick_entitlement', pickId: 'pick:a' },
        },
      ],
      draftSelections: [],
      pickCustody: [
        custody('custody:holder-only', 'pick:special', 'unresolved'),
        custody('custody:disputed', 'pick:d', 'disputed'),
        custody('custody:good', 'pick:a', 'single_source'),
      ],
      pickLineage: [],
      issues: [
        { code: 'lineage_unresolved', severity: 'deferred', subjectKey: 'lineage:transfer:x' },
      ],
      pickLineageDeferral: {
        decisionId,
        deferredCustodyIds: ['custody:disputed', 'custody:holder-only'],
      },
    };
    const written = aflTradePromotionWriteScope(content);
    expect([...written.deferral.deferredCustodyIds]).toEqual([
      'custody:disputed',
      'custody:holder-only',
    ]);
    expect(written.pickCustody.map(({ custodyId }) => custodyId)).toEqual(['custody:good']);
    expect(written.deferredCustodyCount).toBe(2);
    const { deferredCustodyIds: _ids, ...decisionOnly } = content.pickLineageDeferral;
    const unrecorded = aflTradePromotionWriteScope({
      ...content,
      pickLineageDeferral: decisionOnly,
    });
    expect(unrecorded.pickCustody.length).toBe(3);
    expect(unrecorded.deferredCustodyCount).toBe(0);
    expect(
      aflTradePromotionWriteScope({ ...content, issues: [], pickLineageDeferral: undefined })
    ).toMatchObject({ deferredCustodyCount: 0 });
  });

  it('records unusable custody at reconciliation only under the deferral, and the receipt counts it', () => {
    // The 2025 trade's pick 14 with a holder-only custody observation nobody can resolve.
    const holderOnly = batch('official_afl', 'd', [
      {
        kind: 'pick_custody',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 14,
        originalClub: null,
        currentClub: bulldogs,
        observedAt: '2025-10-01T00:00:00.000Z',
      },
    ]);
    const reconcileCustody = (deferral: boolean) =>
      reconcileAflTradeExternalEvidence({
        environment: 'test_fixture',
        competition: 'AFLM',
        anchorSeasonYear: 2025,
        sourceBatches: [draftguru, holderOnly],
        // The order page is an official_afl capture: its clubs resolve under that provider.
        identityResolutions: [
          ...resolutions,
          resolution('official_afl', 'club', gws, 'club-gws'),
          resolution('official_afl', 'club', bulldogs, 'club-western-bulldogs'),
        ],
        sourceAuthority: createAflTradeHistoricalCompletionReconciliationAuthority({
          ...sourceAuthority,
          candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(
            [draftguru.batchId, holderOnly.batchId].sort()
          ),
        }),
        reconciledAt: '2026-08-09T05:00:00.000Z',
        ...(deferral ? { pickLineageDeferral: { decisionId } } : {}),
      });
    const plain = reconcileCustody(false);
    expect(plain.content.issues.map(({ code, subjectKey }) => `${code} ${subjectKey}`)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^lineage_unresolved /)])
    );
    expect(
      plain.content.issues.every((issue) => isAflTradePickSideReconciliationIssue(issue))
    ).toBe(true);
    const unusable = plain.content.pickCustody.filter(
      ({ status }) => !isAflTradeUsableCustodyStatus(status)
    );
    expect(unusable.length).toBeGreaterThan(0);
    expect(plain.content.pickLineageDeferral).toBeUndefined();
    const deferred = reconcileCustody(true);
    expect(deferred.content.pickLineageDeferral).toEqual({
      decisionId,
      deferredCustodyIds: unusable.map(({ custodyId }) => custodyId).sort(),
    });
    expect(deferred.content.pickCustody).toEqual(plain.content.pickCustody);
    const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
      candidate: deferred,
      proposedAt: '2026-08-09T07:31:00.000Z',
      draftEvents: [],
    });
    const authenticated = authenticateAflTradeExternalCanonicalPromotionProposal({
      candidate: deferred,
      proposal,
    });
    expect(authenticated.pickCustodyCount).toBe(plain.content.pickCustody.length - unusable.length);
    expect(authenticated.pickLineageDeferral).toMatchObject({
      decisionId,
      deferredCustodyCount: unusable.length,
    });
    const request = createAflTradeExternalCanonicalPromotionRequest({
      candidateId: deferred.candidateId,
      proposalId: proposal.proposalId,
      approvalDecisionId: `review-decision:${digest('a')}`,
      pickLineageDeferral: authenticated.pickLineageDeferral!,
    });
    expect(parseAflTradeExternalCanonicalPromotionRequest(request)).toEqual(request);
  });

  it('is refused by the candidate contract without a deferral, or when it names a usable or unknown row', () => {
    const deferred = reconcile(true).content;
    const usable = {
      ...deferred.pickCustody[0],
      custodyId: `external-pick-custody:${digest('5')}`,
    };
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...deferred,
        pickLineageDeferral: { decisionId, deferredCustodyIds: [usable.custodyId] },
      })
    ).toThrow(/candidate custody row without a usable status/);
    const plain = reconcile(false).content;
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...plain,
        pickLineageDeferral: {
          decisionId,
          deferredCustodyIds: [`external-pick-custody:${digest('5')}`],
        },
      })
    ).toThrow(/only by a candidate that deferred an issue/);
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...deferred,
        pickLineageDeferral: { decisionId, deferredCustodyIds: [] },
      })
    ).toThrow();
  });
});

// A pick the promotion would define that is already a canonical pick with different facts, or with
// empty facts this candidate would fill without reviewed lineage, is retained under the deferral:
// referenced unchanged, no facts written, listed on the receipt. Without a deferral it is the
// immutable conflict it always was (#869).
describe('retained pick definitions', () => {
  it('retains only under the deferral and only without reviewed lineage; conflicts otherwise', () => {
    const facts = { nominalRound: 1, nominalPick: 27, originalClubId: null };
    expect(
      pickDefinitionDisposition({
        plan: { kind: 'conflict' },
        deferred: false,
        registrationId: undefined,
      })
    ).toBe('conflict');
    expect(
      pickDefinitionDisposition({
        plan: { kind: 'conflict' },
        deferred: true,
        registrationId: undefined,
      })
    ).toBe('retain');
    expect(
      pickDefinitionDisposition({
        plan: { kind: 'enrich', facts },
        deferred: false,
        registrationId: undefined,
      })
    ).toBe('conflict');
    expect(
      pickDefinitionDisposition({
        plan: { kind: 'enrich', facts },
        deferred: true,
        registrationId: undefined,
      })
    ).toBe('retain');
    // Reviewed lineage still enriches, deferral or not; an exact match needs nothing.
    for (const deferred of [true, false]) {
      expect(
        pickDefinitionDisposition({
          plan: { kind: 'enrich', facts },
          deferred,
          registrationId: `reviewed-pick-lineage-registration:${digest('1')}`,
        })
      ).toBe('enrich');
      expect(
        pickDefinitionDisposition({ plan: { kind: 'exact' }, deferred, registrationId: undefined })
      ).toBe('exact');
      expect(pickDefinitionDisposition({ plan: null, deferred, registrationId: undefined })).toBe(
        'conflict'
      );
    }
  });

  it('is recorded on the receipt sorted, unique and counted exactly', () => {
    const base = {
      candidateId: `external-reconciliation:${digest('c')}`,
      proposalId: `external-canonical-promotion-proposal:${digest('b')}`,
      approvalDecisionId: `review-decision:${digest('a')}`,
    };
    const picks = [`draft-pick:${digest('1')}`, `draft-pick:${digest('2')}`];
    const request = createAflTradeExternalCanonicalPromotionRequest({
      ...base,
      pickLineageDeferral: {
        decisionId,
        deferredIssueCount: 1,
        retainedPickDefinitionCount: 2,
        retainedPickDefinitionIds: picks,
      },
    });
    expect(parseAflTradeExternalCanonicalPromotionRequest(request)).toEqual(request);
    expect(request.promotionId).not.toBe(
      createAflTradeExternalCanonicalPromotionRequest({
        ...base,
        pickLineageDeferral: { decisionId, deferredIssueCount: 1 },
      }).promotionId
    );
    for (const deferral of [
      {
        decisionId,
        deferredIssueCount: 1,
        retainedPickDefinitionCount: 1,
        retainedPickDefinitionIds: picks,
      },
      { decisionId, deferredIssueCount: 1, retainedPickDefinitionIds: picks },
      {
        decisionId,
        deferredIssueCount: 1,
        retainedPickDefinitionCount: 2,
        retainedPickDefinitionIds: [picks[1]!, picks[0]!],
      },
    ]) {
      expect(() =>
        createAflTradeExternalCanonicalPromotionRequest({ ...base, pickLineageDeferral: deferral })
      ).toThrow(/counted exactly/);
    }
  });
});

// A stable pick the written transfers number differently (a trade page's "Pick 46" and a later
// trade's "Pick 56" for the same entitlement) is defined, under the deferral, from its one usable
// custody observation; each asset keeps its trade-time number. No such single custody row, or more
// than one, is the conflict it always was; without a deferral nothing changes (#869).
describe('custody-defined pick definitions', () => {
  const pickId = `draft-pick:${digest('e')}`;
  const transfer = (nativeId: string, nominalPick: number) => ({
    transferId: `external-transfer:${digest(nativeId)}`,
    transactionId: `external-transaction:${digest('t')}`,
    fromClubId: 'club-a',
    toClubId: 'club-b',
    status: 'single_source',
    evidenceIds: [],
    asset: {
      kind: 'pick_entitlement',
      pickId,
      draftYear: 2019,
      draftType: 'national',
      nominalRound: null,
      nominalPick,
      originalClubId: 'club-collingwood',
      recordedLabel: null,
    },
  });
  const custody = (suffix: string, status: string) => ({
    custodyId: `external-pick-custody:${digest(suffix)}`,
    pickId,
    observedAt: '2019-11-01T00:00:00.000Z',
    draftYear: 2019,
    draftType: 'national',
    roundNumber: 3,
    recordedPickNumber: 56,
    originalClubId: 'club-collingwood',
    currentClubId: 'club-b',
    status,
    evidenceIds: [],
  });
  const content = (pickCustody: ReturnType<typeof custody>[]) =>
    ({
      transfers: [transfer('1', 46), transfer('2', 56)],
      draftSelections: [],
      pickCustody,
    }) as unknown as Parameters<typeof resolveWrittenPickDefinitions>[0];

  it('defines the pick from its one usable custody row under the deferral and lists it', () => {
    const resolved = resolveWrittenPickDefinitions(content([custody('a', 'single_source')]), {
      deferred: true,
      definitionCustody: [custody('a', 'single_source')] as never,
    });
    expect(resolved.custodyDefinedPickIds).toEqual([pickId]);
    expect(resolved.definitions.get(pickId)).toEqual({
      pickId,
      draftYear: 2019,
      draftType: 'national',
      nominalRound: 3,
      nominalPick: 56,
      originalClubId: 'club-collingwood',
    });
    // An unusable row does not count; a corroborated one does.
    expect(
      resolveWrittenPickDefinitions(
        content([custody('a', 'corroborated'), custody('b', 'unresolved')]),
        {
          deferred: true,
          definitionCustody: [custody('a', 'corroborated'), custody('b', 'unresolved')] as never,
        }
      ).custodyDefinedPickIds
    ).toEqual([pickId]);
  });

  it('defines a renumbered pick without a number under the deferral when custody does not settle it, and throws without the deferral', () => {
    for (const rows of [[], [custody('a', 'single_source'), custody('b', 'single_source')]]) {
      const resolved = resolveWrittenPickDefinitions(content(rows), {
        deferred: true,
        definitionCustody: rows as never,
      });
      expect(resolved.custodyDefinedPickIds).toEqual([]);
      expect(resolved.definitions.get(pickId)).toMatchObject({
        nominalPick: null,
        originalClubId: 'club-collingwood',
      });
    }
    expect(() =>
      resolveWrittenPickDefinitions(content([custody('a', 'single_source')]), {
        deferred: false,
        definitionCustody: [custody('a', 'single_source')] as never,
      })
    ).toThrow(/conflicting nominalPick/);
    // Pages that also disagree on the round leave the pick without a round, under the deferral only.
    const reRounded = {
      ...content([]),
      transfers: [
        transfer('1', 46),
        { ...transfer('2', 56), asset: { ...transfer('2', 56).asset, nominalRound: 4 } },
        { ...transfer('3', 46), asset: { ...transfer('3', 46).asset, nominalRound: 3 } },
      ],
    } as unknown as Parameters<typeof resolveWrittenPickDefinitions>[0];
    expect(
      resolveWrittenPickDefinitions(reRounded, {
        deferred: true,
        definitionCustody: [],
      }).definitions.get(pickId)
    ).toMatchObject({ nominalPick: null, nominalRound: null });
    expect(() =>
      resolveWrittenPickDefinitions(reRounded, { deferred: false, definitionCustody: [] })
    ).toThrow(/conflicting/);
    // Agreeing numbers never need custody and are never listed.
    const agreeing = {
      ...content([]),
      transfers: [transfer('1', 46), transfer('2', 46)],
    } as unknown as Parameters<typeof resolveWrittenPickDefinitions>[0];
    const resolved = resolveWrittenPickDefinitions(agreeing, {
      deferred: true,
      definitionCustody: [],
    });
    expect(resolved.custodyDefinedPickIds).toEqual([]);
    expect(resolved.definitions.get(pickId)?.nominalPick).toBe(46);
  });

  it('looks the custody row up in the candidate custody, so a deferred pick whose observation is not written still resolves', () => {
    // The pick is deferred: its observation is out of the written custody but names the slot.
    const written = content([]);
    const resolved = resolveWrittenPickDefinitions(written, {
      deferred: true,
      definitionCustody: [custody('a', 'single_source')] as never,
    });
    expect(resolved.custodyDefinedPickIds).toEqual([pickId]);
    expect(resolved.definitions.get(pickId)).toMatchObject({ nominalRound: 3, nominalPick: 56 });
    // The written custody alone decides nothing: no row, or two rows, in the candidate leave the
    // pick renumbered, without a number.
    expect(
      resolveWrittenPickDefinitions(content([custody('a', 'single_source')]), {
        deferred: true,
        definitionCustody: [],
      }).definitions.get(pickId)?.nominalPick
    ).toBeNull();
    expect(
      resolveWrittenPickDefinitions(written, {
        deferred: true,
        definitionCustody: [custody('a', 'single_source'), custody('b', 'corroborated')] as never,
      }).definitions.get(pickId)?.nominalPick
    ).toBeNull();
  });

  it('is recorded on the receipt sorted, unique and counted exactly', () => {
    const base = {
      candidateId: `external-reconciliation:${digest('c')}`,
      proposalId: `external-canonical-promotion-proposal:${digest('b')}`,
      approvalDecisionId: `review-decision:${digest('a')}`,
    };
    const request = createAflTradeExternalCanonicalPromotionRequest({
      ...base,
      pickLineageDeferral: {
        decisionId,
        deferredIssueCount: 1,
        custodyDefinedPickCount: 1,
        custodyDefinedPickIds: [pickId],
      },
    });
    expect(parseAflTradeExternalCanonicalPromotionRequest(request)).toEqual(request);
    expect(() =>
      createAflTradeExternalCanonicalPromotionRequest({
        ...base,
        pickLineageDeferral: { decisionId, deferredIssueCount: 1, custodyDefinedPickIds: [pickId] },
      })
    ).toThrow(/counted exactly/);
  });
});

// Repairing promoted pick identity (#853). A trade promoted before the identity rules carries pick
// ids the rules have since changed: it counts as already promoted only when every pick transfer
// keeps its promoted asset's pick id, so a re-keyed trade is written again as a superseding version.
// Custody an earlier promotion wrote with the candidate's facts is left to it: a custody id addresses
// its evidence, so writing it a second time would collide with the first row.
describe('repairing promoted pick identity (#853)', () => {
  const tradeId = createAflTradeContentAddress('external-transaction', {
    provider: 'draftguru',
    nativeEventId: '2025-gws-bulldogs',
  });

  it('lists a transaction only when every pick transfer keeps its promoted pick id', () => {
    const transactions = [
      { transactionId: 'transaction:kept', transferIds: ['player', 'pick-kept'] },
      { transactionId: 'transaction:rekeyed', transferIds: ['pick-rekeyed'] },
      { transactionId: 'transaction:pickless', transferIds: ['pick-pickless'] },
      { transactionId: 'transaction:reviewed', transferIds: ['pick-reviewed'] },
      { transactionId: 'transaction:unheld', transferIds: ['pick-unheld'] },
      { transactionId: 'transaction:reviewed-unheld', transferIds: ['pick-reviewed-unheld'] },
      {
        transactionId: 'transaction:reviewed-unpromoted',
        transferIds: ['pick-reviewed', 'pick-unpromoted'],
      },
    ];
    const pick = (transferId: string, pickId: string) => ({
      transferId,
      asset: { kind: 'pick_entitlement', pickId },
    });
    const transfers = [
      { transferId: 'player', asset: { kind: 'player' } },
      pick('pick-kept', 'pick:a'),
      pick('pick-rekeyed', 'pick:new'),
      pick('pick-pickless', 'pick:c'),
      pick('pick-reviewed', 'pick:reconciled'),
      pick('pick-unpromoted', 'pick:e'),
    ];
    const current = [
      {
        transactionId: 'transaction:kept',
        transferIds: ['pick-kept', 'player'],
        reviewedLineage: false,
        transferPickIds: [{ transferId: 'pick-kept', pickId: 'pick:a' }],
      },
      {
        transactionId: 'transaction:rekeyed',
        transferIds: ['pick-rekeyed'],
        reviewedLineage: false,
        transferPickIds: [{ transferId: 'pick-rekeyed', pickId: 'pick:old' }],
      },
      // A promoted asset that names no pick does not stand for a candidate pick transfer.
      {
        transactionId: 'transaction:pickless',
        transferIds: ['pick-pickless'],
        reviewedLineage: false,
        transferPickIds: [],
      },
      // Reviewed pick lineage settled this trade's pick ids; reconciliation does not override them.
      {
        transactionId: 'transaction:reviewed',
        transferIds: ['pick-reviewed'],
        reviewedLineage: true,
        transferPickIds: [{ transferId: 'pick-reviewed', pickId: 'pick:reviewed' }],
      },
      // A transfer the candidate does not hold is never matched.
      {
        transactionId: 'transaction:unheld',
        transferIds: ['pick-unheld'],
        reviewedLineage: false,
        transferPickIds: [{ transferId: 'pick-unheld', pickId: 'pick:d' }],
      },
      // Reviewed lineage exempts only the pick-id comparison: a transfer the candidate does not
      // hold, or one not promoted on the current version, still refuses (as migration 0274 does).
      {
        transactionId: 'transaction:reviewed-unheld',
        transferIds: ['pick-reviewed-unheld'],
        reviewedLineage: true,
        transferPickIds: [{ transferId: 'pick-reviewed-unheld', pickId: 'pick:f' }],
      },
      {
        transactionId: 'transaction:reviewed-unpromoted',
        transferIds: ['pick-reviewed'],
        reviewedLineage: true,
        transferPickIds: [{ transferId: 'pick-reviewed', pickId: 'pick:reviewed' }],
      },
    ];
    expect(aflTradePromotedTransactions(transactions, transfers, current)).toEqual([
      'transaction:kept',
      'transaction:reviewed',
    ]);
  });

  it('records the trade at reconciliation only under its promoted pick id, and writes a re-keyed one', () => {
    const unrecorded = reconcile(true);
    const trade = unrecorded.content.transactions.find(
      ({ transactionId }) => transactionId === tradeId
    )!;
    const pickTransfer = unrecorded.content.transfers.find(
      ({ asset }) => asset.kind === 'pick_entitlement'
    )!;
    const promotedUnder = (pickId: string) => [
      {
        transactionId: tradeId,
        transferIds: trade.transferIds,
        reviewedLineage: false,
        transferPickIds: [{ transferId: pickTransfer.transferId, pickId }],
      },
    ];
    const kept = reconcile(
      true,
      true,
      undefined,
      promotedUnder((pickTransfer.asset as { pickId: string }).pickId)
    );
    expect(kept.content.pickLineageDeferral?.promotedTransactions).toEqual([tradeId]);
    expect(
      aflTradePromotionWriteScope(kept.content).transactions.map(
        ({ transactionId }) => transactionId
      )
    ).not.toContain(tradeId);
    // The identity rules changed the pick's id since it was promoted: the trade is written again.
    const rekeyed = reconcile(true, true, undefined, promotedUnder(`draft-pick:${digest('0')}`));
    expect(rekeyed.content.pickLineageDeferral?.promotedTransactions).toBeUndefined();
    expect(rekeyed.candidateId).toBe(unrecorded.candidateId);
    expect(
      aflTradePromotionWriteScope(rekeyed.content).transactions.map(
        ({ transactionId }) => transactionId
      )
    ).toContain(tradeId);
    // The repository must state each promoted asset's pick id; without it nothing is decided.
    expect(() =>
      reconcile(true, true, undefined, [
        { transactionId: tradeId, transferIds: trade.transferIds } as never,
      ])
    ).toThrow();
  });

  it('maps candidate draft types to the canonical kind the promoter writes', () => {
    expect(
      [
        'national',
        'National Draft',
        'pre-season',
        'rookie',
        'mid_season',
        'mini_draft',
        'supplemental_selection',
        'expansion',
        'constructor',
      ].map(aflTradeCanonicalDraftKind)
    ).toEqual([
      'national_draft',
      'national_draft',
      'preseason_draft',
      'rookie_draft',
      'midseason_draft',
      'supplemental_selection',
      'supplemental_selection',
      null,
      null,
    ]);
  });

  const stored: AflTradeCurrentCanonicalPickCustody = {
    custodyId: 'custody:a',
    pickId: 'pick:a',
    observedAt: '2025-10-15T00:00:00.000Z',
    observedDate: null,
    draftSeasonYear: 2025,
    draftKind: 'national_draft',
    recordedRound: 1,
    recordedPick: 14,
    originalClubId: 'club-gws',
    currentClubId: 'club-western-bulldogs',
    predecessorCustodyId: null,
  };
  const row = {
    custodyId: 'custody:a',
    pickId: 'pick:a',
    observedAt: '2025-10-15T00:00:00.000Z' as unknown,
    draftYear: 2025,
    draftType: 'national',
    roundNumber: 1 as number | null,
    recordedPickNumber: 14 as number | null,
    originalClubId: 'club-gws' as string | null,
    currentClubId: 'club-western-bulldogs' as string | null,
    predecessorCustodyId: null as string | null,
    status: 'single_source',
  };

  it('lists usable custody already canonical with the same facts, and nothing that differs', () => {
    expect(aflTradePromotedCustodyIds([row, row], [stored])).toEqual(['custody:a']);
    // A re-captured page gives the same observation new evidence and so a new custody id: the
    // observation is matched by pick, time and holder, and the candidate's own id is listed.
    expect(
      aflTradePromotedCustodyIds([{ ...row, custodyId: 'custody:recaptured' }, row], [stored])
    ).toEqual(['custody:a', 'custody:recaptured']);
    // Another canonical observation of the same pick by another holder or time does not match.
    expect(
      aflTradePromotedCustodyIds(
        [{ ...row, custodyId: 'custody:recaptured' }],
        [
          { ...stored, currentClubId: 'club-gws' },
          { ...stored, observedAt: '2025-10-16T00:00:00.000Z' },
        ]
      )
    ).toEqual([]);
    // Either side naming a predecessor is never matched: the ids name different stores.
    expect(
      aflTradePromotedCustodyIds([row], [{ ...stored, predecessorCustodyId: 'custody:z' }])
    ).toEqual([]);
    // The same instant written with an offset is the same observation.
    expect(
      aflTradePromotedCustodyIds(
        [{ ...row, observedAt: '2025-10-15T10:00:00.000+10:00' }],
        [stored]
      )
    ).toEqual(['custody:a']);
    const yearOnly = {
      ...stored,
      observedAt: null,
      observedDate: { precision: 'year', year: 2025 },
    };
    expect(
      aflTradePromotedCustodyIds(
        [{ ...row, observedAt: { precision: 'year', year: 2025 } }],
        [yearOnly]
      )
    ).toEqual(['custody:a']);
    expect(
      aflTradePromotedCustodyIds(
        [{ ...row, observedAt: { precision: 'day', date: '2025-10-15' } }],
        [yearOnly]
      )
    ).toEqual([]);
    for (const changed of [
      { pickId: 'pick:b' },
      { observedAt: '2025-10-16T00:00:00.000Z' },
      { observedAt: { precision: 'year', year: 2025 } },
      { draftYear: 2026 },
      { draftType: 'rookie' },
      { roundNumber: 2 },
      { recordedPickNumber: null },
      { originalClubId: null },
      { currentClubId: 'club-gws' },
      { predecessorCustodyId: 'custody:a' },
      { status: 'unresolved' },
    ]) {
      expect(aflTradePromotedCustodyIds([{ ...row, ...changed }], [stored])).toEqual([]);
      // The same holds under a re-captured custody id.
      expect(
        aflTradePromotedCustodyIds(
          [{ ...row, ...changed, custodyId: 'custody:recaptured' }],
          [stored]
        )
      ).toEqual([]);
    }
    expect(aflTradePromotedCustodyIds([row], [])).toEqual([]);
  });

  it('leaves already-canonical custody unwritten and counts it, only under the deferral', () => {
    const content = {
      transactions: [],
      transfers: [],
      draftSelections: [],
      pickCustody: [
        { custodyId: 'custody:a', pickId: 'pick:a', status: 'single_source' },
        { custodyId: 'custody:b', pickId: 'pick:b', status: 'single_source' },
      ],
      pickLineage: [],
      issues: [
        { code: 'lineage_unresolved', severity: 'deferred', subjectKey: 'lineage:transfer:x' },
      ],
      pickLineageDeferral: { decisionId, promotedCustodyIds: ['custody:a'] },
    };
    const written = aflTradePromotionWriteScope(content);
    expect([...written.deferral.promotedCustodyIds]).toEqual(['custody:a']);
    expect(written.pickCustody.map(({ custodyId }) => custodyId)).toEqual(['custody:b']);
    expect(written.promotedCustodyCount).toBe(1);
    expect(
      aflTradePromotionWriteScope({ ...content, issues: [], pickLineageDeferral: undefined })
    ).toMatchObject({ promotedCustodyCount: 0 });
  });

  it('records already-canonical custody at reconciliation only under the deferral, and the receipt counts it', () => {
    // The order page states pick 14's custody with its original club, so the row is usable.
    const order = batch('official_afl', 'e', [
      {
        kind: 'pick_custody',
        draftYear: 2025,
        draftType: 'national',
        roundNumber: 1,
        recordedPickNumber: 14,
        originalClub: gws,
        currentClub: bulldogs,
        observedAt: '2025-10-01T00:00:00.000Z',
      },
    ]);
    const reconcileOrder = (
      deferral: boolean,
      promotedCustody?: readonly AflTradeCurrentCanonicalPickCustody[]
    ) =>
      reconcileAflTradeExternalEvidence({
        environment: 'test_fixture',
        competition: 'AFLM',
        anchorSeasonYear: 2025,
        sourceBatches: [draftguru, order],
        identityResolutions: [
          ...resolutions,
          resolution('official_afl', 'club', gws, 'club-gws'),
          resolution('official_afl', 'club', bulldogs, 'club-western-bulldogs'),
        ],
        sourceAuthority: createAflTradeHistoricalCompletionReconciliationAuthority({
          ...sourceAuthority,
          candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson(
            [draftguru.batchId, order.batchId].sort()
          ),
        }),
        reconciledAt: '2026-08-09T05:00:00.000Z',
        ...(deferral ? { pickLineageDeferral: { decisionId } } : {}),
        ...(promotedCustody === undefined ? {} : { promotedCustody }),
      });
    const plain = reconcileOrder(true);
    const custody = plain.content.pickCustody.find(({ status }) =>
      isAflTradeUsableCustodyStatus(status)
    )!;
    expect(custody).toBeDefined();
    const canonical: AflTradeCurrentCanonicalPickCustody = {
      custodyId: custody.custodyId,
      pickId: custody.pickId,
      observedAt: '2025-10-01T00:00:00.000Z',
      observedDate: null,
      draftSeasonYear: 2025,
      draftKind: 'national_draft',
      recordedRound: custody.roundNumber,
      recordedPick: custody.recordedPickNumber,
      originalClubId: custody.originalClubId,
      currentClubId: custody.currentClubId!,
      predecessorCustodyId:
        (custody as { predecessorCustodyId?: string | null }).predecessorCustodyId ?? null,
    };
    const recorded = reconcileOrder(true, [canonical]);
    expect(recorded.content.pickLineageDeferral?.promotedCustodyIds).toEqual([custody.custodyId]);
    expect(recorded.content.pickCustody).toEqual(plain.content.pickCustody);
    // Different facts under the same id are not recorded: that promotion still refuses.
    expect(
      reconcileOrder(true, [{ ...canonical, currentClubId: 'club-gws' }]).content
        .pickLineageDeferral?.promotedCustodyIds
    ).toBeUndefined();
    expect(() => reconcileOrder(false, [canonical])).toThrow(/only under a pick-side deferral/);
    expect(
      aflTradePromotionWriteScope(recorded.content).pickCustody.map(({ custodyId }) => custodyId)
    ).not.toContain(custody.custodyId);
    const proposal = deriveAflTradeExternalCanonicalPromotionProposal({
      candidate: recorded,
      proposedAt: '2026-08-09T07:31:00.000Z',
      draftEvents: [],
    });
    const authenticated = authenticateAflTradeExternalCanonicalPromotionProposal({
      candidate: recorded,
      proposal,
    });
    expect(authenticated.pickCustodyCount).toBe(
      aflTradePromotionWriteScope(recorded.content).pickCustody.length
    );
    expect(authenticated.pickLineageDeferral).toMatchObject({
      decisionId,
      promotedCustodyCount: 1,
    });
    const request = createAflTradeExternalCanonicalPromotionRequest({
      candidateId: recorded.candidateId,
      proposalId: proposal.proposalId,
      approvalDecisionId: `review-decision:${digest('a')}`,
      pickLineageDeferral: authenticated.pickLineageDeferral!,
    });
    expect(parseAflTradeExternalCanonicalPromotionRequest(request)).toEqual(request);
    // The candidate contract refuses a listed id that is not a usable custody row it holds.
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...recorded.content,
        pickLineageDeferral: {
          decisionId,
          promotedCustodyIds: [`external-pick-custody:${digest('5')}`],
        },
      })
    ).toThrow(/usable candidate custody row/);
    expect(() =>
      createAflTradeExternalReconciliationCandidate({
        ...recorded.content,
        pickLineageDeferral: { decisionId, promotedCustodyIds: [] },
      })
    ).toThrow();
  });
});
