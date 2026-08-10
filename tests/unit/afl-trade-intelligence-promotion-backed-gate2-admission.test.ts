import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradePromotionBackedCorpus } from '@/server/aflTradeIntelligence/artifacts/promotionBackedCorpusContracts';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  AFL_TRADE_PROMOTION_BACKED_GATE2_ADMISSION_SCHEMA_VERSION,
  createAflTradePromotionBackedGate2Admission,
  createAflTradePromotionBackedGate2AffectedArtifacts,
  createAflTradePromotionBackedGate2DecisionKey,
  parseAflTradePromotionBackedGate2Admission,
} from '@/server/aflTradeIntelligence/outcomes/promotionBackedGate2AdmissionContracts';
import { createAflTradePromotionBackedFactualLineage } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualLineageContracts';
import { createAflTradePromotionBackedFactualRelease } from '@/server/aflTradeIntelligence/outcomes/promotionBackedFactualReleaseContracts';

const sha = (value: string) => value.repeat(64);

function lineage() {
  const promotionId = `external-canonical-promotion:${sha('a')}`;
  const canonicalRecordId = `event-version:${sha('b')}`;
  const corpus = createAflTradePromotionBackedCorpus({
    environment: 'test_fixture',
    competition: 'AFLM',
    createdAt: '2026-08-10T00:00:02.000Z',
    knowledgeCutoffAt: '2026-08-10T00:00:01.000Z',
    promotions: [
      {
        promotionId,
        promotionSha256: sha('a'),
        anchorSeasonYear: 2025,
        finalizedAt: '2026-08-10T00:00:00.000Z',
        promotionRecordCount: 1,
      },
    ],
    members: [
      {
        promotionId,
        recordKind: 'transaction',
        sourceRecordId: 'trade:2025:1',
        canonicalRecordId,
        recordSha256: sha('c'),
      },
    ],
  });
  const factual = createAflTradePromotionBackedFactualRelease({
    corpus,
    scopeKey: 'public-afl-draft-trade-outcomes:AFLM:2025',
    createdAt: '2026-08-10T00:00:03.000Z',
    effectiveThrough: corpus.content.knowledgeCutoffAt,
    sourceCaptures: [
      {
        captureId: 'capture:draftguru-trade-1',
        sourceSnapshotId: `source-snapshot:${sha('d')}`,
        rightsArtifactId: `source-rights:${sha('e')}`,
        gateDecisionId: `gate-decision:${sha('f')}`,
        recordSha256: sha('0'),
        recordedAt: '2026-08-10T00:00:01.000Z',
      },
    ],
    promotionSources: [{ promotionId, captureIds: ['capture:draftguru-trade-1'] }],
    canonicalMembers: [
      {
        recordKind: 'transaction',
        canonicalRecordId,
        canonicalRecordSha256: sha('1'),
      },
    ],
  });
  return createAflTradePromotionBackedFactualLineage({
    corpus: factual.corpus,
    release: factual.release,
    candidate: factual.candidate,
    createdAt: '2026-08-10T00:00:04.000Z',
  });
}

