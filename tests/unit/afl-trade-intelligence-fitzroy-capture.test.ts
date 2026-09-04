import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeArtifactCustodyProfile } from '@/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createLocalAflTradeNonProductionArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import {
  AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
  aflTradeFitzRoyInvocationSchema,
  createAflTradeFitzRoyInvocation,
  getAflTradeFitzRoyObservedScopeError,
  type AflTradeFitzRoyCaptureDiagnostics,
} from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';
import {
  AflTradeFitzRoyCaptureError,
  captureAuthorizedAflTradeFitzRoyEvidence,
  type AflTradeFitzRoyProcessExecutor,
} from '@/server/aflTradeIntelligence/source/fitzRoyCaptureRuntime';
import type { AflTradeFitzRoyCaptureAdmission } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureAdmission';
import { AFL_TRADE_FITZROY_CAPABILITIES } from '@/server/aflTradeIntelligence/source/fitzRoyProviderCapabilities';
import { createApprovedAflTradeFitzRoyGateRecords } from '@/server/aflTradeIntelligence/source/approvedFitzRoyGateRecords';
import { createApprovedAflTradeFitzRoySourcePolicies } from '@/server/aflTradeIntelligence/source/approvedFitzRoySourcePolicies';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';
import { createAflTradeFitzRoyDecodeContext } from '@/server/aflTradeIntelligence/source/fitzRoyObservationDecodeRuntime';
import {
  AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION,
  createAflTradeFitzRoyEgressExecutionReceipt,
} from '@/server/aflTradeIntelligence/source/fitzRoyEgressExecutionReceipt';

const sha = (character: string) => character.repeat(64);
const evidenceId = `artifact:${sha('a')}`;
const runtimeIdentity = {
  rVersion: '4.5.1' as const,
  dependencyLockSha256: sha('b'),
  imageDigest: `sha256:${sha('c')}` as const,
};

function captureRequest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
    capabilityId: 'official-afl-player-stats',
    competition: 'AFLM',
    authorizationSeason: 2026,
    parameters: { season: 2026, roundNumber: 1 },
    ...overrides,
  };
}

function governanceFixture() {
  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: 'official-afl-player-stats-fixture',
    provider: 'official_afl',
    dataset: 'Player match statistics fixture',
    datasetVersion: 'fixture-v1',
    intendedPurpose: 'Exercise an authorized fitzRoy capture without external access.',
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from: 2026, to: 2026 }],
      accessMechanism: 'provider_api' as const,
    },
    acquisition: {
      kind: 'fitzroy' as const,
      capabilitySchemaVersion: 'afl-trade-fitzroy-capabilities/v1' as const,
      fitzRoyVersion: '1.7.0' as const,
      capabilities: [
        {
          capabilityId: 'official-afl-player-stats',
          provider: 'official_afl' as const,
          directFunction: 'fetch_player_stats_afl',
        },
      ],
    },
    operations: {
      bounded_evaluation_capture: 'allowed' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'blocked' as const,
      derived_feature_creation: 'blocked' as const,
      public_derived_output: 'blocked' as const,
      public_fact_display: 'allowed' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      permitted: true,
      identification: 'Statly fixture capture',
      rateLimit: { requests: 1, perSeconds: 60, burst: 1 },
      cache: { permitted: false, maximumSeconds: null },
    },
    retention: {
      rawEvidence: {
        disposition: 'transient' as const,
        maximumDays: 7,
        deleteOnWithdrawal: true,
        basis: 'Fixture evidence is short-lived.',
      },
      hashesAndMetadata: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: false,
        basis: 'Hashes retain test auditability.',
      },
      derivedArtifacts: {
        disposition: 'prohibited' as const,
        maximumDays: null,
        deleteOnWithdrawal: true,
        basis: 'This fixture does not authorize derived work.',
      },
    },
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: false },
    attribution: { required: false, text: null, placement: null },
    restrictions: {
      geographic: ['Australia'],
      commercial: ['test-only'],
      audience: ['internal-review'],
    },
    fields: ['games', 'goals'].map((sourceField) => ({
      sourceField,
      normalizedField: `player_${sourceField}`,
      uses: {
        archive_fact: 'allowed' as const,
        model_training: 'blocked' as const,
        derived_feature: 'blocked' as const,
        public_display: 'allowed' as const,
      },
      attributionRequired: false,
      notes: null,
    })),
    conditions: [],
    rightsEvidenceIds: [evidenceId],
    termsEffectiveAt: '2026-08-01T00:00:00.000Z',
    termsExpireAt: '2026-12-31T00:00:00.000Z',
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions: 'Delete fixture RDS bytes.',
      retainableAuditMaterial: 'Retain fixture hashes.',
    },
    proposedAt: '2026-08-05T00:00:00.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const sourceRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const operations = [
    'bounded_evaluation_capture',
    'raw_evidence_retention',
    'metadata_hash_retention',
    'public_fact_display',
  ] as const;
  const scope = {
    scopeKey: 'official-afl-player-stats-fixture',
    description: 'Fixture-only direct fitzRoy capture.',
    dimensions: [
      { name: 'source_rights_artifact', values: [sourceRights.rightsArtifactId] },
      { name: 'competition', values: ['AFLM'] },
      { name: 'season', values: ['2026'] },
      { name: 'access_mechanism', values: ['provider_api'] },
      { name: 'fitzroy_capability', values: ['official-afl-player-stats'] },
      { name: 'geography', values: ['Australia'] },
      { name: 'commercial_context', values: ['test-only'] },
      { name: 'audience', values: ['internal-review'] },
      { name: 'operation', values: [...operations] },
    ],
    exclusions: ['External source access and production authority'],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey: 'official-afl-player-stats-fixture',
    version: 1,
    environment: 'test_fixture' as const,
    scope,
    proposal: 'Permit one fixture-only capture.',
    alternativesConsidered: ['Keep fixture capture blocked.'],
    accountableOwner: 'fixture-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [evidenceId],
    affectedArtifacts: [
      { kind: 'source_rights' as const, artifactId: sourceRights.rightsArtifactId },
    ],
    proposedAt: '2026-08-05T00:05:00.000Z',
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
    environment: 'test_fixture' as const,
    scope,
    state: 'approved' as const,
    authorityKind: 'fixture' as const,
    accountableOwner: 'fixture-owner',
    decidedBy: 'fixture-owner',
    reviewers: [],
    authorityEvidenceIds: [evidenceId],
    conditionResults: [],
    rationale: 'Fixture-only capture authorization.',
    limitations: ['No external data authority.'],
    decidedAt: '2026-08-05T00:10:00.000Z',
    effectiveAt: '2026-08-05T00:10:00.000Z',
    revalidateAt: '2026-12-01T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: proposal.content.affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  return {
    sourceRights,
    ledger: { proposals: [proposal], decisions: [decision] },
    gateRequest: {
      decisionKey: proposal.content.decisionKey,
      environment: 'test_fixture' as const,
      rightsArtifactId: sourceRights.rightsArtifactId,
      competition: 'AFLM',
      season: 2026,
      accessMechanism: 'provider_api' as const,
      capabilityId: 'official-afl-player-stats',
      geography: 'Australia',
      commercialContext: 'test-only',
      audience: 'internal-review',
      operations,
      fieldUses: [
        { sourceField: 'games', use: 'public_display' as const },
        { sourceField: 'goals', use: 'public_display' as const },
      ],
      rawRetentionDays: 7,
      metadataRetentionDays: null,
      cacheSeconds: null,
    },
  };
}

