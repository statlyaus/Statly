import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlQueryResult,
  AflOutcomeSqlTransaction,
} from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import {
  aflTradeSourceRightsProposalSchema,
  type AflTradeSourceRightsProposal,
} from '@/server/aflTradeIntelligence/source/sourceContracts';

const instant = '2026-08-08T00:00:00.000Z';
const evidence = (letter: string) => `artifact:${letter.repeat(64)}`;

function sourceRights(): AflTradeSourceRightsProposal {
  const content = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: 'footywire-player-stats-v1',
    provider: 'footywire',
    dataset: 'Footywire player statistics',
    datasetVersion: 'fitzroy-1.7.0',
    intendedPurpose: 'Historical AFL player statistics and derived trade outcomes.',
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from: 2000, to: 2026 }],
      accessMechanism: 'automated_web' as const,
    },
    acquisition: {
      kind: 'fitzroy' as const,
      capabilitySchemaVersion: 'afl-trade-fitzroy-capabilities/v1' as const,
      fitzRoyVersion: '1.7.0' as const,
      capabilities: [
        {
          capabilityId: 'footywire-player-stats',
          provider: 'footywire' as const,
          directFunction: 'fetch_player_stats_footywire',
        },
      ],
    },
    operations: {
      bounded_evaluation_capture: 'allowed' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'allowed' as const,
      derived_feature_creation: 'allowed' as const,
      public_derived_output: 'allowed' as const,
      public_fact_display: 'allowed' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      permitted: true,
      identification: 'Statly AFL trade intelligence fitzRoy capture.',
      rateLimit: { requests: 1, perSeconds: 2, burst: 1 },
      cache: { permitted: true, maximumSeconds: 86_400 },
    },
    retention: {
      rawEvidence: {
        disposition: 'retained' as const,
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: 'Retain exact governed source evidence for reproducibility.',
      },
      hashesAndMetadata: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: false,
        basis: 'Retain hashes and provenance for permanent audit.',
      },
      derivedArtifacts: {
        disposition: 'retained' as const,
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: 'Retain derived artifacts while provider authority remains current.',
      },
    },
    redistribution: {
      rawFieldsPermitted: false,
      publicDerivedOutputPermitted: true,
    },
    attribution: {
      required: true,
      text: 'Player statistics sourced through fitzRoy from Footywire.',
      placement: 'Public methodology and downloads.',
    },
    restrictions: { geographic: [], commercial: [], audience: [] },
    fields: [
      {
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
      },
    ],
    conditions: [
      {
        conditionId: 'provider-rate-limit',
        description: 'Apply the reviewed provider-keyed distributed request limit.',
        appliesToOperations: ['bounded_evaluation_capture' as const],
        verificationEvidenceIds: [evidence('d')],
      },
    ],
    rightsEvidenceIds: [evidence('a')],
    termsEffectiveAt: '2026-08-08T00:00:00.000Z',
    termsExpireAt: '2027-08-08T00:00:00.000Z',
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions: 'Stop capture and delete source bytes marked for withdrawal.',
      retainableAuditMaterial: 'Retain permitted hashes, decisions, and audit metadata.',
    },
    proposedAt: instant,
    proposedBy: 'statly-data-governance-owner',
    proposalOrigin: 'human_authored' as const,
  };
  return aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', content),
    content,
  });
}

