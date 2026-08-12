import { describe, expect, it } from 'vitest';

import { appendAflTradeGateDecision } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import { createApprovedAflTradeFitzRoyGateRecords } from '@/server/aflTradeIntelligence/source/approvedFitzRoyGateRecords';
import { createApprovedAflTradeFitzRoySourcePolicies } from '@/server/aflTradeIntelligence/source/approvedFitzRoySourcePolicies';
import { requireCurrentAflTradeFitzRoyCaptureAuthority } from '@/server/aflTradeIntelligence/source/fitzRoyProviderIngestion';

const artifact = (letter: string) => `artifact:${letter.repeat(64)}`;

function authorityFixture() {
  const field = {
    sourceField: 'Player',
    normalizedField: 'player.displayName',
    uses: {
      archive_fact: 'allowed' as const,
      model_training: 'allowed' as const,
      derived_feature: 'allowed' as const,
      public_display: 'allowed' as const,
    },
    attributionRequired: true,
    notes: null,
  };
  const sourceRights = createApprovedAflTradeFitzRoySourcePolicies({
    fieldSets: {
      'afl-tables-player-stats': [field],
      'footywire-player-stats': [field],
      'fryzigg-player-stats': [field],
    },
    conditionEvidence: {
      'afl-tables-player-stats': {
        'full-season-custody': artifact('1'),
        'zero-provenance-review': artifact('2'),
      },
      'footywire-player-stats': {
        'full-season-custody': artifact('3'),
        'html-schema-fingerprint': artifact('4'),
      },
      'fryzigg-player-stats': {
        'complete-rds-custody': artifact('5'),
        'reconciliation-promotion-review': artifact('6'),
      },
    },
    evidence: {
      terms: artifact('a'),
      authority: artifact('b'),
      rateLimit: artifact('c'),
    },
    termsEffectiveAt: '2026-08-01T00:00:00.000Z',
    termsExpireAt: '2027-08-01T00:00:00.000Z',
    proposedAt: '2026-08-02T00:00:00.000Z',
    proposedBy: 'source-governance-owner',
  }).find(({ content }) => content.provider === 'footywire');
  if (sourceRights === undefined) throw new Error('Footywire source policy fixture is missing.');

  const record = (version: number, supersedesDecisionId: string | null, effectiveAt: string) =>
    createApprovedAflTradeFitzRoyGateRecords({
      sourceRights,
      environment: 'production',
      version,
      supersedesDecisionId,
      decidedAt: effectiveAt,
      effectiveAt,
      revalidateAt: '2027-08-01T00:00:00.000Z',
      accountableOwner: 'source-governance-owner',
      reviewer: {
        id: 'source-reviewer',
        role: 'source-governance-reviewer',
        evidenceId: artifact('d'),
      },
      authorityEvidenceId: artifact('b'),
      rateLimitEvidenceId: artifact('c'),
    });

  const first = record(1, null, '2026-08-02T00:10:00.000Z');
  const request = {
    decisionKey: first.proposal.content.decisionKey,
    environment: 'production' as const,
    rightsArtifactId: sourceRights.rightsArtifactId,
    evaluatedAt: '2026-08-02T00:11:00.000Z',
    competition: 'AFLM',
    season: 2026,
    accessMechanism: 'automated_web' as const,
    capabilityId: 'footywire-player-stats',
    geography: 'global',
    commercialContext: 'public-research',
    audience: 'public',
    operations: ['bounded_evaluation_capture', 'public_fact_display'] as const,
    fieldUses: [{ sourceField: 'Player', use: 'public_display' as const }],
    rawRetentionDays: 365,
    metadataRetentionDays: null,
    cacheSeconds: 86_400,
  };
  return { sourceRights, first, record, request };
}

describe('fitzRoy provider ingestion authority', () => {
  it('accepts the captured decision while it remains the current effective authority', () => {
    const fixture = authorityFixture();
    const ledger = appendAflTradeGateDecision(
      { proposals: [], decisions: [] },
      fixture.first.proposal,
      fixture.first.decision
    );

    expect(() =>
      requireCurrentAflTradeFitzRoyCaptureAuthority({
        ledger,
        sourceRights: fixture.sourceRights,
        request: fixture.request,
        capturedDecisionId: fixture.first.decision.decisionId,
        evaluatedAt: '2026-08-02T00:12:00.000Z',
      })
    ).not.toThrow();
  });

  it('rejects staging when a successor approval supersedes the captured decision', () => {
    const fixture = authorityFixture();
    const initialLedger = appendAflTradeGateDecision(
      { proposals: [], decisions: [] },
      fixture.first.proposal,
      fixture.first.decision
    );
    const successor = fixture.record(
      2,
      fixture.first.decision.decisionId,
      '2026-08-02T00:12:00.000Z'
    );
    const renewedLedger = appendAflTradeGateDecision(
      initialLedger,
      successor.proposal,
      successor.decision
    );

    expect(() =>
      requireCurrentAflTradeFitzRoyCaptureAuthority({
        ledger: renewedLedger,
        sourceRights: fixture.sourceRights,
        request: fixture.request,
        capturedDecisionId: fixture.first.decision.decisionId,
        evaluatedAt: '2026-08-02T00:13:00.000Z',
      })
    ).toThrow('no longer the current effective decision');
  });
});