function diagnostics(
  invocation: ReturnType<typeof createAflTradeFitzRoyInvocation>
): AflTradeFitzRoyCaptureDiagnostics {
  return {
    schemaVersion: 'afl-trade-fitzroy-diagnostics/v1',
    capabilityId: invocation.capabilityId,
    fitzRoyVersion: '1.7.0',
    directFunction: invocation.directFunction,
    invocationSha256: sha256AflTradeCanonicalJson(invocation),
    runtime: { ...runtimeIdentity, platform: 'x86_64-pc-linux-gnu' },
    rowCount: 2,
    duplicateRowCount: 0,
    fields: ['games', 'goals'].map((name) => ({
      name,
      classes: ['numeric'],
      storageType: 'double',
      missingCount: 0,
      nanCount: 0,
      positiveInfinityCount: 0,
      negativeInfinityCount: 0,
      levels: null,
      timezone: null,
    })),
    observedSeasonValues: ['2026'],
    observedRoundValues: ['1'],
    observedDateRange: ['2026-03-19', '2026-03-20'],
    originObservation: 'not_exposed_by_fitzroy',
    conditions: [],
  };
}

function dependencies(executor: AflTradeFitzRoyProcessExecutor) {
  const times = [
    '2026-08-05T01:00:00.000Z',
    '2026-08-05T01:00:01.000Z',
    '2026-08-05T01:00:02.000Z',
    '2026-08-05T01:00:03.000Z',
    '2026-08-05T01:00:04.000Z',
  ];
  return {
    rawArtifactRepository: createAflTradeFixtureArtifactRepository({
      artifactClass: 'raw_source',
    }),
    metadataArtifactRepository: createAflTradeFixtureArtifactRepository({
      artifactClass: 'capture_metadata',
    }),
    executor,
    clock: { now: () => times.shift() ?? '2026-08-05T01:00:04.000Z' },
    runtimeIdentity,
    timeoutMs: 30_000,
    maximumSourceBytes: 1024,
    maximumDiagnosticsBytes: 16_384,
  };
}

