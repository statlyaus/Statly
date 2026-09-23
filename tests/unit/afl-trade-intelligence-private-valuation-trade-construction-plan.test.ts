import { describe, expect, it } from 'vitest';

import {
  createAflTradeCanonicalJsonArtifactRef,
  type AflTradeArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  PRIVATE_VALUATION_TRADE_CONSTRUCTION_EVIDENCE_ROLES,
  planPrivateValuationTradeConstruction,
} from '@/server/aflTradeIntelligence/valuation/internal/privateValuationTradeConstructionPlan';

const at = '2026-09-23T00:00:00.000Z';
const tradeId = 'afl-trade:2025:0001';
const sealedCohortTradeIds = ['afl-trade:2025:0001', 'afl-trade:2025:0002'];

const reference = (label: string): AflTradeArtifactRef =>
  createAflTradeCanonicalJsonArtifactRef({ label }, at);

const resolvedEveryRole = PRIVATE_VALUATION_TRADE_CONSTRUCTION_EVIDENCE_ROLES.map((role) => ({
  role,
  reference: reference(role),
}));

const membershipEvidence = [reference('release-membership')];

describe('private valuation trade construction plan', () => {
  it('plans every required retained parent in manifest order', () => {
    const plan = planPrivateValuationTradeConstruction({
      tradeId,
      sealedCohortTradeIds,
      resolved: resolvedEveryRole,
      inspectedEvidenceRefs: membershipEvidence,
    });

    expect(plan.state).toBe('ready');
    if (plan.state !== 'ready') throw new Error(plan.blockers[0]?.code);
    expect(plan.parents.map(({ role }) => role)).toEqual([
      ...PRIVATE_VALUATION_TRADE_CONSTRUCTION_EVIDENCE_ROLES,
    ]);
    expect(plan.parents.map(({ reference: parent }) => parent.artifactId)).toEqual(
      resolvedEveryRole.map(({ reference: parent }) => parent.artifactId)
    );
  });

  it('refuses a trade that is not a sealed cohort member, naming the membership evidence', () => {
    const plan = planPrivateValuationTradeConstruction({
      tradeId: 'afl-trade:2025:9999',
      sealedCohortTradeIds,
      resolved: resolvedEveryRole,
      inspectedEvidenceRefs: membershipEvidence,
    });

    expect(plan).toEqual({
      state: 'blocked',
      blockers: [
        {
          code: 'unsupported_trade',
          subject: { kind: 'trade', id: 'afl-trade:2025:9999' },
          evidenceRefs: membershipEvidence,
        },
      ],
    });
  });

  it('names each missing parent with its own code and subject', () => {
    const plan = planPrivateValuationTradeConstruction({
      tradeId,
      sealedCohortTradeIds,
      resolved: resolvedEveryRole.filter(
        ({ role }) => role !== 'explanation_policy' && role !== 'lineage_graph'
      ),
      inspectedEvidenceRefs: membershipEvidence,
    });

    expect(plan.state).toBe('blocked');
    if (plan.state !== 'blocked') throw new Error('expected a blocked plan');
    expect(plan.blockers).toEqual([
      {
        code: 'policy_unavailable',
        subject: { kind: 'policy', id: 'explanation_policy' },
        evidenceRefs: membershipEvidence,
      },
      {
        code: 'lineage_unresolved',
        subject: { kind: 'lineage', id: 'lineage_graph' },
        evidenceRefs: membershipEvidence,
      },
    ]);
  });

  it('blocks with every missing parent rather than stopping at the first', () => {
    const plan = planPrivateValuationTradeConstruction({
      tradeId,
      sealedCohortTradeIds,
      resolved: [],
      inspectedEvidenceRefs: membershipEvidence,
    });

    expect(plan.state).toBe('blocked');
    if (plan.state !== 'blocked') throw new Error('expected a blocked plan');
    expect(plan.blockers.map(({ code }) => code)).toEqual([
      'insufficient_data',
      'component_output_unavailable',
      'policy_unavailable',
      'lineage_unresolved',
      'insufficient_data',
      'insufficient_data',
    ]);
  });

  it('refuses a conflicting resolution of the same parent instead of choosing one', () => {
    expect(() =>
      planPrivateValuationTradeConstruction({
        tradeId,
        sealedCohortTradeIds,
        resolved: [
          ...resolvedEveryRole,
          { role: 'lineage_graph', reference: reference('other-lineage') },
        ],
        inspectedEvidenceRefs: membershipEvidence,
      })
    ).toThrow(TypeError);
  });

  it('refuses to plan when the caller inspected no evidence to name', () => {
    expect(() =>
      planPrivateValuationTradeConstruction({
        tradeId,
        sealedCohortTradeIds,
        resolved: resolvedEveryRole,
        inspectedEvidenceRefs: [],
      })
    ).toThrow(TypeError);
  });
});
