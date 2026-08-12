import { describe, expect, it } from 'vitest';

import {
  createApprovedAflTradeFitzRoySourcePolicies,
  type ApprovedAflTradeFitzRoyFieldSets,
} from '@/server/aflTradeIntelligence/source/approvedFitzRoySourcePolicies';
import { createApprovedAflTradeFitzRoyGateRecords } from '@/server/aflTradeIntelligence/source/approvedFitzRoyGateRecords';
import { evaluateAflTradeGate0A } from '@/server/aflTradeIntelligence/source/sourceContracts';

const field = (sourceField: string, normalizedField: string) => ({
  sourceField,
  normalizedField,
  uses: {
    archive_fact: 'allowed' as const,
    model_training: 'allowed' as const,
    derived_feature: 'allowed' as const,
    public_display: 'allowed' as const,
  },
  attributionRequired: true,
  notes: null,
});

const fieldSets: ApprovedAflTradeFitzRoyFieldSets = {
  'afl-tables-player-stats': [field('Player', 'player.displayName'), field('GL', 'goals')],
  'footywire-player-stats': [field('Player', 'player.displayName'), field('Goals', 'goals')],
  'fryzigg-player-stats': [field('player_name', 'player.displayName'), field('goals', 'goals')],
};

const conditionEvidence = {
  'afl-tables-player-stats': {
    'full-season-custody': `artifact:${'d'.repeat(64)}`,
    'zero-provenance-review': `artifact:${'e'.repeat(64)}`,
  },
  'footywire-player-stats': {
    'full-season-custody': `artifact:${'f'.repeat(64)}`,
    'html-schema-fingerprint': `artifact:${'1'.repeat(64)}`,
  },
  'fryzigg-player-stats': {
    'complete-rds-custody': `artifact:${'2'.repeat(64)}`,
    'reconciliation-promotion-review': `artifact:${'3'.repeat(64)}`,
  },
};

const policies = () =>
  createApprovedAflTradeFitzRoySourcePolicies({
    fieldSets,
    conditionEvidence,
    evidence: {
      terms: `artifact:${'a'.repeat(64)}`,
      authority: `artifact:${'b'.repeat(64)}`,
      rateLimit: `artifact:${'c'.repeat(64)}`,
    },
    termsEffectiveAt: '2026-08-08T00:00:00.000Z',
    termsExpireAt: '2027-08-08T00:00:00.000Z',
    proposedAt: '2026-08-08T00:00:00.000Z',
    proposedBy: 'statly-data-governance-owner',
  });