function productionGovernanceFixture() {
  const field = (sourceField: string) => ({
    sourceField,
    normalizedField: `player_${sourceField}`,
    uses: {
      archive_fact: 'allowed' as const,
      model_training: 'allowed' as const,
      derived_feature: 'allowed' as const,
      public_display: 'allowed' as const,
    },
    attributionRequired: true,
    notes: null,
  });
  const rateLimitEvidenceId = `artifact:${sha('d')}`;
  const sourceRights = createApprovedAflTradeFitzRoySourcePolicies({
    fieldSets: {
      'afl-tables-player-stats': ['games', 'goals'].map(field),
      'footywire-player-stats': ['games', 'goals'].map(field),
      'fryzigg-player-stats': ['games', 'goals'].map(field),
    },
    conditionEvidence: {
      'afl-tables-player-stats': {
        'full-season-custody': `artifact:${sha('2')}`,
        'zero-provenance-review': `artifact:${sha('3')}`,
      },
      'footywire-player-stats': {
        'full-season-custody': `artifact:${sha('4')}`,
        'html-schema-fingerprint': `artifact:${sha('5')}`,
      },
      'fryzigg-player-stats': {
        'complete-rds-custody': `artifact:${sha('6')}`,
        'reconciliation-promotion-review': `artifact:${sha('7')}`,
      },
    },
    evidence: {
      terms: `artifact:${sha('e')}`,
      authority: `artifact:${sha('f')}`,
      rateLimit: rateLimitEvidenceId,
    },
    termsEffectiveAt: '2026-08-01T00:00:00.000Z',
    termsExpireAt: '2027-08-01T00:00:00.000Z',
    proposedAt: '2026-08-02T00:00:00.000Z',
    proposedBy: 'source-governance-owner',
  }).find(({ content }) => content.provider === 'footywire');
  if (sourceRights === undefined) throw new Error('Footywire policy fixture is missing.');
  const { proposal, decision } = createApprovedAflTradeFitzRoyGateRecords({
    sourceRights,
    environment: 'production',
    version: 1,
    supersedesDecisionId: null,
    decidedAt: '2026-08-02T00:10:00.000Z',
    effectiveAt: '2026-08-02T00:10:00.000Z',
    revalidateAt: '2027-08-01T00:00:00.000Z',
    accountableOwner: 'source-governance-owner',
    reviewer: {
      id: 'source-reviewer',
      role: 'source-governance-reviewer',
      evidenceId: `artifact:${sha('1')}`,
    },
    authorityEvidenceId: `artifact:${sha('f')}`,
    rateLimitEvidenceId,
  });
  const operations = [
    'bounded_evaluation_capture',
    'raw_evidence_retention',
    'metadata_hash_retention',
    'public_fact_display',
  ] as const;
  return {
    sourceRights,
    ledger: { proposals: [proposal], decisions: [decision] },
    gateRequest: {
      decisionKey: proposal.content.decisionKey,
      environment: 'production' as const,
      rightsArtifactId: sourceRights.rightsArtifactId,
      competition: 'AFLM',
      season: 2026,
      accessMechanism: 'automated_web' as const,
      capabilityId: 'footywire-player-stats',
      geography: 'global',
      commercialContext: 'public-research',
      audience: 'public',
      operations,
      fieldUses: [
        { sourceField: 'games', use: 'public_display' as const },
        { sourceField: 'goals', use: 'public_display' as const },
      ],
      rawRetentionDays: 365,
      metadataRetentionDays: null,
      cacheSeconds: 86_400,
    },
    captureRequest: captureRequest({
      capabilityId: 'footywire-player-stats',
      parameters: { season: 2026, checkExisting: true },
    }),
    rateLimitEvidenceId,
  };
}

function nonProductionGovernanceFixture() {
  const fixture = productionGovernanceFixture();
  const { proposal, decision } = createApprovedAflTradeFitzRoyGateRecords({
    sourceRights: fixture.sourceRights,
    environment: 'non_production',
    version: 1,
    supersedesDecisionId: null,
    decidedAt: '2026-08-02T00:10:00.000Z',
    effectiveAt: '2026-08-02T00:10:00.000Z',
    revalidateAt: '2027-08-01T00:00:00.000Z',
    accountableOwner: 'source-governance-owner',
    reviewer: {
      id: 'source-reviewer',
      role: 'source-governance-reviewer',
      evidenceId: `artifact:${sha('1')}`,
    },
    authorityEvidenceId: `artifact:${sha('f')}`,
    rateLimitEvidenceId: fixture.rateLimitEvidenceId,
  });
  return {
    ...fixture,
    ledger: { proposals: [proposal], decisions: [decision] },
    gateRequest: {
      ...fixture.gateRequest,
      decisionKey: proposal.content.decisionKey,
      environment: 'non_production' as const,
    },
  };
}

function durableFixtureRepository(artifactClass: 'raw_source' | 'capture_metadata') {
  const fixture = createAflTradeFixtureArtifactRepository({ artifactClass });
  const custodyProfile = createAflTradeArtifactCustodyProfile({
    schemaVersion: 'afl-trade-artifact-custody-profile/v1',
    subject: 'afl-trade-intelligence',
    contractRole: 'requirements_only_not_readiness_or_authorization',
    repositoryId: `production-${artifactClass}`,
    environment: 'production',
    artifactClass,
    maximumObjectBytes: 16_384,
    keyDerivation: 'profile_sha256_two_level_fanout_v1',
    conditionalCreate: 'if_none_match_star_required',
    encryption: {
      inTransit: 'tls_required',
      atRest: { mode: 'customer_managed', keyReferenceSha256: sha('2') },
    },
    retention: {
      deletion: {
        kind: 'maximum_age',
        maximumDays: 365,
        enforcement: 'provider_lifecycle_required',
      },
      deleteOnWithdrawal: true,
      worm: null,
    },
    residency: {
      allowedJurisdictions: ['Australia'],
      crossJurisdictionTransfer: 'prohibited',
    },
    infrastructureEvidenceIds: [`storage-policy:${sha('3')}`],
  });
  return { ...fixture, assurance: 'durable_object_storage' as const, custodyProfile };
}

