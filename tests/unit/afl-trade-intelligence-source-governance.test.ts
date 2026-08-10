import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import type { AflTradeGateDecisionLedger } from '@/server/aflTradeIntelligence/governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateDecisionProposal,
  type AflTradeGateDecisionRecord,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  aflTradeSourceRightsProposalContentSchema,
  aflTradeSourceRightsProposalSchema,
  evaluateAflTradeGate0A,
  type AflTradeGate0ARequest,
  type AflTradeSourceRightsProposal,
} from '@/server/aflTradeIntelligence/source/sourceContracts';
import {
  aflTradeGate0AReceiptSchema,
  createAflTradeGate0AReceipt,
} from '@/server/aflTradeIntelligence/source/gate0aReceipt';

const evidence = {
  terms: `artifact:${'a'.repeat(64)}`,
  authority: `artifact:${'b'.repeat(64)}`,
  review: `artifact:${'c'.repeat(64)}`,
  condition: `artifact:${'d'.repeat(64)}`,
};

function rightsContent() {
  return {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: 'fixture-source-v1',
    provider: 'Fabricated Provider',
    dataset: 'Fabricated historical evidence',
    datasetVersion: 'fixture-v1',
    intendedPurpose: 'Exercise Gate 0A mechanics with fabricated records only.',
    scope: {
      competitions: ['fixture-competition'],
      seasonRanges: [{ from: 2021, to: 2025 }],
      accessMechanism: 'provider_api' as const,
    },
    acquisition: {
      kind: 'provider_direct' as const,
      clientName: 'Fabricated provider test client',
      clientVersion: 'fixture-v1',
    },
    operations: {
      bounded_evaluation_capture: 'allowed' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'blocked' as const,
      derived_feature_creation: 'blocked' as const,
      public_derived_output: 'blocked' as const,
      public_fact_display: 'blocked' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      permitted: true,
      identification: 'Identify the fabricated test client.',
      rateLimit: { requests: 10, perSeconds: 60, burst: 2 },
      cache: { permitted: true, maximumSeconds: 60 },
    },
    retention: {
      rawEvidence: {
        disposition: 'transient' as const,
        maximumDays: 7,
        deleteOnWithdrawal: true,
        basis: 'Fabricated raw evidence may exist for seven test days.',
      },
      hashesAndMetadata: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: false,
        basis: 'Fabricated hashes support deterministic test auditing.',
      },
      derivedArtifacts: {
        disposition: 'prohibited' as const,
        maximumDays: null,
        deleteOnWithdrawal: true,
        basis: 'Derived artifacts are outside this fabricated scope.',
      },
    },
    redistribution: {
      rawFieldsPermitted: false,
      publicDerivedOutputPermitted: false,
    },
    attribution: {
      required: true,
      text: 'Fabricated Provider test attribution.',
      placement: 'Display only in fabricated test output.',
    },
    restrictions: { geographic: [], commercial: [], audience: [] },
    fields: [
      {
        sourceField: 'player_name',
        normalizedField: 'player.displayName',
        uses: {
          archive_fact: 'allowed' as const,
          model_training: 'blocked' as const,
          derived_feature: 'blocked' as const,
          public_display: 'blocked' as const,
        },
        attributionRequired: true,
        notes: null,
      },
      {
        sourceField: 'internal_note',
        normalizedField: 'evidence.internalNote',
        uses: {
          archive_fact: 'blocked' as const,
          model_training: 'blocked' as const,
          derived_feature: 'blocked' as const,
          public_display: 'blocked' as const,
        },
        attributionRequired: false,
        notes: 'Explicitly blocked from every use.',
      },
    ],
    conditions: [
      {
        conditionId: 'fixture-only',
        description: 'Use fabricated evidence only.',
        appliesToOperations: ['bounded_evaluation_capture' as const],
        verificationEvidenceIds: [evidence.condition],
      },
    ],
    rightsEvidenceIds: [evidence.terms],
    termsEffectiveAt: '2026-01-01T00:00:00.000Z',
    termsExpireAt: '2026-12-31T00:00:00.000Z',
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions: 'Delete fabricated transient raw evidence.',
      retainableAuditMaterial: 'Retain only permitted fabricated hashes.',
    },
    proposedAt: '2026-08-01T00:00:00.000Z',
    proposedBy: 'fixture-proposer',
    proposalOrigin: 'agent_assisted' as const,
  };
}