describe('approved fitzRoy source policies', () => {
  it('creates exactly one policy for each approved player-stat capability', () => {
    const result = policies();

    expect(result.map((policy) => policy.content.acquisition)).toEqual([
      expect.objectContaining({
        capabilities: [
          expect.objectContaining({
            capabilityId: 'afl-tables-player-stats',
            provider: 'afl_tables',
            directFunction: 'fetch_player_stats_afltables',
          }),
        ],
      }),
      expect.objectContaining({
        capabilities: [
          expect.objectContaining({
            capabilityId: 'footywire-player-stats',
            provider: 'footywire',
            directFunction: 'fetch_player_stats_footywire',
          }),
        ],
      }),
      expect.objectContaining({
        capabilities: [
          expect.objectContaining({
            capabilityId: 'fryzigg-player-stats',
            provider: 'fryzigg',
            directFunction: 'fetch_player_stats_fryzigg',
          }),
        ],
      }),
    ]);
    expect(new Set(result.map((policy) => policy.rightsArtifactId))).toHaveLength(3);
  });

  it('allows the approved governed uses and blocks raw redistribution', () => {
    for (const policy of policies()) {
      expect(policy.content.operations).toMatchObject({
        bounded_evaluation_capture: 'allowed',
        raw_evidence_retention: 'allowed',
        metadata_hash_retention: 'allowed',
        internal_quality_evaluation: 'allowed',
        model_training: 'allowed',
        derived_feature_creation: 'allowed',
        public_derived_output: 'allowed',
        public_fact_display: 'allowed',
        raw_field_redistribution: 'blocked',
      });
      expect(policy.content.redistribution).toEqual({
        rawFieldsPermitted: false,
        publicDerivedOutputPermitted: true,
      });
      if (policy.content.acquisition.kind !== 'fitzroy') {
        throw new Error('Approved fitzRoy policy unexpectedly changed acquisition kind.');
      }
      const capabilityId = policy.content.acquisition.capabilities[0].capabilityId;
      if (!(capabilityId in fieldSets)) {
        throw new Error('Approved fitzRoy policy contains an unexpected capability.');
      }
      expect(policy.content.fields).toEqual(fieldSets[capabilityId as keyof typeof fieldSets]);
    }
  });

  it('keeps approval finite and applies provider-specific capture limits', () => {
    const [aflTables, footywire, fryzigg] = policies();

    expect(aflTables.content.scope.seasonRanges).toEqual([{ from: 1897, to: 2026 }]);
    expect(footywire.content.scope.seasonRanges).toEqual([{ from: 2010, to: 2026 }]);
    expect(fryzigg.content.scope.seasonRanges).toEqual([{ from: 1897, to: 2026 }]);
    for (const policy of [aflTables, footywire, fryzigg]) {
      expect(policy.content.termsEffectiveAt).toBe('2026-08-08T00:00:00.000Z');
      expect(policy.content.termsExpireAt).toBe('2027-08-08T00:00:00.000Z');
      expect(policy.content.automatedAccess.rateLimit).toEqual(
        expect.objectContaining({ requests: 1, burst: 1 })
      );
    }
  });

  it('rejects a missing or empty reviewed field set', () => {
    expect(() =>
      createApprovedAflTradeFitzRoySourcePolicies({
        fieldSets: { ...fieldSets, 'footywire-player-stats': [] },
        conditionEvidence,
        evidence: {
          terms: `artifact:${'a'.repeat(64)}`,
          authority: `artifact:${'b'.repeat(64)}`,
          rateLimit: `artifact:${'c'.repeat(64)}`,
        },
        termsEffectiveAt: '2026-08-08T00:00:00.000Z',
        termsExpireAt: '2027-08-08T00:00:00.000Z',
        proposedAt: '2026-08-08T00:00:00.000Z',
        proposedBy: 'statly-data-governance-owner',
      })
    ).toThrow(/field set/i);
  });

  it('binds each provider condition to dedicated reviewed evidence', () => {
    for (const policy of policies()) {
      if (policy.content.acquisition.kind !== 'fitzroy') throw new Error('Expected fitzRoy.');
      const capabilityId = policy.content.acquisition.capabilities[0].capabilityId;
      expect(
        Object.fromEntries(
          policy.content.conditions
            .filter((condition) => condition.conditionId !== 'provider-egress-control')
            .map((condition) => [condition.conditionId, condition.verificationEvidenceIds[0]])
        )
      ).toEqual(conditionEvidence[capabilityId as keyof typeof conditionEvidence]);
      expect(
        policy.content.conditions
          .filter((condition) => condition.conditionId !== 'provider-egress-control')
          .every(
            (condition) => condition.verificationEvidenceIds[0] !== `artifact:${'c'.repeat(64)}`
          )
      ).toBe(true);
      expect(
        policy.content.conditions.find(
          (condition) => condition.conditionId === 'provider-egress-control'
        )?.verificationEvidenceIds
      ).toEqual([`artifact:${'c'.repeat(64)}`]);
    }
  });

  it('creates independent deployed-environment Gate decisions for each exact provider policy', () => {
    for (const policy of policies()) {
      const reviewedApproval = {
        sourceRights: policy,
        version: 1,
        supersedesDecisionId: null,
        decidedAt: '2026-08-08T00:01:00.000Z',
        effectiveAt: '2026-08-08T00:02:00.000Z',
        revalidateAt: '2027-08-08T00:00:00.000Z',
        accountableOwner: 'statly-data-governance-owner',
        reviewer: {
          id: 'statly-source-governance-reviewer',
          role: 'source-governance-reviewer',
          evidenceId: `artifact:${'d'.repeat(64)}`,
        },
        authorityEvidenceId: `artifact:${'e'.repeat(64)}`,
        rateLimitEvidenceId: `artifact:${'c'.repeat(64)}`,
      } as const;
      const records = createApprovedAflTradeFitzRoyGateRecords({
        ...reviewedApproval,
        environment: 'production',
      });
      const nonProductionRecords = createApprovedAflTradeFitzRoyGateRecords({
        ...reviewedApproval,
        environment: 'non_production',
      });
      if (policy.content.acquisition.kind !== 'fitzroy') {
        throw new Error('Approved fitzRoy policy unexpectedly changed acquisition kind.');
      }
      const capability = policy.content.acquisition.capabilities[0];
      const season = policy.content.scope.seasonRanges[0].to;
      const ledger = { proposals: [records.proposal], decisions: [records.decision] };

      expect(records.proposal.content.environment).toBe('production');
      expect(records.proposal.content.decisionKey).toBe(`${capability.capabilityId}-production`);
      expect(records.proposal.content.scope.scopeKey).toBe(`afl-trade-${capability.capabilityId}`);
      expect(nonProductionRecords.proposal.content).toMatchObject({
        decisionKey: `${capability.capabilityId}-non_production`,
        environment: 'non_production',
        version: 1,
        scope: { scopeKey: `afl-trade-${capability.capabilityId}-non_production` },
      });
      expect(nonProductionRecords.decision.content.supersedesDecisionId).toBeNull();
      expect(records.decision.content).toMatchObject({
        state: 'approved',
        authorityKind: 'external_human_record',
        revalidateAt: '2027-08-08T00:00:00.000Z',
      });
      expect(
        evaluateAflTradeGate0A(ledger, policy, {
          decisionKey: records.proposal.content.decisionKey,
          environment: 'production',
          rightsArtifactId: policy.rightsArtifactId,
          evaluatedAt: '2026-08-09T00:00:00.000Z',
          competition: policy.content.scope.competitions[0],
          season,
          accessMechanism: policy.content.scope.accessMechanism,
          capabilityId: capability.capabilityId,
          geography: 'global',
          commercialContext: 'public-research',
          audience: 'public',
          operations: [
            'bounded_evaluation_capture',
            'raw_evidence_retention',
            'metadata_hash_retention',
            'internal_quality_evaluation',
            'model_training',
            'derived_feature_creation',
            'public_derived_output',
            'public_fact_display',
          ],
          fieldUses: policy.content.fields.flatMap((sourceField) =>
            (['archive_fact', 'model_training', 'derived_feature', 'public_display'] as const).map(
              (use) => ({ sourceField: sourceField.sourceField, use })
            )
          ),
          rawRetentionDays: 365,
          metadataRetentionDays: null,
          cacheSeconds: 86_400,
        }).status
      ).toBe('mechanically_eligible');
    }
  });
});
