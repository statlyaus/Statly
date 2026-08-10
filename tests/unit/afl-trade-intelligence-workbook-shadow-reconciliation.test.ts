import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflTradeExternalReconciliationCandidate } from '@/server/aflTradeIntelligence/source/externalEvidenceReconciliation';
import {
  createAflTradeWorkbookShadowDisposition,
  createAflTradeWorkbookShadowReport,
} from '@/server/aflTradeIntelligence/source/workbookShadowReconciliation';

const reconciledAt = '2026-08-09T05:00:00.000Z';

function candidate(
  overrides: Partial<AflTradeExternalReconciliationCandidate['content']> = {}
): AflTradeExternalReconciliationCandidate {
  const content: AflTradeExternalReconciliationCandidate['content'] = {
    schemaVersion: 'afl-trade-external-reconciliation/v1',
    sourceBatchIds: [],
    identityResolutionIds: [],
    transactions: [
      {
        transactionId: 'external-transaction:test',
        providerEventId: '2025-test',
        seasonYear: 2025,
        occurredOn: '2025-10-15',
        transactionType: 'trade',
        title: '2025 Test Trade',
        parties: ['club-a', 'club-b'],
        transferIds: [],
        status: 'single_source',
        evidenceIds: [],
      },
    ],
    transfers: [],
    draftSelections: [
      {
        selectionId: 'external-draft-selection:test',
        draftYear: 2025,
        draftType: 'national',
        selectionNumber: 14,
        roundNumber: 1,
        pickId: 'draft-pick:test',
        playerId: 'player-harry-kyle',
        clubId: 'club-b',
        status: 'corroborated',
        supportingProviders: ['draftguru', 'footywire'],
        evidenceIds: [],
      },
    ],
    pickCustody: [],
    pickLineage: [],
    issues: [],
    reconciledAt,
    publicationEligible: false,
    ...overrides,
  };
  return {
    candidateId: createAflTradeContentAddress('external-reconciliation', content),
    content,
  };
}

const matchingOracle = [
  {
    oracleRowId: 'workbook-row:trade-1',
    kind: 'transaction' as const,
    seasonYear: 2025,
    title: '2025 Test Trade',
    parties: ['club-a', 'club-b'],
  },
  {
    oracleRowId: 'workbook-row:selection-14',
    kind: 'draft_selection' as const,
    draftYear: 2025,
    draftType: 'national' as const,
    selectionNumber: 14,
    playerId: 'player-harry-kyle',
    clubId: 'club-b',
  },
];

describe('workbook shadow reconciliation', () => {
  it('accounts for exact matches without making the workbook authoritative', () => {
    const report = createAflTradeWorkbookShadowReport({
      reconciliationCandidate: candidate(),
      workbookStagingPackageId: `workbook-import:${'a'.repeat(64)}`,
      oracleFacts: matchingOracle,
      dispositions: [],
      comparedAt: '2026-08-09T06:00:00.000Z',
    });

    expect(report.content.counts).toEqual({ matched: 2, deltas: 0, unexplained: 0 });
    expect(report.content.readyForWorkbookRetirement).toBe(true);
    expect(report.content.workbookAuthority).toBe('frozen_private_migration_oracle_only');
    expect(report.content.publicationEligible).toBe(false);
  });

  it('fails retirement readiness until every delta has a reviewed classification', () => {
    const oracleFacts = matchingOracle.map((fact) =>
      fact.kind === 'draft_selection' ? { ...fact, playerId: 'player-oskar-taylor' } : fact
    );
    const initial = createAflTradeWorkbookShadowReport({
      reconciliationCandidate: candidate(),
      workbookStagingPackageId: `workbook-import:${'a'.repeat(64)}`,
      oracleFacts,
      dispositions: [],
      comparedAt: '2026-08-09T06:00:00.000Z',
    });

    expect(initial.content.deltas[0]).toMatchObject({
      deltaKind: 'field_mismatch',
      classification: 'unexplained',
    });
    expect(initial.content.readyForWorkbookRetirement).toBe(false);

    const disposition = createAflTradeWorkbookShadowDisposition({
      deltaKey: initial.content.deltas[0].deltaKey,
      classification: 'approved_correction',
      rationale: 'Footywire and official AFL player details agree on Harry Kyle at pick 14.',
      reviewDecisionId: `review-decision:${'b'.repeat(64)}`,
      reviewDecisionSha256: 'b'.repeat(64),
      decidedAt: '2026-08-09T06:30:00.000Z',
    });
    const reviewed = createAflTradeWorkbookShadowReport({
      reconciliationCandidate: candidate(),
      workbookStagingPackageId: `workbook-import:${'a'.repeat(64)}`,
      oracleFacts,
      dispositions: [disposition],
      comparedAt: '2026-08-09T07:00:00.000Z',
    });

    expect(reviewed.content.deltas[0].classification).toBe('approved_correction');
    expect(reviewed.content.counts.unexplained).toBe(0);
    expect(reviewed.content.readyForWorkbookRetirement).toBe(true);
  });

  it('classifies provider-only and workbook-only facts independently', () => {
    const report = createAflTradeWorkbookShadowReport({
      reconciliationCandidate: candidate(),
      workbookStagingPackageId: `workbook-import:${'a'.repeat(64)}`,
      oracleFacts: [matchingOracle[0]],
      dispositions: [],
      comparedAt: '2026-08-09T06:00:00.000Z',
    });
    expect(report.content.deltas).toContainEqual(
      expect.objectContaining({ deltaKind: 'provider_only', classification: 'unexplained' })
    );

    const workbookOnly = createAflTradeWorkbookShadowReport({
      reconciliationCandidate: candidate({ transactions: [] }),
      workbookStagingPackageId: `workbook-import:${'a'.repeat(64)}`,
      oracleFacts: [matchingOracle[0]],
      dispositions: [],
      comparedAt: '2026-08-09T06:00:00.000Z',
    });
    expect(workbookOnly.content.deltas).toContainEqual(
      expect.objectContaining({ deltaKind: 'workbook_only', classification: 'unexplained' })
    );
  });
});