function rights(
  content: AflTradeSourceRightsProposal['content'] = rightsContent()
): AflTradeSourceRightsProposal {
  return aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', content),
    content,
  });
}

function gateProposal(
  sourceRights: AflTradeSourceRightsProposal,
  version = 1
): AflTradeGateDecisionProposal {
  const seasons = sourceRights.content.scope.seasonRanges.flatMap(({ from, to }) =>
    Array.from({ length: to - from + 1 }, (_, index) => String(from + index))
  );
  const fitzRoyCapabilityDimension =
    sourceRights.content.acquisition.kind === 'fitzroy'
      ? [
          {
            name: 'fitzroy_capability',
            values: sourceRights.content.acquisition.capabilities.map(
              ({ capabilityId }) => capabilityId
            ),
          },
        ]
      : [];
  const content = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey: 'fixture-gate-0a',
    version,
    environment: 'test_fixture' as const,
    scope: {
      scopeKey: 'fixture-gate-0a',
      description: 'Bounded fabricated evaluation scope.',
      dimensions: [
        { name: 'source_rights_artifact', values: [sourceRights.rightsArtifactId] },
        { name: 'competition', values: sourceRights.content.scope.competitions },
        { name: 'season', values: seasons },
        { name: 'access_mechanism', values: [sourceRights.content.scope.accessMechanism] },
        ...fitzRoyCapabilityDimension,
        { name: 'geography', values: ['fixture-region'] },
        { name: 'commercial_context', values: ['fixture-non-commercial'] },
        { name: 'audience', values: ['fixture-reviewers'] },
        {
          name: 'operation',
          values: [
            'bounded_evaluation_capture',
            'raw_evidence_retention',
            'metadata_hash_retention',
            'internal_quality_evaluation',
          ],
        },
      ],
      exclusions: ['Production evidence, model training, and public output'],
    },
    proposal: 'Permit the bounded fabricated Gate 0A test evaluation.',
    alternativesConsidered: ['Keep the fabricated evaluation blocked.'],
    accountableOwner: 'fixture-data-owner',
    reviewRequirement: 'independent_review_required' as const,
    requiredReviewerRoles: ['fixture-legal-review'],
    conditions: [
      {
        conditionId: 'fixture-only',
        description: 'Use fabricated evidence only.',
        required: true,
        verificationEvidenceIds: [evidence.condition],
      },
    ],
    evidenceIds: [evidence.terms],
    affectedArtifacts: [
      { kind: 'source_rights' as const, artifactId: sourceRights.rightsArtifactId },
    ],
    proposedAt: `2026-08-0${version}T00:00:00.000Z`,
    proposedBy: 'fixture-proposer',
    proposalOrigin: 'agent_assisted' as const,
  };
  return aflTradeGateDecisionProposalSchema.parse({
    proposalId: createAflTradeContentAddress('gate-proposal', content),
    content,
  });
}

function gateDecision(
  proposal: AflTradeGateDecisionProposal,
  options: {
    state?: 'approved' | 'withdrawn';
    rightsArtifactIds?: string[];
    conditionStatus?: 'satisfied' | 'unsatisfied';
    revalidateAt?: string;
    supersedesDecisionId?: string | null;
  } = {}
): AflTradeGateDecisionRecord {
  const state = options.state ?? 'approved';
  const content = {
    schemaVersion: 'afl-trade-gate-decision/v1' as const,
    proposalId: proposal.proposalId,
    gate: proposal.content.gate,
    decisionKey: proposal.content.decisionKey,
    version: proposal.content.version,
    environment: proposal.content.environment,
    scope: proposal.content.scope,
    state,
    authorityKind: 'fixture' as const,
    accountableOwner: proposal.content.accountableOwner,
    decidedBy: 'fixture-data-owner',
    reviewers: [
      {
        reviewerId: 'fixture-independent-reviewer',
        role: 'fixture-legal-review',
        evidenceId: evidence.review,
      },
    ],
    authorityEvidenceIds: [evidence.authority],
    conditionResults: [
      {
        conditionId: 'fixture-only',
        status: options.conditionStatus ?? ('satisfied' as const),
        evidenceIds: [evidence.condition],
        explanation: 'The fabricated-only condition was reviewed.',
      },
    ],
    rationale: `The fabricated ${state} record exercises Gate 0A mechanics only.`,
    limitations: ['No production authority or evidence.'],
    decidedAt: `2026-08-0${proposal.content.version}T01:00:00.000Z`,
    effectiveAt: `2026-08-0${proposal.content.version}T02:00:00.000Z`,
    revalidateAt: options.revalidateAt ?? '2026-12-01T00:00:00.000Z',
    supersedesDecisionId: options.supersedesDecisionId ?? null,
    affectedArtifacts:
      options.rightsArtifactIds === undefined
        ? proposal.content.affectedArtifacts
        : options.rightsArtifactIds.map((artifactId) => ({
            kind: 'source_rights' as const,
            artifactId,
          })),
    withdrawalActions: state === 'withdrawn' ? ['Stop the fabricated evaluation.'] : [],
  };
  return aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', content),
    content,
  });
}