function gateLedger(
  parent: ReturnType<typeof lineage>,
  overrides: {
    affectedArtifacts?: ReturnType<typeof createAflTradePromotionBackedGate2AffectedArtifacts>;
    scopeKey?: string;
    competition?: string;
    state?: 'approved' | 'withdrawn';
    proposedAt?: string;
    revalidateAt?: string;
  } = {}
): AflTradeGateDecisionLedger {
  const affectedArtifacts =
    overrides.affectedArtifacts ?? createAflTradePromotionBackedGate2AffectedArtifacts(parent);
  const scope = {
    scopeKey: overrides.scopeKey ?? parent.content.scopeKey,
    description: 'Review the exact promotion-backed factual corpus and candidate lineage.',
    dimensions: [
      { name: 'competition', values: [overrides.competition ?? parent.content.competition] },
      { name: 'valid_from_season', values: [String(parent.content.validFromSeason)] },
      { name: 'valid_through_season', values: [String(parent.content.validThroughSeason)] },
    ],
    exclusions: ['Valuation, grading, public activation, and fantasy ownership'],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_2_corpus_lineage' as const,
    decisionKey: createAflTradePromotionBackedGate2DecisionKey(parent),
    version: 1,
    environment: parent.content.environment,
    scope,
    proposal: 'Approve the exact factual lineage for downstream factual release review.',
    alternativesConsidered: ['Keep the factual candidate private and unavailable.'],
    accountableOwner: 'fixture-factual-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [`artifact:${sha('2')}`],
    affectedArtifacts,
    proposedAt: overrides.proposedAt ?? '2026-08-10T00:00:05.000Z',
    proposedBy: 'fixture-factual-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const state = overrides.state ?? 'approved';
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: proposal.content.gate,
    decisionKey: proposal.content.decisionKey,
    version: 1,
    environment: proposal.content.environment,
    scope,
    state,
    authorityKind: 'fixture' as const,
    accountableOwner: 'fixture-factual-owner',
    decidedBy: 'fixture-factual-owner',
    reviewers: [],
    authorityEvidenceIds: [`artifact:${sha('3')}`],
    conditionResults: [],
    rationale: 'Fixture factual lineage authority.',
    limitations: ['No production authority.'],
    decidedAt: '2026-08-10T00:00:06.000Z',
    effectiveAt: '2026-08-10T00:00:06.000Z',
    revalidateAt: overrides.revalidateAt ?? '2027-08-10T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts,
    withdrawalActions: state === 'withdrawn' ? ['Keep the factual release unavailable.'] : [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposals: [proposal], decisions: [decision] };
}

describe('promotion-backed Gate 2 admission', () => {
  it('admits one exact current Gate 2 decision without granting publication authority', () => {
    const parent = lineage();
    const admission = createAflTradePromotionBackedGate2Admission({
      lineage: parent,
      ledger: gateLedger(parent),
      ledgerRevision: 1,
      evaluatedAt: '2026-08-10T00:00:07.000Z',
    });

    expect(parseAflTradePromotionBackedGate2Admission(admission)).toEqual(admission);
    expect(admission.content.schemaVersion).toBe(
      AFL_TRADE_PROMOTION_BACKED_GATE2_ADMISSION_SCHEMA_VERSION
    );
    expect(admission.content.lineageId).toBe(parent.lineageId);
    expect(admission.content.publicationEligible).toBe(false);
    expect(admission.content.gate2DecisionId).toMatch(/^gate-decision:[a-f0-9]{64}$/);
    expect(admission.admissionId).toMatch(/^corpus-factual-lineage-admission:[a-f0-9]{64}$/);
  });

  it('rejects missing or substituted affected artifacts', () => {
    const parent = lineage();
    const incomplete = createAflTradePromotionBackedGate2AffectedArtifacts(parent).slice(1);

    expect(() =>
      createAflTradePromotionBackedGate2Admission({
        lineage: parent,
        ledger: gateLedger(parent, { affectedArtifacts: incomplete }),
        ledgerRevision: 1,
        evaluatedAt: '2026-08-10T00:00:07.000Z',
      })
    ).toThrow(/artifact/i);
  });

  it('rejects wrong scope, competition, and stale authority', () => {
    const parent = lineage();
    for (const ledger of [
      gateLedger(parent, { scopeKey: 'different-scope' }),
      gateLedger(parent, { competition: 'AFLW' }),
      gateLedger(parent, { revalidateAt: '2026-08-10T00:00:07.000Z' }),
      gateLedger(parent, { state: 'withdrawn' }),
    ]) {
      expect(() =>
        createAflTradePromotionBackedGate2Admission({
          lineage: parent,
          ledger,
          ledgerRevision: 1,
          evaluatedAt: '2026-08-10T00:00:07.000Z',
        })
      ).toThrow(/Gate 2|scope|eligible/i);
    }
  });

  it('rejects decisions proposed before their immutable lineage existed', () => {
    const parent = lineage();
    expect(() =>
      createAflTradePromotionBackedGate2Admission({
        lineage: parent,
        ledger: gateLedger(parent, { proposedAt: '2026-08-10T00:00:03.000Z' }),
        ledgerRevision: 1,
        evaluatedAt: '2026-08-10T00:00:07.000Z',
      })
    ).toThrow(/chronology/i);
  });
});