describe('fitzRoy capture request contracts', () => {
  it('derives direct functions and rejects wrappers, extra arguments, and false round grain', () => {
    const invocation = createAflTradeFitzRoyInvocation(captureRequest());
    expect(invocation.directFunction).toBe('fetch_player_stats_afl');
    expect(invocation.arguments).toEqual({ season: 2026, round_number: 1, comp: 'AFLM' });
    const scopedCoachesVotes = createAflTradeFitzRoyInvocation(
      captureRequest({
        capabilityId: 'aflca-coaches-votes-scoped',
        authorizationSeason: 2025,
        parameters: {
          season: 2025,
          roundNumbers: [1, 2, 23, 24],
          awardScope: 'home_and_away',
          team: null,
        },
      })
    );
    expect(scopedCoachesVotes).toMatchObject({
      directFunction: 'fetch_coaches_votes',
      arguments: {
        season: 2025,
        round_number: [1, 2, 23, 24],
        comp: 'AFLM',
        team: null,
        award_scope: 'home_and_away',
      },
    });
    expect(() =>
      createAflTradeFitzRoyInvocation(
        captureRequest({
          capabilityId: 'aflca-coaches-votes-scoped',
          authorizationSeason: 2025,
          parameters: {
            season: 2025,
            roundNumbers: [1, 24, 24],
            awardScope: 'home_and_away',
            team: null,
          },
        })
      )
    ).toThrow(/strictly increasing and unique/);
    expect(() =>
      createAflTradeFitzRoyInvocation(captureRequest({ capabilityId: 'fetch_player_stats' }))
    ).toThrow();
    expect(() =>
      createAflTradeFitzRoyInvocation(
        captureRequest({ parameters: { season: 2026, roundNumber: 1, source: 'footywire' } })
      )
    ).toThrow();
    expect(() =>
      createAflTradeFitzRoyInvocation(
        captureRequest({
          capabilityId: 'footywire-player-stats',
          parameters: { season: 2026, roundNumber: 1, checkExisting: true },
        })
      )
    ).toThrow();
    expect(() =>
      createAflTradeFitzRoyInvocation(
        captureRequest({
          capabilityId: 'footywire-player-stats',
          authorizationSeason: 2009,
          parameters: { season: 2009, checkExisting: true },
        })
      )
    ).toThrow(/documented from season 2010/);
    expect(() =>
      createAflTradeFitzRoyInvocation(
        captureRequest({ parameters: { season: 2025, roundNumber: 1 } })
      )
    ).toThrow(/outside the authorized season 2026/);
    expect(() =>
      createAflTradeFitzRoyInvocation(
        captureRequest({
          capabilityId: 'afl-tables-player-stats',
          parameters: { season: 2026, rescrape: true, rescrapeStartSeason: 2025 },
        })
      )
    ).toThrow(/must start at the authorized season/);
    expect(() =>
      createAflTradeFitzRoyInvocation(
        captureRequest({
          capabilityId: 'afl-tables-player-stats',
          parameters: { season: 2026, rescrape: false, rescrapeStartSeason: 2026 },
        })
      )
    ).toThrow(/must be null when rescrape is disabled/);
    expect(() =>
      createAflTradeFitzRoyInvocation(
        captureRequest({
          capabilityId: 'official-afl-player-details',
          parameters: {
            season: 2026,
            team: null,
            current: false,
            officialTeams: true,
          },
        })
      )
    ).toThrow(/full 2012-to-season retrieval scope/);
    for (const capabilityId of ['afl-tables-player-details', 'footywire-player-details'] as const) {
      expect(() =>
        createAflTradeFitzRoyInvocation(
          captureRequest({
            capabilityId,
            parameters:
              capabilityId === 'footywire-player-details'
                ? { team: null, current: true }
                : { team: null },
          })
        )
      ).toThrow(/disabled until Gate 0A supports its full retrieval scope/);
    }
    expect(
      aflTradeFitzRoyInvocationSchema.safeParse({
        ...invocation,
        arguments: { ...invocation.arguments, season: 2025 },
      }).success
    ).toBe(false);
    expect(
      aflTradeFitzRoyInvocationSchema.safeParse({
        ...invocation,
        arguments: { ...invocation.arguments, source: 'footywire' },
      }).success
    ).toBe(false);
  });

  it('keeps the R direct-call allowlist aligned and isolated from fantasy ETL', () => {
    const source = readFileSync(
      join(process.cwd(), 'etl/afl-trade-intelligence/capture_fitzroy.R'),
      'utf8'
    );
    for (const capability of AFL_TRADE_FITZROY_CAPABILITIES) {
      expect(source).toContain(`id = "${capability.capabilityId}"`);
      expect(source).toContain(`function_name = "${capability.directFunction}"`);
      expect(source).toContain(`round = "${capability.roundBehaviour}"`);
      expect(source).toContain(`fitzRoy::${capability.directFunction}(`);
    }
    expect(source).toContain('with_afltables_data_bindings(');
    expect(source).toContain('d9f797e79f11edd7ace541f178d68091c55286c9163f2c02e2a0b37109b951a8');
    expect(source).toContain('799966171a68b0562ebdeffc27ecb922a7c85d76bd5f041fbb0c413ebe091a9d');
    expect(source.match(/with_afltables_data_bindings\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/fetch_player_stats\s*\(/);
    expect(source).not.toMatch(/\b(get|eval|do\.call)\s*\(/);
    expect(source).not.toMatch(/minutes|coalesce|mutate|firebase|firestore/i);
  });

  it('pins the complete R dependency lock and immutable base image', () => {
    const lockBytes = readFileSync(join(process.cwd(), 'etl/afl-trade-intelligence/renv.lock'));
    const aflcaPatchBytes = readFileSync(
      join(
        process.cwd(),
        'etl/afl-trade-intelligence/patches/fitzRoy-1.7.0-scoped-aflca-votes.patch'
      )
    );
    const lock = JSON.parse(lockBytes.toString('utf8')) as {
      R: { Version: string; Repositories: Array<{ URL: string }> };
      Packages: Record<string, { Version: string }>;
    };
    const dockerfile = readFileSync(
      join(process.cwd(), 'etl/afl-trade-intelligence/Dockerfile'),
      'utf8'
    );
    const lockSha256 = createHash('sha256').update(lockBytes).digest('hex');
    const aflcaPatchSha256 = createHash('sha256').update(aflcaPatchBytes).digest('hex');
    expect(lock.R.Version).toBe('4.5.1');
    expect(lock.R.Repositories[0]?.URL).toBe('https://packagemanager.posit.co/cran/2026-08-07');
    expect(lock.Packages.fitzRoy?.Version).toBe('1.7.0');
    expect(lock.Packages.digest?.Version).toBe('0.6.39');
    expect(lock.Packages.renv?.Version).toBe('1.2.4');
    expect(dockerfile).toContain(
      'rocker/r-ver:4.5.1@sha256:03b023fbf7b1b24ac1bb8b2ac5fd7e15a767e67b40ff50c155e328110981c2aa'
    );
    expect(dockerfile).toContain(`ARG R_LOCK_SHA256=${lockSha256}`);
    expect(dockerfile).toContain(
      'ARG FITZROY_SOURCE_SHA256=296ef05e86cb3ed8473f88948a1561a05ee3db0b5e037624f2dba0acf20b5412'
    );
    expect(dockerfile).toContain(`ARG FITZROY_AFLCA_PATCH_SHA256=${aflcaPatchSha256}`);
    expect(dockerfile).toContain('Rscript --vanilla test_coaches_votes_scope_contract.R');
    expect(dockerfile).not.toContain('alpine');
  });
});

describe('authorized fitzRoy capture runtime', () => {
  it('stores exact invocation, RDS, and diagnostics with read-back receipts', async () => {
    const fixture = governanceFixture();
    const execute = vi.fn(async (invocation) => ({
      sourceBytes: Uint8Array.from([88, 10, 0, 0, 0, 3]),
      diagnostics: diagnostics(invocation),
    }));
    const receipt = await captureAuthorizedAflTradeFitzRoyEvidence(
      { ...fixture, captureRequest: captureRequest() },
      dependencies({ executionBoundary: 'fixture_no_network', execute })
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(receipt.content.sourceCustody.artifact.mediaType).toBe('application/x-r-rds');
    expect(receipt.content.diagnostics.invocationSha256).toBe(
      receipt.content.invocationCustody.artifact.contentSha256
    );
    expect(receipt.content.authorizationReceipt.content.result.status).toBe(
      'mechanically_eligible'
    );
    expect(receipt.captureReceiptId).toMatch(/^fitzroy-capture:[a-f0-9]{64}$/);
    expect(
      createAflTradeFitzRoyDecodeContext({
        captureReceipt: receipt,
        dependencyLockSha256: sha('b'),
        imageDigest: `sha256:${sha('c')}`,
        maximumRows: 100,
        maximumFields: 100,
        maximumCells: 10_000,
        maximumCellBytes: 1_024,
        maximumOutputBytes: 1_000_000,
      }).expectedRowCount
    ).toBe(2);
  });

  it('records a new observation when identical immutable bytes already exist', async () => {
    const fixture = governanceFixture();
    const rawArtifactRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'raw_source',
    });
    const metadataArtifactRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'capture_metadata',
    });
    const times = [
      '2026-08-05T01:00:00.000Z',
      '2026-08-05T01:00:01.000Z',
      '2026-08-05T01:00:02.000Z',
      '2026-08-05T01:00:03.000Z',
      '2026-08-05T01:00:04.000Z',
      '2026-08-05T02:00:00.000Z',
      '2026-08-05T02:00:01.000Z',
      '2026-08-05T02:00:02.000Z',
      '2026-08-05T02:00:03.000Z',
      '2026-08-05T02:00:04.000Z',
    ];
    const executor: AflTradeFitzRoyProcessExecutor = {
      executionBoundary: 'fixture_no_network',
      async execute(invocation) {
        return {
          sourceBytes: Uint8Array.from([88, 10, 0, 0, 0, 3]),
          diagnostics: diagnostics(invocation),
        };
      },
    };
    const sharedDependencies = {
      rawArtifactRepository,
      metadataArtifactRepository,
      executor,
      clock: { now: () => times.shift() ?? '2026-08-05T02:00:04.000Z' },
      runtimeIdentity,
      timeoutMs: 30_000,
      maximumSourceBytes: 1024,
      maximumDiagnosticsBytes: 16_384,
    };
    const first = await captureAuthorizedAflTradeFitzRoyEvidence(
      { ...fixture, captureRequest: captureRequest() },
      sharedDependencies
    );
    const second = await captureAuthorizedAflTradeFitzRoyEvidence(
      { ...fixture, captureRequest: captureRequest() },
      sharedDependencies
    );
    expect(second.content.sourceCustody.artifact.artifactId).toBe(
      first.content.sourceCustody.artifact.artifactId
    );
    expect(second.content.sourceCustody.artifact.createdAt).toBe(
      first.content.sourceCustody.artifact.createdAt
    );
    expect(second.content.capturedAt).toBe('2026-08-05T02:00:04.000Z');
    expect(second.captureReceiptId).not.toBe(first.captureReceiptId);
  });

  it.each([
    ['zero rows', { rowCount: 0 }, 'OUTPUT_INVALID'],
    ['duplicate rows', { duplicateRowCount: 1 }, 'OUTPUT_INVALID'],
    [
      'warnings',
      { conditions: [{ kind: 'warning', message: 'One upstream match failed.' }] },
      'OUTPUT_INVALID',
    ],
    [
      'field drift',
      {
        fields: [
          {
            name: 'unexpected',
            classes: ['numeric'],
            storageType: 'double',
            missingCount: 0,
            nanCount: 0,
            positiveInfinityCount: 0,
            negativeInfinityCount: 0,
            levels: null,
            timezone: null,
          },
        ],
      },
      'SCHEMA_DRIFT',
    ],
    ['out-of-scope season rows', { observedSeasonValues: ['2025'] }, 'OUTPUT_INVALID'],
    [
      'unverifiable season scope',
      { observedSeasonValues: [], observedDateRange: null },
      'OUTPUT_INVALID',
    ],
    ['out-of-scope round rows', { observedRoundValues: ['2'] }, 'OUTPUT_INVALID'],
  ])('fails closed on %s', async (_label, diagnosticPatch, expectedCode) => {
    const fixture = governanceFixture();
    const executor: AflTradeFitzRoyProcessExecutor = {
      executionBoundary: 'fixture_no_network',
      async execute(invocation) {
        return {
          sourceBytes: Uint8Array.from([88, 10, 0, 0, 0, 3]),
          diagnostics: { ...diagnostics(invocation), ...diagnosticPatch },
        };
      },
    };
    await expect(
      captureAuthorizedAflTradeFitzRoyEvidence(
        { ...fixture, captureRequest: captureRequest() },
        dependencies(executor)
      )
    ).rejects.toMatchObject({ code: expectedCode });
  });

  it('admits request-scoped official rows only when their schema retains season evidence for decode', () => {
    const invocation = createAflTradeFitzRoyInvocation(
      captureRequest({ parameters: { season: 2026, roundNumber: null } })
    );
    const officialDiagnostics: AflTradeFitzRoyCaptureDiagnostics = {
      ...diagnostics(invocation),
      fields: [
        ...diagnostics(invocation).fields,
        {
          name: 'utcStartTime',
          classes: ['character'],
          storageType: 'character',
          missingCount: 0,
          nanCount: 0,
          positiveInfinityCount: 0,
          negativeInfinityCount: 0,
          levels: null,
          timezone: null,
        },
        {
          name: 'compSeason.shortName',
          classes: ['character'],
          storageType: 'character',
          missingCount: 0,
          nanCount: 0,
          positiveInfinityCount: 0,
          negativeInfinityCount: 0,
          levels: null,
          timezone: null,
        },
      ],
      observedSeasonValues: [],
      observedDateRange: null,
    };

    expect(getAflTradeFitzRoyObservedScopeError(invocation, officialDiagnostics)).toBeNull();
    expect(
      getAflTradeFitzRoyObservedScopeError(invocation, {
        ...officialDiagnostics,
        fields: officialDiagnostics.fields.filter(({ name }) => name !== 'utcStartTime'),
      })
    ).toMatch(/season evidence/);
  });

  it('never calls the provider process when the requested season exceeds Gate scope', async () => {
    const fixture = governanceFixture();
    const execute = vi.fn();
    await expect(
      captureAuthorizedAflTradeFitzRoyEvidence(
        {
          ...fixture,
          captureRequest: captureRequest({ parameters: { season: 2025, roundNumber: 1 } }),
        },
        dependencies({ executionBoundary: 'fixture_no_network', execute })
      )
    ).rejects.toThrow(/outside the authorized season 2026/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps production execution technically disabled until rate-limited egress is composed', async () => {
    const fixture = governanceFixture();
    const execute = vi.fn();
    await expect(
      captureAuthorizedAflTradeFitzRoyEvidence(
        {
          ...fixture,
          gateRequest: { ...fixture.gateRequest, environment: 'production' },
          captureRequest: captureRequest(),
        },
        dependencies({ executionBoundary: 'fixture_no_network', execute })
      )
    ).rejects.toMatchObject({ code: 'PRODUCTION_EXECUTION_DISABLED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('captures approved production evidence only through durable custody and distributed admission', async () => {
    const fixture = productionGovernanceFixture();
    const execute = vi.fn(async (invocation) => {
      const sourceBytes = Uint8Array.from([88, 10, 0, 0, 0, 3]);
      const executionDiagnostics = diagnostics(invocation);
      const diagnosticsBytes = new TextEncoder().encode(
        canonicalizeAflTradeJson(executionDiagnostics)
      );
      return {
        sourceBytes,
        diagnostics: executionDiagnostics,
        egressExecutionReceipt: createAflTradeFitzRoyEgressExecutionReceipt({
          content: {
            schemaVersion: AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION,
            executionBoundary: 'attested_provider_egress',
            provider: 'footywire',
            capabilityId: invocation.capabilityId,
            directFunction: invocation.directFunction,
            fitzRoyVersion: invocation.fitzRoyVersion,
            invocationSha256: sha256AflTradeCanonicalJson(invocation),
            sourceOutput: {
              contentSha256: createHash('sha256').update(sourceBytes).digest('hex'),
              byteLength: sourceBytes.byteLength,
            },
            diagnosticsOutput: {
              contentSha256: createHash('sha256').update(diagnosticsBytes).digest('hex'),
              byteLength: diagnosticsBytes.byteLength,
            },
            runtime: runtimeIdentity,
            enforcedPolicy: {
              upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
              cacheSeconds: 86_400,
              egressPolicyEvidenceId: fixture.rateLimitEvidenceId,
            },
            startedAt: '2026-08-03T00:00:00.000Z',
            completedAt: '2026-08-03T00:00:00.000Z',
            status: 'succeeded',
          },
          signature: {
            algorithm: 'Ed25519',
            keyId: 'fixture-egress-signing-key',
            valueBase64Url: 'A'.repeat(86),
          },
        }),
      };
    });
    const acquire = vi.fn<AflTradeFitzRoyCaptureAdmission['acquire']>(async (request) => ({
      status: 'admitted',
      lease: {
        provider: request.provider,
        capabilityId: request.capabilityId,
        invocationSha256: request.invocationSha256,
        token: 'production-lease',
        providerKey: `afl-trade:capture:provider:${request.provider}`,
        requestKey: `afl-trade:capture:request:${request.capabilityId}:${request.invocationSha256}`,
        expiresAtMs: request.nowMs + request.policy.maximumLeaseMs,
        providerCooldownMs: 3_000,
        successRequestCooldownMs: 86_400_000,
        egressPolicyEvidenceId: request.policy.egressPolicyEvidenceId,
      },
    }));
    const complete = vi.fn<AflTradeFitzRoyCaptureAdmission['complete']>(async () => undefined);
    const admission: AflTradeFitzRoyCaptureAdmission = { acquire, complete };
    const resolveAuthorization = vi.fn(async () => ({
      ledger: fixture.ledger,
      sourceRights: fixture.sourceRights,
    }));

    const receipt = await captureAuthorizedAflTradeFitzRoyEvidence(fixture, {
      rawArtifactRepository: durableFixtureRepository('raw_source'),
      metadataArtifactRepository: durableFixtureRepository('capture_metadata'),
      executor: {
        executionBoundary: 'attested_rate_limited',
        egressPolicyEvidenceIds: [fixture.rateLimitEvidenceId],
        execute,
      },
      captureAdmission: admission,
      egressExecutionVerifier: { verify: vi.fn(async () => true) },
      authorizationResolver: { resolveAuthorization },
      clock: { now: () => '2026-08-03T00:00:00.000Z' },
      runtimeIdentity,
      timeoutMs: 30_000,
      maximumSourceBytes: 1_024,
      maximumDiagnosticsBytes: 16_384,
    });

    expect(receipt.content.authorizationReceipt.content.result.status).toBe(
      'mechanically_eligible'
    );
    expect(receipt.content.egressExecutionReceipt?.content.provider).toBe('footywire');
    expect(receipt.content.egressExecutionCustody?.artifact.mediaType).toBe('application/json');
    expect(resolveAuthorization).toHaveBeenCalledOnce();
    expect(resolveAuthorization).toHaveBeenCalledWith(fixture.gateRequest.rightsArtifactId);
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'footywire',
        capabilityId: 'footywire-player-stats',
        policy: expect.objectContaining({
          upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
          cacheSeconds: 86_400,
          egressPolicyEvidenceId: fixture.rateLimitEvidenceId,
        }),
      })
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'production-lease' }),
      expect.objectContaining({ outcome: 'succeeded' })
    );
  });

  it('captures approved local evidence only through the explicit non-production profile', async () => {
    const fixture = nonProductionGovernanceFixture();
    const directory = await mkdtemp(join(tmpdir(), 'statly-local-capture-profile-'));
    const execute = vi.fn(async (invocation) => {
      const sourceBytes = Uint8Array.from([88, 10, 0, 0, 0, 3]);
      const executionDiagnostics = diagnostics(invocation);
      const diagnosticsBytes = new TextEncoder().encode(
        canonicalizeAflTradeJson(executionDiagnostics)
      );
      return {
        sourceBytes,
        diagnostics: executionDiagnostics,
        egressExecutionReceipt: createAflTradeFitzRoyEgressExecutionReceipt({
          content: {
            schemaVersion: AFL_TRADE_FITZROY_EGRESS_EXECUTION_SCHEMA_VERSION,
            executionBoundary: 'local_non_production_docker',
            enforcementScope: 'capture_admission_only',
            provider: 'footywire',
            capabilityId: invocation.capabilityId,
            directFunction: invocation.directFunction,
            fitzRoyVersion: invocation.fitzRoyVersion,
            invocationSha256: sha256AflTradeCanonicalJson(invocation),
            sourceOutput: {
              contentSha256: createHash('sha256').update(sourceBytes).digest('hex'),
              byteLength: sourceBytes.byteLength,
            },
            diagnosticsOutput: {
              contentSha256: createHash('sha256').update(diagnosticsBytes).digest('hex'),
              byteLength: diagnosticsBytes.byteLength,
            },
            runtime: runtimeIdentity,
            enforcedPolicy: {
              upstreamRate: { requests: 1, perSeconds: 3, burst: 1 },
              cacheSeconds: 86_400,
              egressPolicyEvidenceId: fixture.rateLimitEvidenceId,
            },
            startedAt: '2026-08-03T00:00:00.000Z',
            completedAt: '2026-08-03T00:00:00.000Z',
            status: 'succeeded',
          },
          signature: {
            algorithm: 'Ed25519',
            keyId: 'local-rehearsal-key',
            valueBase64Url: 'A'.repeat(86),
          },
        }),
      };
    });
    const resolveAuthorization = vi.fn(async () => ({
      ledger: fixture.ledger,
      sourceRights: fixture.sourceRights,
    }));

    try {
      const receipt = await captureAuthorizedAflTradeFitzRoyEvidence(fixture, {
        rawArtifactRepository: createLocalAflTradeNonProductionArtifactRepository({
          rootDirectory: directory,
          repositoryId: 'raw-source',
          artifactClass: 'raw_source',
          maximumObjectBytes: 16_384,
        }),
        metadataArtifactRepository: createLocalAflTradeNonProductionArtifactRepository({
          rootDirectory: directory,
          repositoryId: 'capture-metadata',
          artifactClass: 'capture_metadata',
          maximumObjectBytes: 16_384,
        }),
        executor: {
          executionBoundary: 'local_rate_limited_docker',
          egressPolicyEvidenceIds: [fixture.rateLimitEvidenceId],
          execute,
        },
        egressExecutionVerifier: { verify: vi.fn(async () => true) },
        authorizationResolver: { resolveAuthorization },
        clock: { now: () => '2026-08-03T00:00:00.000Z' },
        runtimeIdentity,
        timeoutMs: 30_000,
        maximumSourceBytes: 1_024,
        maximumDiagnosticsBytes: 16_384,
      });

      expect(receipt.content.authorizationReceipt.content.request.environment).toBe(
        'non_production'
      );
      expect(receipt.content.sourceCustody.readback.content.repositoryAssurance).toBe(
        'local_non_production_filesystem'
      );
      expect(receipt.content.egressExecutionReceipt?.content).toMatchObject({
        executionBoundary: 'local_non_production_docker',
        enforcementScope: 'capture_admission_only',
      });
      expect(resolveAuthorization).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not let the local capture profile satisfy production execution', async () => {
    const fixture = productionGovernanceFixture();
    const directory = await mkdtemp(join(tmpdir(), 'statly-local-production-rejection-'));
    const execute = vi.fn();
    try {
      await expect(
        captureAuthorizedAflTradeFitzRoyEvidence(fixture, {
          rawArtifactRepository: createLocalAflTradeNonProductionArtifactRepository({
            rootDirectory: directory,
            repositoryId: 'raw-source',
            artifactClass: 'raw_source',
            maximumObjectBytes: 16_384,
          }),
          metadataArtifactRepository: createLocalAflTradeNonProductionArtifactRepository({
            rootDirectory: directory,
            repositoryId: 'capture-metadata',
            artifactClass: 'capture_metadata',
            maximumObjectBytes: 16_384,
          }),
          executor: {
            executionBoundary: 'local_rate_limited_docker',
            egressPolicyEvidenceIds: [fixture.rateLimitEvidenceId],
            execute,
          },
          egressExecutionVerifier: { verify: vi.fn(async () => true) },
          authorizationResolver: {
            resolveAuthorization: vi.fn(async () => ({
              ledger: fixture.ledger,
              sourceRights: fixture.sourceRights,
            })),
          },
          clock: { now: () => '2026-08-03T00:00:00.000Z' },
          runtimeIdentity,
          timeoutMs: 30_000,
          maximumSourceBytes: 1_024,
          maximumDiagnosticsBytes: 16_384,
        })
      ).rejects.toMatchObject({ code: 'PRODUCTION_EXECUTION_DISABLED' });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not let fixture authority reach a network-capable executor', async () => {
    const fixture = governanceFixture();
    const execute = vi.fn();
    await expect(
      captureAuthorizedAflTradeFitzRoyEvidence(
        { ...fixture, captureRequest: captureRequest() },
        dependencies({ executionBoundary: 'local_network_capable', execute })
      )
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_BLOCKED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('never calls the provider process when Gate 0A is blocked', async () => {
    const fixture = governanceFixture();
    const execute = vi.fn();
    await expect(
      captureAuthorizedAflTradeFitzRoyEvidence(
        {
          ...fixture,
          ledger: { proposals: fixture.ledger.proposals, decisions: [] },
          captureRequest: captureRequest(),
        },
        dependencies({ executionBoundary: 'fixture_no_network', execute })
      )
    ).rejects.toBeInstanceOf(AflTradeFitzRoyCaptureError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a different image or dependency lock identity', async () => {
    const fixture = governanceFixture();
    const executor: AflTradeFitzRoyProcessExecutor = {
      executionBoundary: 'fixture_no_network',
      async execute(invocation) {
        return {
          sourceBytes: Uint8Array.from([88, 10, 0, 0, 0, 3]),
          diagnostics: {
            ...diagnostics(invocation),
            runtime: { ...diagnostics(invocation).runtime, imageDigest: `sha256:${sha('f')}` },
          },
        };
      },
    };
    await expect(
      captureAuthorizedAflTradeFitzRoyEvidence(
        { ...fixture, captureRequest: captureRequest() },
        dependencies(executor)
      )
    ).rejects.toMatchObject({ code: 'RUNTIME_IDENTITY_MISMATCH' });
  });
});
