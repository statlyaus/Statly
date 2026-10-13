import { describe, expect, it, vi } from 'vitest';

import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
  AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
  createAflTradeExternalEvidenceBatch,
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
import {
  AflTradeReconciliationScopeDecisionError,
  prepareAflTradeHistoricalReconciliation,
  type AflTradeReconciliationScopeDecision,
  type PrepareAflTradeHistoricalReconciliationDependencies,
} from '@/server/aflTradeIntelligence/source/externalHistoricalReconciliationPreparation';
import {
  AFL_TRADE_EXTERNAL_RECONCILIATION_SOURCE_AUTHORITY_SCHEMA_VERSION,
  createAflTradeHistoricalCompletionReconciliationAuthority,
} from '@/server/aflTradeIntelligence/source/externalReconciliationSourceAuthorityContracts';
import {
  isAflTradePickSideReconciliationIssue,
  type AflTradeCurrentCanonicalPickCustody,
  type AflTradeCurrentCanonicalTransaction,
} from '@/server/aflTradeIntelligence/source/pickLineageDeferral';
import type { PersistAflTradeExternalReconciliationInput } from '@/server/aflTradeIntelligence/source/postgresExternalReconciliationRepository';
import { parseAflTradeReconciliationScopeDecisionArguments } from '../../Scripts/record-reconciliation-scope-decision';
import { parseAflTradePrepareExternalReconciliationArguments } from '../../Scripts/prepare-external-draft-trade-reconciliation';

const digest = (character: string) => character.repeat(64);
const completionId = `external-historical-capture-completion:${digest('9')}`;
const decisionId = `review-decision:${digest('d')}`;
const capturedAt = '2026-08-09T04:00:00.000Z';

// One Draftguru trade whose only pick transfer has no custody evidence, so reconciliation records a
// `lineage_unresolved` issue; clubs resolve through no reviewed decision, so the clubs are unresolved
// too (player-side `transfer:` subjects, which stay blocking under any deferral).
function sourceBatch(withSelection = false) {
  const provider: AflTradeExternalEvidenceContent['provider'] = 'draftguru';
  const capture: AflTradeExternalEvidenceContent['capture'] = {
    captureId: `source-capture:${digest('1')}`,
    artifactId: `artifact:${digest('1')}`,
    contentSha256: digest('1'),
    mediaType: 'text/html',
    sourceUrl: 'https://example.test/draftguru/2025/trades',
    capturedAt,
    effectiveAt: '2025-11-20T00:00:00.000Z',
    parserVersion: 'draftguru/v1',
    fieldManifestSha256: digest('f'),
  };
  const claims: AflTradeExternalEvidenceContent['claim'][] = [
    {
      kind: 'transaction',
      nativeEventId: '2025-gws-bulldogs',
      seasonYear: 2025,
      occurredOn: '2025-10-15',
      transactionType: 'trade',
      title: 'GWS and Western Bulldogs exchange picks',
    },
    {
      kind: 'directed_transfer',
      nativeEventId: '2025-gws-bulldogs',
      nativeTransferId: 'pick-14',
      fromClub: { nativeId: null, recordedName: 'GWS Giants' },
      toClub: { nativeId: null, recordedName: 'Western Bulldogs' },
      asset: {
        kind: 'current_pick',
        draftYear: 2025,
        draftType: 'national',
        recordedPickNumber: 14,
      },
    },
    // The 2025 draft's selection at 14, unreviewed: its identity issues are pick-side.
    ...(withSelection
      ? [
          {
            kind: 'draft_selection' as const,
            draftYear: 2025,
            draftType: 'national' as const,
            selectionNumber: 14,
            roundNumber: 1,
            player: { nativeId: 'unreviewed-draftee', recordedName: 'Unreviewed Draftee' },
            selectedByClub: { nativeId: null, recordedName: 'Western Bulldogs' },
          },
        ]
      : []),
  ];
  const evidence = claims.map((claim, index) =>
    createAflTradeExternalEvidenceEnvelope({
      schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_SCHEMA_VERSION,
      provider,
      capture,
      sourceRow: { ordinal: index + 1, sourceKey: `${provider}:${index + 1}` },
      claim,
      publicationEligible: false,
    })
  );
  return createAflTradeExternalEvidenceBatch({
    schemaVersion: AFL_TRADE_EXTERNAL_EVIDENCE_BATCH_SCHEMA_VERSION,
    provider,
    captureId: capture.captureId,
    evidence,
    finalizedAt: capturedAt,
    publicationEligible: false,
  });
}

