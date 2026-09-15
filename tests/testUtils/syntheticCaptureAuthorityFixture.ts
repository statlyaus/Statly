import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createAflTradeContentAddress as address } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';

/** Synthetic upstream approval only; writes through the existing Gate ledger owner. */
export async function registerSyntheticCaptureAuthority(
  sql: AflOutcomeSqlClient,
  input: {
    provider: 'draftguru' | 'official_afl';
    environment: 'test_fixture' | 'non_production';
    year: number;
    at: string;
    expires: string;
    scope: { artifactId: string };
    fields: string[];
    key?: string;
    datasetVersion?: string;
    dataset: string;
    clientVersion: string;
    capabilityId: string;
    nullableTerms: boolean;
  }
) {
  const {
    provider,
    environment,
    year,
    at,
    expires,
    scope,
    fields,
    dataset,
    clientVersion,
    capabilityId,
    nullableTerms,
  } = input;
  const decisionKey = input.key ?? 'synthetic-retained-' + provider + '-' + at;
  const operations = [
    'bounded_evaluation_capture',
    'raw_evidence_retention',
    'metadata_hash_retention',
    'internal_quality_evaluation',
  ] as const;
  function buildSourceRights() {
    const content = {
      schemaVersion: 'afl-trade-source-rights/v2',
      registerId: decisionKey,
      provider,
      dataset,
      datasetVersion: input.datasetVersion ?? 'synthetic/v1',
      intendedPurpose: 'Synthetic private source closure regression',
      scope: {
        competitions: ['AFLM'],
        seasonRanges: [{ from: year, to: year }],
        accessMechanism: 'automated_web',
      },
      acquisition: {
        kind: 'provider_web',
        clientName: 'Synthetic',
        clientVersion,
        capabilityId,
      },
      operations: {
        bounded_evaluation_capture: 'allowed',
        raw_evidence_retention: 'allowed',
        metadata_hash_retention: 'allowed',
        internal_quality_evaluation: 'allowed',
        model_training: 'blocked',
        derived_feature_creation: 'blocked',
        public_derived_output: 'blocked',
        public_fact_display: 'blocked',
        raw_field_redistribution: 'blocked',
      },
      automatedAccess: {
        permitted: true,
        identification: 'Synthetic',
        rateLimit: { requests: 1, perSeconds: 5, burst: 1 },
        cache: { permitted: true, maximumSeconds: 3600 },
      },
      retention: {
        rawEvidence: {
          disposition: 'retained',
          maximumDays: 365,
          deleteOnWithdrawal: true,
          basis: 'Synthetic',
        },
        hashesAndMetadata: {
          disposition: 'retained',
          maximumDays: null,
          deleteOnWithdrawal: false,
          basis: 'Synthetic',
        },
        derivedArtifacts: {
          disposition: 'retained',
          maximumDays: 365,
          deleteOnWithdrawal: true,
          basis: 'Synthetic',
        },
      },
      redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: false },
      attribution: { required: true, text: 'Synthetic', placement: 'Synthetic' },
      restrictions: { geographic: [], commercial: ['internal-evaluation'], audience: ['internal'] },
      fields: fields.map((f) => ({
        sourceField: f,
        normalizedField: f,
        uses: {
          archive_fact: 'allowed',
          model_training: 'blocked',
          derived_feature: 'blocked',
          public_display: 'blocked',
        },
        attributionRequired: true,
        notes: 'Synthetic',
      })),
      conditions: [
        {
          conditionId: 'provider-egress-control',
          description: 'Synthetic admission/network',
          appliesToOperations: ['bounded_evaluation_capture'],
          verificationEvidenceIds: [scope.artifactId],
        },
      ],
      rightsEvidenceIds: [scope.artifactId],
      termsEffectiveAt: nullableTerms ? null : at,
      termsExpireAt: nullableTerms ? null : expires,
      withdrawalDuties: {
        stopCollection: true,
        stopNewDerivedWork: true,
        reassessPublishedOutputs: true,
        deletionInstructions: 'Synthetic',
        retainableAuditMaterial: 'Synthetic',
      },
      proposedAt: at,
      proposedBy: 'synthetic-owner',
      proposalOrigin: 'agent_assisted',
    };
    const rights = aflTradeSourceRightsProposalSchema.parse({
      rightsArtifactId: address('source-rights', content),
      content,
    });
    return { content, rights };
  }
  const { content, rights } = buildSourceRights();
  const decisionScope = {
    scopeKey: decisionKey,
    description: 'Synthetic retained capture',
    dimensions: [
      { name: 'source_rights_artifact', values: [rights.rightsArtifactId] },
      { name: 'competition', values: ['AFLM'] },
      { name: 'season', values: [String(year)] },
      { name: 'access_mechanism', values: ['automated_web'] },
      { name: 'geography', values: ['global'] },
      { name: 'commercial_context', values: ['internal-evaluation'] },
      { name: 'audience', values: ['internal'] },
      { name: 'operation', values: [...operations] },
    ],
    exclusions: ['Synthetic only'],
  };
  const pc = {
    schemaVersion: 'afl-trade-gate-proposal/v1',
    gate: 'gate_0a_permission_to_evaluate',
    decisionKey,
    version: 1,
    environment,
    scope: decisionScope,
    proposal: 'Synthetic retained capture',
    alternativesConsidered: ['Skip synthetic test'],
    accountableOwner: 'synthetic-owner',
    reviewRequirement: 'accountable_owner_only',
    requiredReviewerRoles: [],
    conditions: [
      {
        conditionId: 'provider-egress-control',
        description: 'Synthetic network',
        required: true,
        verificationEvidenceIds: [scope.artifactId],
      },
    ],
    evidenceIds: [scope.artifactId],
    affectedArtifacts: [{ kind: 'source_rights', artifactId: rights.rightsArtifactId }],
    proposedAt: at,
    proposedBy: 'synthetic-owner',
    proposalOrigin: 'agent_assisted',
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: address('gate-proposal', pc),
    content: pc,
  });
  const dc = {
    schemaVersion: 'afl-trade-gate-decision/v1',
    proposalId: proposal.proposalId,
    gate: pc.gate,
    decisionKey,
    version: 1,
    environment,
    scope: decisionScope,
    state: 'approved',
    // Synthetic upstream record, including when testing the nonproduction owner path.
    authorityKind: environment === 'test_fixture' ? 'fixture' : 'external_human_record',
    accountableOwner: 'synthetic-owner',
    decidedBy: 'synthetic-owner',
    reviewers: [],
    authorityEvidenceIds: [scope.artifactId],
    conditionResults: [
      {
        conditionId: 'provider-egress-control',
        status: 'satisfied',
        evidenceIds: [scope.artifactId],
        explanation: 'Synthetic network admission',
      },
    ],
    rationale: 'Synthetic only',
    limitations: ['Synthetic only'],
    decidedAt: at,
    effectiveAt: at,
    revalidateAt: expires,
    supersedesDecisionId: null,
    affectedArtifacts: pc.affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: address('gate-decision', dc),
    content: dc,
  });
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(sql);
  await ledger.append({
    expectedRevision: (await ledger.load()).revision,
    sourceRights: rights,
    proposal,
    decision,
  });
  return { content, rights, decisionKey, ledger, operations, proposal, decision };
}