function fixtures() {
  const sourceRights = rights();
  const proposal = gateProposal(sourceRights);
  const decision = gateDecision(proposal);
  const ledger: AflTradeGateDecisionLedger = { proposals: [proposal], decisions: [decision] };
  return { sourceRights, proposal, decision, ledger };
}

function request(sourceRights: AflTradeSourceRightsProposal): AflTradeGate0ARequest {
  const seasonRange = sourceRights.content.scope.seasonRanges.at(-1);
  if (seasonRange === undefined) throw new Error('Fixture source rights require a season range.');
  return {
    decisionKey: 'fixture-gate-0a',
    environment: 'test_fixture',
    rightsArtifactId: sourceRights.rightsArtifactId,
    evaluatedAt: '2026-08-03T00:00:00.000Z',
    competition: sourceRights.content.scope.competitions[0],
    season: seasonRange.to,
    accessMechanism: sourceRights.content.scope.accessMechanism,
    capabilityId:
      sourceRights.content.acquisition.kind === 'fitzroy'
        ? sourceRights.content.acquisition.capabilities[0].capabilityId
        : null,
    geography: 'fixture-region',
    commercialContext: 'fixture-non-commercial',
    audience: 'fixture-reviewers',
    operations: ['bounded_evaluation_capture', 'raw_evidence_retention', 'metadata_hash_retention'],
    fieldUses: [{ sourceField: 'player_name', use: 'archive_fact' }],
    rawRetentionDays: 7,
    metadataRetentionDays: 365,
    cacheSeconds: 30,
  };
}