function dependencies(
  decision: AflTradeReconciliationScopeDecision | null,
  options: {
    withSelection?: boolean;
    promotedSelectionIds?: readonly string[];
    promotedTransactions?: readonly AflTradeCurrentCanonicalTransaction[];
    promotedCustody?: readonly AflTradeCurrentCanonicalPickCustody[];
  } = {}
) {
  const batch = sourceBatch(options.withSelection ?? false);
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
    candidateSourceBatchSetSha256: sha256AflTradeCanonicalJson([batch.batchId]),
    completedAt: '2026-08-09T04:30:00.000Z',
  });
  const persisted: PersistAflTradeExternalReconciliationInput[] = [];
  const built: PrepareAflTradeHistoricalReconciliationDependencies = {
    source: {
      load: async () => ({
        environment: 'test_fixture',
        competition: 'AFLM',
        anchorSeasonYear: 2025,
        sourceAuthority,
        sourceBatches: [batch],
      }),
    },
    identityReviewRepository: { loadCurrentResolutions: async () => [] },
    candidateRepository: {
      persistCandidate: async (input) => {
        persisted.push(input);
        const content = (
          input.candidate as { content: { candidateId?: string; issues: { severity: string }[] } }
        ).content;
        const deferredIssueCount = content.issues.filter((i) => i.severity === 'deferred').length;
        return {
          candidateId: (input.candidate as { candidateId: string }).candidateId,
          status: 'finalized',
          blockingIssueCount: content.issues.length - deferredIssueCount,
          deferredIssueCount,
          idempotentReplay: false,
        };
      },
    },
    scopeDecisionRepository: { loadDecision: vi.fn(async () => decision) },
    promotedSelectionRepository: {
      loadCurrentCanonicalSelectionIds: vi.fn(async () => options.promotedSelectionIds ?? []),
      loadCurrentCanonicalTransactions: vi.fn(async () => options.promotedTransactions ?? []),
      loadCurrentCanonicalPickCustody: vi.fn(async () => options.promotedCustody ?? []),
    },
  };
  return { built, persisted };
}

const approved: AflTradeReconciliationScopeDecision = {
  decisionId,
  subjectType: 'reconciliation_scope',
  subjectId: completionId,
  decision: 'approved',
  decidedAt: '2026-10-11T01:00:00.000Z',
  current: true,
};

