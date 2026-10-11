import { describe, expect, it, vi } from 'vitest';

import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
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
import { isAflTradePickSideReconciliationIssue } from '@/server/aflTradeIntelligence/source/pickLineageDeferral';
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
function sourceBatch() {
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

function dependencies(decision: AflTradeReconciliationScopeDecision | null) {
  const batch = sourceBatch();
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
