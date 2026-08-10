import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import type { AflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import { createGovernedAflTradePublicationSelector } from '@/server/aflTradeIntelligence/publication/governedPublicationSelector';
import type { AflTradePublicationRepository } from '@/server/aflTradeIntelligence/publication/postgresPublicationRepository';
import type { AflTradePublicationRegistry } from '@/server/aflTradeIntelligence/publication/publicationState';

const id = (prefix: string, digit: string) => `${prefix}:${digit.repeat(64)}`;
const publicationId = id('publication', '1');
const projectionId = id('projection', '2');

function registry(gate4DecisionId: string, gate5DecisionId: string): AflTradePublicationRegistry {
  return {
    revision: 4,
    publications: {
      [publicationId]: {
        publicationId,
        publicationManifestSchemaVersion: 'afl-trade-publication/v2',
        scopeKey: 'fixture-current',
        valuationBundleId: id('valuation-bundle', '3'),
        valueUnitId: 'fixture-unit',
        supportedViews: ['current'],
        supportedCohorts: ['fixture-supported'],
        excludedCohorts: [],
        manifestContentSha256: '1'.repeat(64),
        state: 'published',
        createdAt: '2026-08-08T00:00:00.000Z',
        projectionId,
        gate4DecisionId,
        gate5DecisionId,
        events: [
          {
            from: 'approved',
            to: 'published',
            occurredAt: '2026-08-08T03:00:00.000Z',
            actor: 'fixture-owner',
            evidenceId: id('gate-decision', '5'),
            reason: null,
          },
        ],
      },
    },
    activeByScope: {
      'fixture-current': {
        publicationId,
        activatedAt: '2026-08-08T03:00:00.000Z',
        revision: 4,
      },
    },
  };
}

function gateRecord(
  gate: 'gate_4_publication_api_readiness' | 'gate_5_comprehension_accessibility',
  state: 'approved' | 'withdrawn' = 'approved'
) {
  const scope = {
    scopeKey: 'fixture-current',
    description: 'Fixture.',
    dimensions: [],
    exclusions: [],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate,
    decisionKey: `${gate}-fixture`,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    proposal: 'Approve fixture publication serving.',
    alternativesConsidered: ['Keep it unavailable.'],
    accountableOwner: 'fixture-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [id('artifact', 'a')],
    affectedArtifacts: [
      { kind: 'publication' as const, artifactId: publicationId },
      { kind: 'projection' as const, artifactId: projectionId },
    ],
    proposedAt: '2026-08-08T00:00:00.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate,
    decisionKey: proposal.content.decisionKey,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    state,
    authorityKind: 'fixture' as const,
    accountableOwner: 'fixture-owner',
    decidedBy: 'fixture-owner',
    reviewers: [],
    authorityEvidenceIds: [id('artifact', 'a')],
    conditionResults: [],
    rationale: 'Fixture.',
    limitations: [],
    decidedAt: '2026-08-08T01:00:00.000Z',
    effectiveAt: '2026-08-08T01:00:00.000Z',
    revalidateAt: '2027-08-08T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: proposal.content.affectedArtifacts,
    withdrawalActions:
      state === 'withdrawn'
        ? ['Stop serving the affected publication and retain the last governed release.']
        : [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposal, decision };
}

function dependencies(state: 'approved' | 'withdrawn' = 'approved') {
  const gate4 = gateRecord('gate_4_publication_api_readiness');
  const gate5 = gateRecord('gate_5_comprehension_accessibility', state);
  const ledger = {
    proposals: [gate4.proposal, gate5.proposal],
    decisions: [gate4.decision, gate5.decision],
  } satisfies AflTradeGateDecisionLedger;
  return {
    publicationRepository: {
      load: async () => registry(gate4.decision.decisionId, gate5.decision.decisionId),
    } as AflTradePublicationRepository,
    gateRepository: {
      load: async () => ({ revision: 2, ledger }),
    } as unknown as AflTradeGateDecisionLedgerRepository,
    environment: 'test_fixture' as const,
    now: () => '2026-08-08T04:00:00.000Z',
  };
}

describe('governed AFL trade publication selector', () => {
  it('captures an active publication only while its exact Gate 4 and Gate 5 decisions are current', async () => {
    const selector = createGovernedAflTradePublicationSelector(dependencies());

    const snapshot = await selector.capture('fixture-current');

    expect(snapshot.registryRevision).toBe(4);
    expect(snapshot.selection).toMatchObject({
      projectionBuildId: projectionId,
      publication: { publicationId },
    });
  });

  it('fails closed when a bound publication decision is withdrawn', async () => {
    const selector = createGovernedAflTradePublicationSelector(dependencies('withdrawn'));

    await expect(selector.capture('fixture-current')).resolves.toEqual({
      registryRevision: 4,
      selection: null,
      unavailabilityReason: 'source_blocked',
    });
  });
});