function approval(
  rights: AflTradeSourceRightsProposal,
  decisionKey = 'footywire-player-stats-production'
) {
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey,
    version: 1,
    environment: 'production' as const,
    scope: {
      scopeKey: 'afl-trade-player-stats',
      description: 'Production AFL player statistics used by public trade intelligence.',
      dimensions: [
        { name: 'source_rights_artifact', values: [rights.rightsArtifactId] },
        { name: 'competition', values: ['AFLM'] },
        { name: 'fitzroy_capability', values: ['footywire-player-stats'] },
        { name: 'season', values: ['2000-2026'] },
        {
          name: 'operation',
          values: [
            'bounded_evaluation_capture',
            'raw_evidence_retention',
            'metadata_hash_retention',
            'internal_quality_evaluation',
            'model_training',
            'derived_feature_creation',
            'public_derived_output',
            'public_fact_display',
          ],
        },
      ],
      exclusions: ['Raw upstream field redistribution'],
    },
    proposal: 'Approve the exact Footywire player-stat capability and fields.',
    alternativesConsidered: ['Keep the provider blocked.'],
    accountableOwner: 'statly-data-governance-owner',
    reviewRequirement: 'independent_review_required' as const,
    requiredReviewerRoles: ['source-governance-reviewer'],
    conditions: [
      {
        conditionId: 'provider-rate-limit',
        description: 'Provider-specific distributed rate limiting is active.',
        required: true,
        verificationEvidenceIds: [evidence('d')],
      },
    ],
    evidenceIds: [evidence('a')],
    affectedArtifacts: [{ kind: 'source_rights' as const, artifactId: rights.rightsArtifactId }],
    proposedAt: instant,
    proposedBy: 'statly-data-governance-owner',
    proposalOrigin: 'human_authored' as const,
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
    content: proposalContent,
  });
  const decisionContent = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: proposal.content.gate,
    decisionKey: proposal.content.decisionKey,
    version: proposal.content.version,
    environment: proposal.content.environment,
    scope: proposal.content.scope,
    state: 'approved' as const,
    authorityKind: 'external_human_record' as const,
    accountableOwner: proposal.content.accountableOwner,
    decidedBy: 'statly-data-governance-owner',
    reviewers: [
      {
        reviewerId: 'source-governance-reviewer',
        role: 'source-governance-reviewer',
        evidenceId: evidence('b'),
      },
    ],
    authorityEvidenceIds: [evidence('c')],
    conditionResults: [
      {
        conditionId: 'provider-rate-limit',
        status: 'satisfied' as const,
        evidenceIds: [evidence('d')],
        explanation: 'The provider request limit is reviewed and enforceable.',
      },
    ],
    rationale: 'The named provider is approved for the exact governed uses.',
    limitations: ['Raw upstream field redistribution remains blocked.'],
    decidedAt: '2026-08-08T00:01:00.000Z',
    effectiveAt: '2026-08-08T00:02:00.000Z',
    revalidateAt: '2027-08-08T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: proposal.content.affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposal, decision };
}

function gate2Approval() {
  const affectedArtifacts = [
    { kind: 'corpus_manifest' as const, artifactId: `corpus:${'1'.repeat(64)}` },
    { kind: 'factual_release' as const, artifactId: `outcome-release:${'2'.repeat(64)}` },
    {
      kind: 'factual_release_candidate' as const,
      artifactId: `factual-release-candidate:${'3'.repeat(64)}`,
    },
    {
      kind: 'corpus_factual_lineage' as const,
      artifactId: `corpus-factual-lineage:${'4'.repeat(64)}`,
    },
  ];
  const scope = {
    scopeKey: 'public-afl-draft-trade-outcomes:AFLM:2025',
    description: 'Exact promotion-backed factual lineage.',
    dimensions: [
      { name: 'competition', values: ['AFLM'] },
      { name: 'valid_from_season', values: ['2025'] },
      { name: 'valid_through_season', values: ['2025'] },
    ],
    exclusions: ['Valuation and publication'],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_2_corpus_lineage' as const,
    decisionKey: `gate2:${'4'.repeat(64)}`,
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    proposal: 'Approve the exact promotion-backed factual lineage.',
    alternativesConsidered: ['Keep the candidate private.'],
    accountableOwner: 'fixture-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [evidence('f')],
    affectedArtifacts,
    proposedAt: '2026-08-08T00:03:00.000Z',
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
    gate: proposal.content.gate,
    decisionKey: proposal.content.decisionKey,
    version: 1,
    environment: proposal.content.environment,
    scope,
    state: 'approved' as const,
    authorityKind: 'fixture' as const,
    accountableOwner: 'fixture-owner',
    decidedBy: 'fixture-owner',
    reviewers: [],
    authorityEvidenceIds: [evidence('f')],
    conditionResults: [],
    rationale: 'Fixture lineage is exact.',
    limitations: ['No publication authority.'],
    decidedAt: '2026-08-08T00:04:00.000Z',
    effectiveAt: '2026-08-08T00:04:00.000Z',
    revalidateAt: '2027-08-08T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return { proposal, decision };
}

class MemoryGateSqlClient implements AflOutcomeSqlClient {
  revision = 0;
  rights = new Map<string, unknown>();
  proposals = new Map<string, unknown>();
  decisions = new Map<string, unknown>();
  corruptHeadRevision: number | null = null;
  failDecisionId: string | null = null;

  async query<Row = Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = []
  ): Promise<AflOutcomeSqlQueryResult<Row>> {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized.includes('FROM outcome_gate_ledger_head')) {
      return this.result([{ revision: this.corruptHeadRevision ?? this.revision }]) as never;
    }
    if (normalized.includes('FROM outcome_gate_proposal')) {
      return this.result(
        [...this.proposals.values()].map((proposal_json) => ({ proposal_json }))
      ) as never;
    }
    if (normalized.includes('FROM outcome_gate_decision')) {
      return this.result(
        [...this.decisions.values()].map((decision_json) => ({ decision_json }))
      ) as never;
    }
    if (normalized.includes('FROM outcome_source_rights_proposal')) {
      const content_json = this.rights.get(String(values[0]));
      return this.result(content_json === undefined ? [] : [{ content_json }]) as never;
    }
    if (normalized.startsWith('INSERT INTO outcome_source_rights_proposal')) {
      this.rights.set(String(values[0]), values[6]);
      return this.result([], 1);
    }
    if (normalized.startsWith('INSERT INTO outcome_gate_proposal')) {
      this.proposals.set(String(values[0]), values[7]);
      return this.result([], 1);
    }
    if (normalized.startsWith('INSERT INTO outcome_gate_decision')) {
      if (values[0] === this.failDecisionId) throw new Error('Injected decision insert failure.');
      this.decisions.set(String(values[0]), values[11]);
      return this.result([], 1);
    }
    if (normalized.startsWith('UPDATE outcome_gate_ledger_head')) {
      if (this.revision !== values[2]) return this.result([], 0);
      this.revision = Number(values[0]);
      return this.result([], 1);
    }
    throw new Error(`Unexpected SQL: ${normalized}`);
  }

  async transaction<T>(work: (transaction: AflOutcomeSqlTransaction) => Promise<T>): Promise<T> {
    const snapshot = {
      revision: this.revision,
      rights: new Map(this.rights),
      proposals: new Map(this.proposals),
      decisions: new Map(this.decisions),
    };
    try {
      return await work(this);
    } catch (error) {
      this.revision = snapshot.revision;
      this.rights = snapshot.rights;
      this.proposals = snapshot.proposals;
      this.decisions = snapshot.decisions;
      throw error;
    }
  }

  private result<Row>(rows: Row[], rowCount = rows.length): AflOutcomeSqlQueryResult<Row> {
    return { rows, rowCount };
  }
}