describe('historical reconciliation preparation with a pick-side deferral (#869)', () => {
  it('prepares the same candidate without the flag, with every issue blocking', async () => {
    const { built, persisted } = dependencies(null);
    const result = await prepareAflTradeHistoricalReconciliation({ completionId }, built);
    expect(result.pickLineageDeferral).toBeNull();
    expect(result.deferredIssueCount).toBe(0);
    expect(result.blockingIssueCount).toBeGreaterThan(0);
    const candidate = persisted[0]!.candidate as { content: { issues: { severity: string }[] } };
    expect(candidate.content.issues.every((issue) => issue.severity === 'blocking')).toBe(true);
  });

  it('defers the pick-side issues under the approved decision and keeps player-side issues blocking', async () => {
    const { built, persisted } = dependencies(approved);
    const result = await prepareAflTradeHistoricalReconciliation(
      { completionId, pickLineageDeferral: { decisionId } },
      built
    );
    expect(result.pickLineageDeferral).toEqual({ decisionId });
    expect(result.deferredIssueCount).toBe(1);
    const candidate = persisted[0]!.candidate as {
      content: {
        issues: { code: string; subjectKey: string; severity: string }[];
        reconciledAt: string;
      };
    };
    expect(candidate.content.issues.filter((i) => i.severity === 'deferred')).toEqual([
      expect.objectContaining({ code: 'lineage_unresolved' }),
    ]);
    const blocking = candidate.content.issues.filter((i) => i.severity === 'blocking');
    expect(blocking.length).toBe(result.blockingIssueCount);
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking.some((i) => isAflTradePickSideReconciliationIssue(i))).toBe(false);
    expect(result.requiresReview).toBe(true);
    // Reconciliation time is never earlier than the decision it relies on.
    expect(candidate.content.reconciledAt).toBe(approved.decidedAt);
  });

  it.each([
    ['absent', null],
    [
      'another completion',
      { ...approved, subjectId: `external-historical-capture-completion:${digest('0')}` },
    ],
    ['another subject type', { ...approved, subjectType: 'external_reconciliation_candidate' }],
    ['not approved', { ...approved, decision: 'rejected' }],
    ['superseded', { ...approved, current: false }],
  ] as const)(
    'refuses a deferral decision that is %s before building a candidate',
    async (_label, decision) => {
      const { built, persisted } = dependencies(decision);
      await expect(
        prepareAflTradeHistoricalReconciliation(
          { completionId, pickLineageDeferral: { decisionId } },
          built
        )
      ).rejects.toBeInstanceOf(AflTradeReconciliationScopeDecisionError);
      expect(persisted).toEqual([]);
    }
  );

  it('records a draft whose every selection is already current canonical, and leaves it to that promotion', async () => {
    const selectionId = createAflTradeContentAddress('external-draft-selection', {
      draftYear: 2025,
      draftType: 'national',
      selectionNumber: 14,
    });
    const { built, persisted } = dependencies(approved, {
      withSelection: true,
      promotedSelectionIds: [selectionId, 'external-draft-selection:other'],
    });
    const result = await prepareAflTradeHistoricalReconciliation(
      { completionId, pickLineageDeferral: { decisionId } },
      built
    );
    expect(
      built.promotedSelectionRepository!.loadCurrentCanonicalSelectionIds
    ).toHaveBeenCalledWith('AFLM');
    expect(result.pickLineageDeferral).toEqual({
      decisionId,
      promotedDrafts: [{ draftYear: 2025, draftType: 'national' }],
    });
    const candidate = persisted[0]!.candidate as {
      content: { pickLineageDeferral?: unknown; issues: { severity: string }[] };
    };
    expect(candidate.content.pickLineageDeferral).toEqual(result.pickLineageDeferral);
    // The selection's identity issues are still recorded (deferred); nothing is dropped.
    expect(candidate.content.issues.filter((i) => i.severity === 'deferred').length).toBe(3);

    // A draft with a selection nobody promoted is not recorded.
    const partial = dependencies(approved, {
      withSelection: true,
      promotedSelectionIds: ['external-draft-selection:other'],
    });
    const unrecorded = await prepareAflTradeHistoricalReconciliation(
      { completionId, pickLineageDeferral: { decisionId } },
      partial.built
    );
    expect(unrecorded.pickLineageDeferral).toEqual({ decisionId });
    // Without the flag the reader is never consulted and the candidate is today's.
    const plain = dependencies(null, { withSelection: true, promotedSelectionIds: [selectionId] });
    await prepareAflTradeHistoricalReconciliation({ completionId }, plain.built);
    expect(
      plain.built.promotedSelectionRepository!.loadCurrentCanonicalSelectionIds
    ).not.toHaveBeenCalled();
  });

  it('records a transaction whose trade is current canonical with every transfer promoted, and leaves it', async () => {
    const transactionId = createAflTradeContentAddress('external-transaction', {
      provider: 'draftguru',
      nativeEventId: '2025-gws-bulldogs',
    });
    const transferId = createAflTradeContentAddress('external-transfer', {
      transactionId,
      nativeTransferId: 'pick-14',
    });
    // The trade's one transfer is pick 14; the repository states the pick id of its promoted asset.
    const first = dependencies(approved);
    await prepareAflTradeHistoricalReconciliation(
      { completionId, pickLineageDeferral: { decisionId } },
      first.built
    );
    const pickId = (
      first.persisted[0]!.candidate as {
        content: { transfers: { transferId: string; asset: { pickId?: string } }[] };
      }
    ).content.transfers.find((transfer) => transfer.transferId === transferId)!.asset.pickId!;
    const { built, persisted } = dependencies(approved, {
      promotedTransactions: [
        {
          transactionId,
          transferIds: [transferId, 'external-transfer:x'],
          reviewedLineage: false,
          transferPickIds: [{ transferId, pickId }],
          transferPlayerIds: [],
        },
      ],
    });
    const result = await prepareAflTradeHistoricalReconciliation(
      { completionId, pickLineageDeferral: { decisionId } },
      built
    );
    expect(
      built.promotedSelectionRepository!.loadCurrentCanonicalTransactions
    ).toHaveBeenCalledWith('AFLM');
    expect(result.pickLineageDeferral).toEqual({
      decisionId,
      promotedTransactions: [transactionId],
    });
    const candidate = persisted[0]!.candidate as { content: { pickLineageDeferral?: unknown } };
    expect(candidate.content.pickLineageDeferral).toEqual(result.pickLineageDeferral);
    // A transaction with a transfer nobody promoted is not recorded.
    const partial = dependencies(approved, {
      promotedTransactions: [
        {
          transactionId,
          transferIds: ['external-transfer:x'],
          reviewedLineage: false,
          transferPickIds: [],
          transferPlayerIds: [],
        },
      ],
    });
    const unrecorded = await prepareAflTradeHistoricalReconciliation(
      { completionId, pickLineageDeferral: { decisionId } },
      partial.built
    );
    expect(unrecorded.pickLineageDeferral).toEqual({ decisionId });
    // Nor one whose pick was promoted under another id (#853): its promotion writes it again.
    const rekeyed = dependencies(approved, {
      promotedTransactions: [
        {
          transactionId,
          transferIds: [transferId],
          reviewedLineage: false,
          transferPickIds: [{ transferId, pickId: `draft-pick:${digest('0')}` }],
          transferPlayerIds: [],
        },
      ],
    });
    const rewritten = await prepareAflTradeHistoricalReconciliation(
      { completionId, pickLineageDeferral: { decisionId } },
      rekeyed.built
    );
    expect(rewritten.pickLineageDeferral).toEqual({ decisionId });
    // Without the flag the reader is never consulted.
    const plain = dependencies(null, {
      promotedTransactions: [
        {
          transactionId,
          transferIds: [transferId],
          reviewedLineage: false,
          transferPickIds: [{ transferId, pickId }],
          transferPlayerIds: [],
        },
      ],
    });
    await prepareAflTradeHistoricalReconciliation({ completionId }, plain.built);
    expect(
      plain.built.promotedSelectionRepository!.loadCurrentCanonicalTransactions
    ).not.toHaveBeenCalled();
  });

  it('reads canonical custody under the flag only and records none the candidate does not hold', async () => {
    const promotedCustody: AflTradeCurrentCanonicalPickCustody[] = [
      {
        custodyId: `external-pick-custody:${digest('5')}`,
        pickId: `draft-pick:${digest('6')}`,
        observedAt: '2025-10-01T00:00:00.000Z',
        observedDate: null,
        draftSeasonYear: 2025,
        draftKind: 'national_draft',
        recordedRound: 1,
        recordedPick: 14,
        originalClubId: 'club-gws',
        currentClubId: 'club-western-bulldogs',
        predecessorCustodyId: null,
      },
    ];
    const { built } = dependencies(approved, { promotedCustody });
    const result = await prepareAflTradeHistoricalReconciliation(
      { completionId, pickLineageDeferral: { decisionId } },
      built
    );
    expect(built.promotedSelectionRepository!.loadCurrentCanonicalPickCustody).toHaveBeenCalledWith(
      'AFLM'
    );
    // The trade carries no custody observation, so nothing is left to the earlier promotion.
    expect(result.pickLineageDeferral).toEqual({ decisionId });
    const plain = dependencies(null, { promotedCustody });
    await prepareAflTradeHistoricalReconciliation({ completionId }, plain.built);
    expect(
      plain.built.promotedSelectionRepository!.loadCurrentCanonicalPickCustody
    ).not.toHaveBeenCalled();
  });

  it('refuses the flag when no promoted draft-selection reader is wired', async () => {
    const { built, persisted } = dependencies(approved);
    const { promotedSelectionRepository: _omitted, ...withoutReader } = built;
    await expect(
      prepareAflTradeHistoricalReconciliation(
        { completionId, pickLineageDeferral: { decisionId } },
        withoutReader
      )
    ).rejects.toThrow(/reader/);
    expect(persisted).toEqual([]);
  });

  it('refuses the flag when no scope-decision repository is wired', async () => {
    const { built } = dependencies(approved);
    const { scopeDecisionRepository: _omitted, ...withoutRepository } = built;
    await expect(
      prepareAflTradeHistoricalReconciliation(
        { completionId, pickLineageDeferral: { decisionId } },
        withoutRepository
      )
    ).rejects.toThrow(/repository/);
  });
});