describe('AFL trade-intelligence Gate 0A source governance', () => {
  it('accepts only a current, exact, mechanically eligible fabricated scope', () => {
    const fixture = fixtures();
    const result = evaluateAflTradeGate0A(
      fixture.ledger,
      fixture.sourceRights,
      request(fixture.sourceRights)
    );

    expect(result).toEqual({
      status: 'mechanically_eligible',
      decisionId: fixture.decision.decisionId,
      rightsArtifactId: fixture.sourceRights.rightsArtifactId,
      blockers: [],
    });
  });

  it('records the exact mechanically eligible evaluation in a content-addressed receipt', () => {
    const fixture = fixtures();
    const evaluatedRequest = request(fixture.sourceRights);
    const receipt = createAflTradeGate0AReceipt(
      fixture.ledger,
      fixture.sourceRights,
      evaluatedRequest,
      '2026-08-03T00:00:01.000Z'
    );

    expect(receipt.content.request).toEqual(evaluatedRequest);
    expect(receipt.content.result).toMatchObject({
      status: 'mechanically_eligible',
      decisionId: fixture.decision.decisionId,
      rightsArtifactId: fixture.sourceRights.rightsArtifactId,
      blockers: [],
    });
  });

  it('rejects a Gate 0A receipt altered after evaluation', () => {
    const fixture = fixtures();
    const receipt = createAflTradeGate0AReceipt(
      fixture.ledger,
      fixture.sourceRights,
      request(fixture.sourceRights),
      '2026-08-03T00:00:01.000Z'
    );

    expect(
      aflTradeGate0AReceiptSchema.safeParse({
        ...receipt,
        content: {
          ...receipt.content,
          request: { ...receipt.content.request, season: 2024 },
        },
      }).success
    ).toBe(false);
  });

  it('records wrong-environment evaluation attempts as blocked receipts', () => {
    const fixture = fixtures();
    const receipt = createAflTradeGate0AReceipt(
      fixture.ledger,
      fixture.sourceRights,
      { ...request(fixture.sourceRights), environment: 'non_production' },
      '2026-08-03T00:00:01.000Z'
    );

    expect(receipt.content.result.status).toBe('blocked');
    expect(receipt.content.result.blockers).toContainEqual(
      expect.objectContaining({ code: 'gate_decision_blocked', subject: 'environment_mismatch' })
    );
  });

  it('rejects tampered rights content', () => {
    const fixture = fixtures();
    const tampered = {
      ...fixture.sourceRights,
      content: { ...fixture.sourceRights.content, datasetVersion: 'changed-after-hash' },
    };

    expect(
      evaluateAflTradeGate0A(fixture.ledger, tampered, request(fixture.sourceRights)).blockers
    ).toContainEqual(expect.objectContaining({ code: 'invalid_rights_artifact' }));
  });

  it('rejects automated access without permission, identification, and rate limits', () => {
    const content = rightsContent();
    const invalid = {
      ...content,
      automatedAccess: {
        ...content.automatedAccess,
        permitted: false,
        identification: null,
        rateLimit: null,
      },
    };

    expect(
      aflTradeSourceRightsProposalSchema.safeParse({
        rightsArtifactId: createAflTradeContentAddress('source-rights', invalid),
        content: invalid,
      }).success
    ).toBe(false);
  });

  it('represents bounded provider web capture without mislabelling it as an API', () => {
    const content = rightsContent();
    const providerWeb = {
      ...content,
      scope: { ...content.scope, accessMechanism: 'automated_web' as const },
      acquisition: {
        kind: 'provider_web' as const,
        clientName: 'Statly bounded external-source capture',
        clientVersion: 'external-source-capture/v1',
        capabilityId: 'draftguru-trade-detail',
      },
    };

    expect(aflTradeSourceRightsProposalContentSchema.parse(providerWeb).acquisition).toEqual(
      providerWeb.acquisition
    );
    expect(() =>
      aflTradeSourceRightsProposalContentSchema.parse({
        ...providerWeb,
        scope: { ...providerWeb.scope, accessMechanism: 'provider_api' },
      })
    ).toThrow(/automated-web access mechanism/);
  });

  it('pins fitzRoy rights to the reviewed capability version, provider, and direct function', () => {
    const content = {
      ...rightsContent(),
      provider: 'footywire',
      scope: {
        competitions: ['AFLM'],
        seasonRanges: [{ from: 2010, to: 2025 }],
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
    };

    const parsedContent = aflTradeSourceRightsProposalContentSchema.parse(content);
    const sourceRights = rights(parsedContent);
    const proposal = gateProposal(sourceRights);
    const decision = gateDecision(proposal);
    const ledger = { proposals: [proposal], decisions: [decision] };

    expect(evaluateAflTradeGate0A(ledger, sourceRights, request(sourceRights)).status).toBe(
      'mechanically_eligible'
    );
    expect(
      evaluateAflTradeGate0A(ledger, sourceRights, {
        ...request(sourceRights),
        capabilityId: 'official-afl-player-stats',
      }).blockers
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'decision_scope_mismatch' }),
        expect.objectContaining({ code: 'capability_not_permitted' }),
      ])
    );
    expect(
      aflTradeSourceRightsProposalContentSchema.safeParse({
        ...content,
        acquisition: {
          ...content.acquisition,
          capabilities: [
            {
              ...content.acquisition.capabilities[0],
              directFunction: 'fetch_player_stats',
            },
          ],
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeSourceRightsProposalContentSchema.safeParse({
        ...content,
        acquisition: {
          ...content.acquisition,
          capabilities: [
            ...content.acquisition.capabilities,
            {
              capabilityId: 'afl-tables-player-stats',
              provider: 'afl_tables' as const,
              directFunction: 'fetch_player_stats_afltables',
            },
          ],
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeSourceRightsProposalContentSchema.safeParse({
        ...content,
        provider: 'afl_tables',
      }).success
    ).toBe(false);
    expect(
      aflTradeSourceRightsProposalContentSchema.safeParse({
        ...content,
        scope: { ...content.scope, accessMechanism: 'provider_export' as const },
      }).success
    ).toBe(false);
  });

  it('requires bounded transient retention and exact public permissions', () => {
    const content = rightsContent();
    const invalidRetention = {
      ...content,
      retention: {
        ...content.retention,
        rawEvidence: { ...content.retention.rawEvidence, maximumDays: null },
      },
    };
    expect(
      aflTradeSourceRightsProposalSchema.safeParse({
        rightsArtifactId: createAflTradeContentAddress('source-rights', invalidRetention),
        content: invalidRetention,
      }).success
    ).toBe(false);

    const invalidPublicOutput = {
      ...content,
      operations: { ...content.operations, public_derived_output: 'allowed' as const },
    };
    expect(
      aflTradeSourceRightsProposalSchema.safeParse({
        rightsArtifactId: createAflTradeContentAddress('source-rights', invalidPublicOutput),
        content: invalidPublicOutput,
      }).success
    ).toBe(false);
  });

  it('preserves ordered source-rights issues when independent rules fail together', () => {
    const content = rightsContent();
    const invalid = {
      ...content,
      scope: {
        ...content.scope,
        seasonRanges: [{ from: 2025, to: 2024 }],
      },
      operations: {
        ...content.operations,
        raw_field_redistribution: 'allowed' as const,
        public_derived_output: 'allowed' as const,
      },
      automatedAccess: {
        permitted: false,
        identification: null,
        rateLimit: null,
        cache: { permitted: true, maximumSeconds: null },
      },
      retention: {
        ...content.retention,
        rawEvidence: {
          ...content.retention.rawEvidence,
          disposition: 'prohibited' as const,
          maximumDays: null,
        },
        hashesAndMetadata: {
          ...content.retention.hashesAndMetadata,
          disposition: 'prohibited' as const,
        },
      },
      attribution: { required: true, text: null, placement: null },
      fields: [content.fields[0], { ...content.fields[0] }],
      conditions: [content.conditions[0], { ...content.conditions[0] }],
      termsExpireAt: content.termsEffectiveAt,
    };
    const result = aflTradeSourceRightsProposalContentSchema.safeParse(invalid);

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected the composite source-rights fixture to fail.');
    expect(result.error.issues.map(({ code, path, message }) => ({ code, path, message }))).toEqual(
      [
        { code: 'custom', path: ['fields'], message: 'Source fields must be unique.' },
        {
          code: 'custom',
          path: ['fields'],
          message: 'Normalized field mappings must be unique.',
        },
        {
          code: 'custom',
          path: ['conditions'],
          message: 'Source-rights conditions must be unique.',
        },
        {
          code: 'custom',
          path: ['scope', 'seasonRanges', 0],
          message: 'A season range cannot end before it starts.',
        },
        {
          code: 'custom',
          path: ['automatedAccess'],
          message: 'Automated access requires permission, identification, and a rate limit.',
        },
        {
          code: 'custom',
          path: ['automatedAccess', 'cache', 'maximumSeconds'],
          message: 'Permitted caching requires a maximum duration.',
        },
        {
          code: 'custom',
          path: ['attribution'],
          message: 'Required attribution needs exact text and placement.',
        },
        {
          code: 'custom',
          path: ['retention', 'rawEvidence'],
          message: 'Raw retention cannot be allowed when raw evidence retention is prohibited.',
        },
        {
          code: 'custom',
          path: ['retention', 'hashesAndMetadata'],
          message: 'Metadata retention cannot be allowed when hashes and metadata are prohibited.',
        },
        {
          code: 'custom',
          path: ['redistribution', 'rawFieldsPermitted'],
          message: 'Raw redistribution requires explicit permission.',
        },
        {
          code: 'custom',
          path: ['redistribution', 'publicDerivedOutputPermitted'],
          message: 'Public derived output requires explicit permission.',
        },
        {
          code: 'custom',
          path: ['termsExpireAt'],
          message: 'Source terms must expire after they become effective.',
        },
      ]
    );
  });

  it('denies unregistered fields and blocked field uses by default', () => {
    const fixture = fixtures();
    const base = request(fixture.sourceRights);
    const result = evaluateAflTradeGate0A(fixture.ledger, fixture.sourceRights, {
      ...base,
      fieldUses: [
        { sourceField: 'unregistered_field', use: 'archive_fact' },
        { sourceField: 'player_name', use: 'model_training' },
      ],
    });

    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'field_not_registered' }),
        expect.objectContaining({ code: 'field_use_not_permitted' }),
      ])
    );
  });

  it('denies operations outside both rights and decision scope', () => {
    const fixture = fixtures();
    const result = evaluateAflTradeGate0A(fixture.ledger, fixture.sourceRights, {
      ...request(fixture.sourceRights),
      operations: ['model_training'],
    });

    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'decision_scope_mismatch' }),
        expect.objectContaining({ code: 'operation_not_permitted' }),
      ])
    );
  });

  it('requires the decision to pin the exact rights artifact', () => {
    const sourceRights = rights();
    const proposal = gateProposal(sourceRights);
    const decision = gateDecision(proposal, { rightsArtifactIds: [] });
    const ledger = { proposals: [proposal], decisions: [decision] };

    expect(
      evaluateAflTradeGate0A(ledger, sourceRights, request(sourceRights)).blockers
    ).toContainEqual(expect.objectContaining({ code: 'decision_rights_mismatch' }));
  });

  it('requires competition, season, access, and contextual decision scope', () => {
    const fixture = fixtures();
    const result = evaluateAflTradeGate0A(fixture.ledger, fixture.sourceRights, {
      ...request(fixture.sourceRights),
      competition: 'outside-competition',
      season: 2026,
      accessMechanism: 'manual_review',
      geography: 'outside-region',
    });

    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'competition_not_permitted' }),
        expect.objectContaining({ code: 'season_not_permitted' }),
        expect.objectContaining({ code: 'access_not_permitted' }),
        expect.objectContaining({ code: 'decision_scope_mismatch' }),
      ])
    );
  });

  it('preserves Gate 0A blocker precedence across independent policy phases', () => {
    const fixture = fixtures();
    const result = evaluateAflTradeGate0A(fixture.ledger, fixture.sourceRights, {
      ...request(fixture.sourceRights),
      competition: 'outside-competition',
      season: 2026,
      accessMechanism: 'manual_review',
      geography: 'outside-region',
      operations: ['model_training'],
      fieldUses: [{ sourceField: 'unregistered_field', use: 'model_training' }],
      rawRetentionDays: 8,
      cacheSeconds: 61,
    });

    expect(result).toEqual({
      status: 'blocked',
      decisionId: fixture.decision.decisionId,
      rightsArtifactId: fixture.sourceRights.rightsArtifactId,
      blockers: [
        {
          code: 'decision_scope_mismatch',
          subject: 'competition:outside-competition',
          message: 'The Gate 0A decision does not include outside-competition in competition.',
        },
        {
          code: 'decision_scope_mismatch',
          subject: 'season:2026',
          message: 'The Gate 0A decision does not include 2026 in season.',
        },
        {
          code: 'decision_scope_mismatch',
          subject: 'access_mechanism:manual_review',
          message: 'The Gate 0A decision does not include manual_review in access_mechanism.',
        },
        {
          code: 'decision_scope_mismatch',
          subject: 'geography:outside-region',
          message: 'The Gate 0A decision does not include outside-region in geography.',
        },
        {
          code: 'decision_scope_mismatch',
          subject: 'model_training',
          message: 'The Gate 0A decision scope does not include model_training.',
        },
        {
          code: 'competition_not_permitted',
          subject: 'outside-competition',
          message: 'Competition outside-competition is outside the source-rights scope.',
        },
        {
          code: 'season_not_permitted',
          subject: '2026',
          message: 'Season 2026 is outside the source-rights scope.',
        },
        {
          code: 'access_not_permitted',
          subject: 'manual_review',
          message: 'Access mechanism manual_review is not permitted by this rights artifact.',
        },
        {
          code: 'operation_not_permitted',
          subject: 'model_training',
          message: 'Operation model_training is not explicitly allowed.',
        },
        {
          code: 'field_not_registered',
          subject: 'unregistered_field',
          message: 'Field unregistered_field is not registered and is denied by default.',
        },
        {
          code: 'retention_not_permitted',
          subject: 'rawEvidence',
          message: 'Requested raw-evidence retention exceeds the permitted scope.',
        },
        {
          code: 'cache_not_permitted',
          subject: '61',
          message: 'Requested caching exceeds the permitted scope.',
        },
      ],
    });
  });

  it('blocks expired terms and expired gate decisions independently', () => {
    const fixture = fixtures();
    const expiredTerms = evaluateAflTradeGate0A(fixture.ledger, fixture.sourceRights, {
      ...request(fixture.sourceRights),
      evaluatedAt: '2027-01-01T00:00:00.000Z',
    });
    expect(expiredTerms.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'terms_not_current' }),
        expect.objectContaining({ code: 'gate_decision_blocked' }),
      ])
    );
  });

  it('rejects non-ISO and offset-less evaluation times deterministically', () => {
    const fixture = fixtures();
    for (const evaluatedAt of ['Aug 3 2026', '2026-08-03T00:00:00']) {
      expect(
        evaluateAflTradeGate0A(fixture.ledger, fixture.sourceRights, {
          ...request(fixture.sourceRights),
          evaluatedAt,
        }).blockers
      ).toContainEqual(expect.objectContaining({ code: 'invalid_evaluation_time' }));
    }
  });

  it('blocks retention and caching beyond the reviewed scope', () => {
    const fixture = fixtures();
    const result = evaluateAflTradeGate0A(fixture.ledger, fixture.sourceRights, {
      ...request(fixture.sourceRights),
      rawRetentionDays: 8,
      cacheSeconds: 61,
    });

    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'retention_not_permitted' }),
        expect.objectContaining({ code: 'cache_not_permitted' }),
      ])
    );
  });

  it('enforces non-empty geographic, commercial, and audience restrictions', () => {
    const content = rightsContent();
    const sourceRights = rights({
      ...content,
      restrictions: {
        geographic: ['different-region'] as string[],
        commercial: ['different-context'] as string[],
        audience: ['different-audience'] as string[],
      },
    });
    const proposal = gateProposal(sourceRights);
    const decision = gateDecision(proposal);
    const result = evaluateAflTradeGate0A(
      { proposals: [proposal], decisions: [decision] },
      sourceRights,
      request(sourceRights)
    );

    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'geography_not_permitted' }),
        expect.objectContaining({ code: 'commercial_context_not_permitted' }),
        expect.objectContaining({ code: 'audience_not_permitted' }),
      ])
    );
  });

  it('blocks an unsatisfied required condition at the ledger boundary', () => {
    const sourceRights = rights();
    const proposal = gateProposal(sourceRights);
    const decision = gateDecision(proposal, { conditionStatus: 'unsatisfied' });
    const ledger = { proposals: [proposal], decisions: [decision] };
    const result = evaluateAflTradeGate0A(ledger, sourceRights, request(sourceRights));

    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: 'gate_decision_blocked', subject: 'invalid_ledger' })
    );
  });

  it('blocks a source-rights condition omitted from an otherwise valid decision', () => {
    const content = rightsContent();
    const sourceRights = rights({
      ...content,
      conditions: [
        ...content.conditions,
        {
          conditionId: 'additional-rights-condition',
          description: 'A second fabricated source restriction.',
          appliesToOperations: ['bounded_evaluation_capture'],
          verificationEvidenceIds: [evidence.condition],
        },
      ],
    });
    const proposal = gateProposal(sourceRights);
    const decision = gateDecision(proposal);
    const ledger = { proposals: [proposal], decisions: [decision] };

    expect(
      evaluateAflTradeGate0A(ledger, sourceRights, request(sourceRights)).blockers
    ).toContainEqual(
      expect.objectContaining({
        code: 'source_condition_unsatisfied',
        subject: 'additional-rights-condition',
      })
    );
  });

  it('never promotes fixture authority into production eligibility', () => {
    const fixture = fixtures();
    const result = evaluateAflTradeGate0A(fixture.ledger, fixture.sourceRights, {
      ...request(fixture.sourceRights),
      environment: 'production',
    });

    expect(result.status).toBe('blocked');
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: 'gate_decision_blocked' })
    );
  });

  it('blocks a later withdrawal without mutating the earlier approval', () => {
    const fixture = fixtures();
    const withdrawalProposal = gateProposal(fixture.sourceRights, 2);
    const withdrawal = gateDecision(withdrawalProposal, {
      state: 'withdrawn',
      supersedesDecisionId: fixture.decision.decisionId,
    });
    const ledger = {
      proposals: [fixture.proposal, withdrawalProposal],
      decisions: [fixture.decision, withdrawal],
    };
    const result = evaluateAflTradeGate0A(
      ledger,
      fixture.sourceRights,
      request(fixture.sourceRights)
    );

    expect(result.status).toBe('blocked');
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: 'gate_decision_blocked' })
    );
    expect(fixture.decision.content.state).toBe('approved');
  });
});