describe('PostgreSQL AFL trade Gate decision ledger', () => {
  it('loads the deterministic empty ledger', async () => {
    const repository = createPostgresAflTradeGateDecisionLedgerRepository(
      new MemoryGateSqlClient()
    );

    await expect(repository.load()).resolves.toEqual({
      revision: 0,
      ledger: { proposals: [], decisions: [] },
    });
  });

  it('atomically persists exact source rights and a valid decision', async () => {
    const client = new MemoryGateSqlClient();
    const repository = createPostgresAflTradeGateDecisionLedgerRepository(client);
    const rights = sourceRights();
    const { proposal, decision } = approval(rights);

    const result = await repository.append({
      expectedRevision: 0,
      sourceRights: rights,
      proposal,
      decision,
    });

    expect(result).toMatchObject({ revision: 1, idempotentReplay: false });
    expect(result.ledger).toEqual({ proposals: [proposal], decisions: [decision] });
    expect(client.rights.get(rights.rightsArtifactId)).toEqual(rights);
    await expect(repository.load()).resolves.toEqual({ revision: 1, ledger: result.ledger });
  });

  it('returns exact replay and rejects stale or conflicting appends', async () => {
    const client = new MemoryGateSqlClient();
    const repository = createPostgresAflTradeGateDecisionLedgerRepository(client);
    const rights = sourceRights();
    const { proposal, decision } = approval(rights);
    await repository.append({ expectedRevision: 0, sourceRights: rights, proposal, decision });

    await expect(
      repository.append({ expectedRevision: 1, sourceRights: rights, proposal, decision })
    ).resolves.toMatchObject({ revision: 1, idempotentReplay: true });

    await expect(
      repository.append({
        expectedRevision: 0,
        sourceRights: rights,
        ...approval(rights, 'footywire-player-stats-secondary-scope'),
      })
    ).rejects.toMatchObject({ code: 'STALE_REVISION' });
  });

  it('appends non-source gates without inventing a source-rights binding', async () => {
    const client = new MemoryGateSqlClient();
    const repository = createPostgresAflTradeGateDecisionLedgerRepository(client);
    const gate2 = gate2Approval();

    const first = await repository.appendDecision({ expectedRevision: 0, ...gate2 });

    expect(first).toMatchObject({ revision: 1, idempotentReplay: false });
    expect(client.rights.size).toBe(0);
    await expect(
      repository.appendDecision({ expectedRevision: 1, ...gate2 })
    ).resolves.toMatchObject({ revision: 1, idempotentReplay: true });
    await expect(
      repository.appendDecision({ expectedRevision: 0, ...gate2Approval() })
    ).resolves.toMatchObject({ revision: 1, idempotentReplay: true });

    const changed = gate2Approval();
    const changedDecision = {
      ...changed.decision,
      content: { ...changed.decision.content, rationale: 'Conflicting rationale.' },
    } as typeof changed.decision;
    await expect(
      repository.appendDecision({
        expectedRevision: 1,
        proposal: changed.proposal,
        decision: changedDecision,
      })
    ).rejects.toMatchObject({ code: 'INVALID_APPEND' });
  });

  it('reserves automated model-validity records for the governed qualification boundary', async () => {
    const repository = createPostgresAflTradeGateDecisionLedgerRepository(
      new MemoryGateSqlClient()
    );
    const base = gate2Approval();
    const qualificationId = `model-qualification:${'6'.repeat(64)}`;
    const qualificationArtifactId = evidence('7');
    const affectedArtifacts = [
      { kind: 'model_run' as const, artifactId: `model-run:${'8'.repeat(64)}` },
      { kind: 'model_qualification' as const, artifactId: qualificationId },
    ];
    const scope = {
      ...base.proposal.content.scope,
      scopeKey: 'afl-men:2026-trades',
      dimensions: [{ name: 'qualification', values: [qualificationId] }],
    };
    const proposalContent = {
      ...base.proposal.content,
      gate: 'gate_3_model_validity' as const,
      decisionKey: 'afl-men:2026-trades:player-model-validity',
      environment: 'non_production' as const,
      scope,
      evidenceIds: [qualificationArtifactId],
      affectedArtifacts,
    };
    const proposal = aflTradeGateDecisionProposalSchema.parse({
      proposalId: createAflTradeContentAddress('gate-proposal', proposalContent),
      content: proposalContent,
    });
    const decisionContent = {
      ...base.decision.content,
      proposalId: proposal.proposalId,
      gate: proposal.content.gate,
      decisionKey: proposal.content.decisionKey,
      environment: proposal.content.environment,
      scope,
      authorityKind: 'automated_validation_record' as const,
      authorityEvidenceIds: [qualificationArtifactId],
      revalidateAt: null,
      affectedArtifacts,
    };
    const decision = aflTradeGateDecisionRecordSchema.parse({
      decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
      content: decisionContent,
    });

    await expect(
      repository.appendDecision({ expectedRevision: 0, proposal, decision })
    ).rejects.toMatchObject({ code: 'INVALID_APPEND' });
  });

  it('applies expected-revision CAS to a new generic gate append', async () => {
    const client = new MemoryGateSqlClient();
    const repository = createPostgresAflTradeGateDecisionLedgerRepository(client);
    const rights = sourceRights();
    const gate0 = approval(rights);
    await repository.append({ expectedRevision: 0, sourceRights: rights, ...gate0 });

    await expect(
      repository.appendDecision({ expectedRevision: 0, ...gate2Approval() })
    ).rejects.toMatchObject({ code: 'STALE_REVISION' });
  });

  it('rolls back every provider record when an atomic batch append fails', async () => {
    const client = new MemoryGateSqlClient();
    const repository = createPostgresAflTradeGateDecisionLedgerRepository(client);
    const rights = sourceRights();
    const first = approval(rights, 'footywire-player-stats-primary-scope');
    const second = approval(rights, 'footywire-player-stats-secondary-scope');
    client.failDecisionId = second.decision.decisionId;

    await expect(
      repository.appendBatch({
        expectedRevision: 0,
        records: [
          { sourceRights: rights, ...first },
          { sourceRights: rights, ...second },
        ],
      })
    ).rejects.toThrow('Injected decision insert failure.');

    expect(client.revision).toBe(0);
    expect(client.rights.size).toBe(0);
    expect(client.proposals.size).toBe(0);
    expect(client.decisions.size).toBe(0);
    await expect(repository.load()).resolves.toEqual({
      revision: 0,
      ledger: { proposals: [], decisions: [] },
    });
  });

  it('fails closed when persisted rows and the revision head disagree', async () => {
    const client = new MemoryGateSqlClient();
    const rights = sourceRights();
    const { proposal, decision } = approval(rights);
    const repository = createPostgresAflTradeGateDecisionLedgerRepository(client);
    await repository.append({ expectedRevision: 0, sourceRights: rights, proposal, decision });
    client.corruptHeadRevision = 2;

    await expect(repository.load()).rejects.toMatchObject({
      code: 'INVALID_STORED_STATE',
    });
  });
});