describe('prepare command arguments', () => {
  it('parses the optional --defer-pick-lineage decision and rejects anything else', () => {
    expect(
      parseAflTradePrepareExternalReconciliationArguments(['--completion', completionId])
    ).toEqual({
      completionId,
    });
    expect(
      parseAflTradePrepareExternalReconciliationArguments([
        '--completion',
        completionId,
        '--defer-pick-lineage',
        decisionId,
      ])
    ).toEqual({ completionId, pickLineageDeferral: { decisionId } });
    for (const argv of [
      ['--completion', completionId, '--defer-pick-lineage'],
      ['--completion', completionId, '--defer-pick-lineage', 'review-decision:nope'],
      ['--completion', completionId, '--defer', decisionId],
      ['--defer-pick-lineage', decisionId, '--completion', completionId],
    ]) {
      expect(() => parseAflTradePrepareExternalReconciliationArguments(argv)).toThrow(/arguments/i);
    }
  });
});

describe('record-reconciliation-scope command arguments', () => {
  const argv = [
    '--completion',
    completionId,
    '--scope',
    'pick_lineage_deferral',
    '--approval-artifact',
    `artifact:${digest('a')}`,
    '--reviewer',
    'owner:robert',
    '--rationale',
    'Owner approval 2026-10-11, pick side deferred until #853 lineage lands.',
    '--decided-at',
    '2026-10-11T01:00:00.000Z',
  ];

  it('builds the exact decision content from the arguments', () => {
    expect(parseAflTradeReconciliationScopeDecisionArguments(argv)).toEqual({
      schemaVersion: 'afl-trade-reconciliation-scope-decision/v1',
      completionId,
      scope: 'pick_lineage_deferral',
      approvalArtifactId: `artifact:${digest('a')}`,
      decidedBy: 'owner:robert',
      rationale: 'Owner approval 2026-10-11, pick side deferred until #853 lineage lands.',
      decidedAt: '2026-10-11T01:00:00.000Z',
    });
  });

  it('rejects another scope, a non-artifact approval or an inexact instant', () => {
    const swap = (flag: string, value: string) =>
      argv.map((item, index) => (argv[index - 1] === flag ? value : item));
    for (const bad of [
      swap('--scope', 'everything'),
      swap('--approval-artifact', 'file:///tmp/approval.md'),
      swap('--decided-at', '2026-10-11T01:00:00Z'),
      argv.slice(0, -2),
    ]) {
      expect(() => parseAflTradeReconciliationScopeDecisionArguments(bad)).toThrow(/requires/);
    }
  });
});
