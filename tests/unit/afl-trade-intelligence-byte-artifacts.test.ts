import { describe, expect, it } from 'vitest';

import {
  aflTradeArtifactRefSchema,
  createAflTradeByteArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeArtifactCustodyProfile } from '@/server/aflTradeIntelligence/artifacts/artifactCustodyProfile';
import {
  AflTradeArtifactCustodyError,
  createAflTradeFixtureArtifactRepository,
  verifyAflTradeArtifactReadback,
} from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import {
  aflTradeSourceSnapshotManifestContentSchema,
  createAflTradeSourceSnapshotManifest,
} from '@/server/aflTradeIntelligence/artifacts/sourceSnapshotManifest';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createAflTradeGate0AReceipt } from '@/server/aflTradeIntelligence/source/gate0aReceipt';
import {
  createAflTradeFitzRoyInvocation,
  createAflTradeFitzRoySchemaFingerprint,
} from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';
import { createAflTradeFitzRoyCaptureReceipt } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureReceipt';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';

const sha = (character: string) => character.repeat(64);
const evidenceId = `artifact:${sha('a')}`;

function governanceFixture(
  accessMechanism: 'provider_export' | 'provider_api',
  useFitzRoy = false,
  environment: 'test_fixture' | 'non_production' = 'test_fixture'
) {
  const automated = accessMechanism === 'provider_api';
  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: `fixture-${accessMechanism}`,
    provider: useFitzRoy ? 'official_afl' : 'Fabricated provider',
    dataset: 'Fabricated AFL outcomes',
    datasetVersion: 'fixture-v1',
    intendedPurpose: 'Exercise immutable source custody with fabricated bytes.',
    scope: {
      competitions: [useFitzRoy ? 'AFLM' : 'AFL'],
      seasonRanges: [{ from: 2026, to: 2026 }],
      accessMechanism,
    },
    acquisition: useFitzRoy
      ? {
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
        }
      : accessMechanism === 'provider_api'
        ? {
            kind: 'provider_direct' as const,
            clientName: 'Fabricated provider test client',
            clientVersion: 'fixture-v1',
          }
        : {
            kind: 'provided_artifact' as const,
            mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            deliveryMethod: 'Fabricated fixture export',
          },
    operations: {
      bounded_evaluation_capture: 'allowed' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'blocked' as const,
      derived_feature_creation: 'allowed' as const,
      public_derived_output: 'allowed' as const,
      public_fact_display: 'allowed' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      permitted: automated,
      identification: automated ? 'Statly fabricated test client' : null,
      rateLimit: automated ? { requests: 10, perSeconds: 60, burst: 2 } : null,
      cache: { permitted: true, maximumSeconds: 300 },
    },
    retention: {
      rawEvidence: {
        disposition: 'transient' as const,
        maximumDays: 30,
        deleteOnWithdrawal: true,
        basis: 'Fabricated raw bytes are retained for at most 30 days.',
      },
      hashesAndMetadata: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: false,
        basis: 'Fabricated hashes support audit tests.',
      },
      derivedArtifacts: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: true,
        basis: 'Fabricated derived outputs support parity tests.',
      },
    },
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: true },
    attribution: { required: false, text: null, placement: null },
    restrictions: {
      geographic: ['Australia'],
      commercial: ['test-only'],
      audience: ['public-afl-readers'],
    },
    fields: ['games', 'goals'].map((sourceField) => ({
      sourceField,
      normalizedField: `player_${sourceField}`,
      uses: {
        archive_fact: 'allowed' as const,
        model_training: 'blocked' as const,
        derived_feature: 'allowed' as const,
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
      deletionInstructions: 'Delete fabricated raw bytes.',
      retainableAuditMaterial: 'Retain content addresses and decision evidence.',
    },
    proposedAt: '2026-08-05T00:00:00.000Z',
    proposedBy: 'fixture-owner',
    proposalOrigin: 'agent_assisted' as const,
  };
  const rights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const operations = [
    'bounded_evaluation_capture',
    'raw_evidence_retention',
    'metadata_hash_retention',
    'public_derived_output',
    'public_fact_display',
  ] as const;
  const scope = {
    scopeKey: `fixture-${accessMechanism}`,
    description: 'Fabricated source-custody scope.',
    dimensions: [
      { name: 'source_rights_artifact', values: [rights.rightsArtifactId] },
      { name: 'competition', values: rights.content.scope.competitions },
      { name: 'season', values: ['2026'] },
      { name: 'access_mechanism', values: [accessMechanism] },
      ...(rights.content.acquisition.kind === 'fitzroy'
        ? [
            {
              name: 'fitzroy_capability',
              values: rights.content.acquisition.capabilities.map(
                ({ capabilityId }) => capabilityId
              ),
            },
          ]
        : []),
      { name: 'geography', values: ['Australia'] },
      { name: 'commercial_context', values: ['test-only'] },
      { name: 'audience', values: ['public-afl-readers'] },
      { name: 'operation', values: [...operations] },
    ],
    exclusions: ['Production data and authority'],
  };
  const proposalContent = {
    schemaVersion: 'afl-trade-gate-proposal/v1' as const,
    gate: 'gate_0a_permission_to_evaluate' as const,
    decisionKey: `fixture-${accessMechanism}`,
    version: 1,
    environment,
    scope,
    proposal: 'Permit only this fabricated source-custody test.',
    alternativesConsidered: ['Keep fabricated capture blocked.'],
    accountableOwner: 'fixture-owner',
    reviewRequirement: 'accountable_owner_only' as const,
    requiredReviewerRoles: [],
    conditions: [],
    evidenceIds: [evidenceId],
    affectedArtifacts: [{ kind: 'source_rights' as const, artifactId: rights.rightsArtifactId }],
    proposedAt: '2026-08-05T00:10:00.000Z',
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
    environment,
    scope,
    state: 'approved' as const,
    authorityKind:
      environment === 'test_fixture' ? ('fixture' as const) : ('external_human_record' as const),
    accountableOwner: 'fixture-owner',
    decidedBy: 'fixture-owner',
    reviewers: [],
    authorityEvidenceIds: [evidenceId],
    conditionResults: [],
    rationale: 'Fabricated test-only source-custody approval.',
    limitations: ['No production authority.'],
    decidedAt: '2026-08-05T00:20:00.000Z',
    effectiveAt: '2026-08-05T00:20:00.000Z',
    revalidateAt: '2026-12-01T00:00:00.000Z',
    supersedesDecisionId: null,
    affectedArtifacts: proposal.content.affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: createAflTradeContentAddress('gate-decision', decisionContent),
    content: decisionContent,
  });
  const ledger = { proposals: [proposal], decisions: [decision] };
  const receipt = createAflTradeGate0AReceipt(
    ledger,
    rights,
    {
      decisionKey: proposal.content.decisionKey,
      environment,
      rightsArtifactId: rights.rightsArtifactId,
      evaluatedAt: '2026-08-05T01:50:00.000Z',
      competition: rights.content.scope.competitions[0],
      season: 2026,
      accessMechanism,
      capabilityId:
        rights.content.acquisition.kind === 'fitzroy'
          ? rights.content.acquisition.capabilities[0].capabilityId
          : null,
      geography: 'Australia',
      commercialContext: 'test-only',
      audience: 'public-afl-readers',
      operations,
      fieldUses: [
        { sourceField: 'games', use: 'public_display' },
        { sourceField: 'goals', use: 'public_display' },
      ],
      rawRetentionDays: 30,
      metadataRetentionDays: null,
      cacheSeconds: 300,
    },
    '2026-08-05T01:51:00.000Z'
  );
  return { rights, proposal, decision, receipt };
}

async function custodyFixture(
  bytes: Uint8Array,
  mediaType: string,
  timestamps = {
    createdAt: '2026-08-05T02:00:00.000Z',
    verifiedAt: '2026-08-05T02:01:00.000Z',
  },
  artifactClass: 'raw_source' | 'capture_metadata' = 'capture_metadata'
) {
  const artifact = createAflTradeByteArtifactRef(bytes, mediaType, timestamps.createdAt);
  const repository = createAflTradeFixtureArtifactRepository({ artifactClass });
  const stored = await repository.putIfAbsent(artifact, bytes);
  const readbackReceipt = await verifyAflTradeArtifactReadback(
    repository,
    stored.reference,
    timestamps.verifiedAt,
    10_000
  );
  return { artifact: stored.reference, repository, readbackReceipt };
}

describe('AFL trade-intelligence immutable byte custody', () => {
  it('hashes arbitrary bytes exactly and rejects byte or media drift', () => {
    const bytes = Uint8Array.from([0, 255, 13, 10, ...new TextEncoder().encode('naïve 🏉')]);
    const artifact = createAflTradeByteArtifactRef(
      bytes,
      'application/octet-stream',
      '2026-08-05T02:00:00.000Z'
    );
    expect(artifact.byteLength).toBe(bytes.byteLength);
    expect(doesAflTradeArtifactRefMatchBytes(artifact, bytes, 'application/octet-stream')).toBe(
      true
    );
    expect(doesAflTradeArtifactRefMatchBytes(artifact, bytes, 'text/csv')).toBe(false);
    const tampered = Uint8Array.from(bytes);
    tampered[1] = 254;
    expect(doesAflTradeArtifactRefMatchBytes(artifact, tampered)).toBe(false);
    expect(
      aflTradeArtifactRefSchema.safeParse({ ...artifact, byteLength: artifact.byteLength + 1 })
        .success
    ).toBe(true);
    expect(doesAflTradeArtifactRefMatchBytes({ ...artifact, byteLength: 1 }, bytes)).toBe(false);
  });

  it('stores idempotently, copies bytes, bounds exact reads, and verifies read-back', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const { artifact, repository, readbackReceipt } = await custodyFixture(
      bytes,
      'application/octet-stream'
    );
    expect(await repository.putIfAbsent(artifact, bytes)).toEqual({
      status: 'already_present',
      reference: artifact,
    });
    const laterReference = createAflTradeByteArtifactRef(
      bytes,
      artifact.mediaType,
      '2026-08-05T02:05:00.000Z'
    );
    expect(await repository.putIfAbsent(laterReference, bytes)).toEqual({
      status: 'already_present',
      reference: artifact,
    });
    await expect(
      verifyAflTradeArtifactReadback(repository, laterReference, '2026-08-05T02:06:00.000Z', 10_000)
    ).rejects.toMatchObject({ code: 'READBACK_MISMATCH' });
    await expect(
      verifyAflTradeArtifactReadback(repository, artifact, '2026-08-05T02:06:00.000Z', 10_000)
    ).resolves.toMatchObject({ content: { artifact } });
    bytes[0] = 99;
    await expect(repository.loadExact(artifact, 4)).resolves.toEqual({
      reference: artifact,
      bytes: Uint8Array.from([1, 2, 3, 4]),
    });
    await expect(repository.loadExact(artifact, 3)).rejects.toBeInstanceOf(
      AflTradeArtifactCustodyError
    );
    const missing = createAflTradeByteArtifactRef(
      Uint8Array.from([9]),
      'application/octet-stream',
      artifact.createdAt
    );
    await expect(repository.loadExact(missing, 4)).resolves.toBeNull();
    expect(readbackReceipt.content.artifact.artifactId).toBe(artifact.artifactId);
    expect(readbackReceipt.receiptId).toMatch(/^artifact-readback:[a-f0-9]{64}$/);
    await expect(
      verifyAflTradeArtifactReadback(
        repository,
        { ...artifact, mediaType: 'text/csv' },
        '2026-08-05T02:01:00.000Z',
        10_000
      )
    ).rejects.toMatchObject({ code: 'READBACK_MISMATCH' });
    await expect(
      verifyAflTradeArtifactReadback(
        repository,
        { ...artifact, createdAt: '2026-08-05T01:59:00.000Z' },
        '2026-08-05T02:01:00.000Z',
        10_000
      )
    ).rejects.toMatchObject({ code: 'READBACK_MISMATCH' });
  });
});

describe('AFL trade-intelligence source snapshots', () => {
  it('binds one exact workbook, custody receipt, rights chain, fields, and retention', async () => {
    const governance = governanceFixture('provider_export');
    const custody = await custodyFixture(
      Uint8Array.from([80, 75, 3, 4]),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      undefined,
      'raw_source'
    );
    const snapshot = createAflTradeSourceSnapshotManifest({
      schemaVersion: 'afl-trade-source-snapshot/v3',
      sourceArtifact: custody.artifact,
      readbackReceipt: custody.readbackReceipt,
      capture: {
        kind: 'workbook',
        sourceRegisterId: governance.rights.content.registerId,
        upstreamProvider: governance.rights.content.provider,
        upstreamDataset: governance.rights.content.dataset,
        upstreamDatasetVersion: governance.rights.content.datasetVersion,
        originalFilename: 'AFL Drafts Trades.xlsx',
        workbookFormat: 'xlsx',
        worksheetNames: ['Trades'],
        importFormatVersion: 'fixture-v1',
        accessMechanism: 'provider_export',
      },
      sourceRightsProposal: governance.rights,
      gate0aProposal: governance.proposal,
      gate0aDecision: governance.decision,
      gate0aReceipt: governance.receipt,
      fitzRoyCaptureReceipt: null,
      capturedFields: ['games', 'goals'],
      retrievedAt: '2026-08-05T02:00:00.000Z',
      effectiveAt: '2026-08-05T00:00:00.000Z',
      retention: { rawRetentionDays: 30, deleteOnWithdrawal: true },
      createdAt: '2026-08-05T02:02:00.000Z',
    });
    expect(snapshot.snapshotId).toMatch(/^source-snapshot:[a-f0-9]{64}$/);
    expect(JSON.stringify(snapshot)).not.toMatch(/userId|leagueId|fantasy|bucket|\/Users\//i);
    expect(() =>
      createAflTradeSourceSnapshotManifest({
        ...snapshot.content,
        capturedFields: ['games'],
      })
    ).toThrow();
    for (const operation of [
      'bounded_evaluation_capture',
      'raw_evidence_retention',
      'metadata_hash_retention',
    ]) {
      const receiptContent = {
        ...snapshot.content.gate0aReceipt.content,
        request: {
          ...snapshot.content.gate0aReceipt.content.request,
          operations: snapshot.content.gate0aReceipt.content.request.operations.filter(
            (candidate) => candidate !== operation
          ),
        },
      };
      const result = aflTradeSourceSnapshotManifestContentSchema.safeParse({
        ...snapshot.content,
        gate0aReceipt: {
          receiptId: createAflTradeContentAddress('gate0a-evaluation', receiptContent),
          content: receiptContent,
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ['gate0aReceipt', 'content', 'request', 'operations'],
            }),
          ])
        );
      }
    }
    const forgedArtifact = {
      ...snapshot.content.readbackReceipt.content.artifact,
      createdAt: '2026-08-05T01:59:00.000Z',
    };
    const forgedReceiptContent = {
      ...snapshot.content.readbackReceipt.content,
      artifact: forgedArtifact,
    };
    const forgedReadback = aflTradeSourceSnapshotManifestContentSchema.safeParse({
      ...snapshot.content,
      readbackReceipt: {
        receiptId: createAflTradeContentAddress('artifact-readback', forgedReceiptContent),
        content: forgedReceiptContent,
      },
    });
    expect(forgedReadback.success).toBe(false);
    if (!forgedReadback.success) {
      expect(forgedReadback.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['readbackReceipt'],
            message: 'The read-back receipt must verify the exact source artifact.',
          }),
        ])
      );
    }
    const wrongEnvironmentReceiptContent = {
      ...snapshot.content.readbackReceipt.content,
      custodyEnvironment: 'non_production' as const,
    };
    const wrongEnvironmentReadback = aflTradeSourceSnapshotManifestContentSchema.safeParse({
      ...snapshot.content,
      readbackReceipt: {
        receiptId: createAflTradeContentAddress(
          'artifact-readback',
          wrongEnvironmentReceiptContent
        ),
        content: wrongEnvironmentReceiptContent,
      },
    });
    expect(wrongEnvironmentReadback.success).toBe(false);
    if (!wrongEnvironmentReadback.success) {
      expect(wrongEnvironmentReadback.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['readbackReceipt'],
            message:
              'Source snapshots require raw-source custody with assurance and an exact profile environment matching the Gate decision.',
          }),
        ])
      );
    }
    for (const [retrievedAt, expectedMessage] of [
      [
        '2026-12-31T00:00:00.000Z',
        'Source capture must occur while the approved source rights are current.',
      ],
      [
        '2026-12-01T00:00:00.000Z',
        'Source capture must occur while the Gate 0A decision is effective.',
      ],
    ] as const) {
      const result = aflTradeSourceSnapshotManifestContentSchema.safeParse({
        ...snapshot.content,
        retrievedAt,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: ['retrievedAt'], message: expectedMessage }),
          ])
        );
      }
    }
    for (const capture of [
      { ...snapshot.content.capture, sourceRegisterId: 'another-register' },
      { ...snapshot.content.capture, upstreamProvider: 'Another provider' },
      { ...snapshot.content.capture, upstreamDataset: 'Another dataset' },
      { ...snapshot.content.capture, upstreamDatasetVersion: 'another-version' },
    ]) {
      expect(
        aflTradeSourceSnapshotManifestContentSchema.safeParse({
          ...snapshot.content,
          capture,
        }).success
      ).toBe(false);
    }
    for (const capture of [
      { ...snapshot.content.capture, originalFilename: 'AFL Drafts Trades.xls' },
      { ...snapshot.content.capture, workbookFormat: 'xls' as const },
    ]) {
      expect(
        aflTradeSourceSnapshotManifestContentSchema.safeParse({
          ...snapshot.content,
          capture,
        }).success
      ).toBe(false);
    }
    const csvCustody = await custodyFixture(new TextEncoder().encode('games,goals'), 'text/csv');
    expect(
      aflTradeSourceSnapshotManifestContentSchema.safeParse({
        ...snapshot.content,
        sourceArtifact: csvCustody.artifact,
        readbackReceipt: csvCustody.readbackReceipt,
      }).success
    ).toBe(false);
    expect(() =>
      createAflTradeSourceSnapshotManifest({
        ...snapshot.content,
        capture: {
          ...snapshot.content.capture,
          originalFilename: '/tmp/private.xlsx',
        } as never,
      })
    ).toThrow();
  });

  it('binds non-production snapshots to the complete authorized custody profile', async () => {
    const governance = governanceFixture('provider_export', false, 'non_production');
    const sourceArtifact = createAflTradeByteArtifactRef(
      Uint8Array.from([80, 75, 3, 4]),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '2026-08-05T02:00:00.000Z'
    );
    const makeProfile = (maximumDays: number, deleteOnWithdrawal: boolean) =>
      createAflTradeArtifactCustodyProfile({
        schemaVersion: 'afl-trade-artifact-custody-profile/v1',
        subject: 'afl-trade-intelligence',
        contractRole: 'requirements_only_not_readiness_or_authorization',
        repositoryId: 'fixture-non-production-raw-source',
        environment: 'non_production',
        artifactClass: 'raw_source',
        maximumObjectBytes: 10_000,
        keyDerivation: 'profile_sha256_two_level_fanout_v1',
        conditionalCreate: 'if_none_match_star_required',
        encryption: {
          inTransit: 'tls_required',
          atRest: { mode: 'provider_managed', keyReferenceSha256: null },
        },
        retention: {
          deletion: {
            kind: 'maximum_age',
            maximumDays,
            enforcement: 'provider_lifecycle_required',
          },
          deleteOnWithdrawal,
          worm: null,
        },
        residency: {
          allowedJurisdictions: ['Australia'],
          crossJurisdictionTransfer: 'prohibited',
        },
        infrastructureEvidenceIds: [`storage-policy:${sha('e')}`],
      });
    const makeReadback = (maximumDays: number, deleteOnWithdrawal: boolean) => {
      const custodyProfile = makeProfile(maximumDays, deleteOnWithdrawal);
      const content = {
        schemaVersion: 'afl-trade-artifact-readback/v4' as const,
        artifact: sourceArtifact,
        repositoryAssurance: 'durable_object_storage' as const,
        artifactClass: 'raw_source' as const,
        custodyProfileId: custodyProfile.profileId,
        custodyProfile,
        custodyEnvironment: 'non_production' as const,
        verifiedAt: '2026-08-05T02:01:00.000Z',
        verification: 'exact_reference_and_sha256_bytes' as const,
        status: 'passed' as const,
      };
      return {
        receiptId: createAflTradeContentAddress('artifact-readback', content),
        content,
      };
    };
    const input = {
      schemaVersion: 'afl-trade-source-snapshot/v3' as const,
      sourceArtifact,
      readbackReceipt: makeReadback(30, true),
      capture: {
        kind: 'workbook' as const,
        sourceRegisterId: governance.rights.content.registerId,
        upstreamProvider: governance.rights.content.provider,
        upstreamDataset: governance.rights.content.dataset,
        upstreamDatasetVersion: governance.rights.content.datasetVersion,
        originalFilename: 'AFL Drafts Trades.xlsx',
        workbookFormat: 'xlsx' as const,
        worksheetNames: ['Trades'],
        importFormatVersion: 'fixture-v1',
        accessMechanism: 'provider_export' as const,
      },
      sourceRightsProposal: governance.rights,
      gate0aProposal: governance.proposal,
      gate0aDecision: governance.decision,
      gate0aReceipt: governance.receipt,
      fitzRoyCaptureReceipt: null,
      capturedFields: ['games', 'goals'],
      retrievedAt: '2026-08-05T02:00:00.000Z',
      effectiveAt: '2026-08-05T00:00:00.000Z',
      retention: { rawRetentionDays: 30, deleteOnWithdrawal: true },
      createdAt: '2026-08-05T02:02:00.000Z',
    };

    const validResult = aflTradeSourceSnapshotManifestContentSchema.safeParse(input);
    expect(
      validResult.success,
      validResult.success ? undefined : JSON.stringify(validResult.error.issues)
    ).toBe(true);
    for (const readbackReceipt of [makeReadback(31, true), makeReadback(30, false)]) {
      const result = aflTradeSourceSnapshotManifestContentSchema.safeParse({
        ...input,
        readbackReceipt,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ['readbackReceipt', 'content', 'custodyProfile'],
            }),
          ])
        );
      }
    }
  });

  it('keeps fitzRoy upstream and canonical arguments distinct from workbook metadata', async () => {
    const governance = governanceFixture('provider_api', true);
    const custody = await custodyFixture(
      Uint8Array.from([88, 10, 0, 0, 0, 3]),
      'application/x-r-rds',
      {
        createdAt: '2026-08-05T02:00:00.000Z',
        verifiedAt: '2026-08-05T02:02:00.000Z',
      },
      'raw_source'
    );
    const invocation = createAflTradeFitzRoyInvocation({
      schemaVersion: 'afl-trade-fitzroy-capture-request/v1',
      capabilityId: 'official-afl-player-stats',
      competition: 'AFLM',
      authorizationSeason: 2026,
      parameters: { season: 2026, roundNumber: null },
    });
    const invocationCustody = await custodyFixture(
      new TextEncoder().encode(canonicalizeAflTradeJson(invocation)),
      'application/json',
      {
        createdAt: '2026-08-05T01:30:00.000Z',
        verifiedAt: '2026-08-05T01:52:00.000Z',
      }
    );
    const diagnostics = {
      schemaVersion: 'afl-trade-fitzroy-diagnostics/v1' as const,
      capabilityId: invocation.capabilityId,
      fitzRoyVersion: '1.7.0' as const,
      directFunction: invocation.directFunction,
      invocationSha256: invocationCustody.artifact.contentSha256,
      runtime: {
        rVersion: '4.5.1' as const,
        platform: 'aarch64-unknown-linux-gnu',
        dependencyLockSha256: sha('c'),
        imageDigest: `sha256:${sha('d')}`,
      },
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
      observedDateRange: ['2026-03-19', '2026-03-20'] as [string, string],
      originObservation: 'not_exposed_by_fitzroy' as const,
      conditions: [],
    };
    const diagnosticsCustody = await custodyFixture(
      new TextEncoder().encode(canonicalizeAflTradeJson(diagnostics)),
      'application/json'
    );
    const captureReceipt = createAflTradeFitzRoyCaptureReceipt({
      schemaVersion: 'afl-trade-fitzroy-capture/v2',
      invocation,
      authorizationReceipt: governance.receipt,
      invocationCustody: {
        artifact: invocationCustody.artifact,
        readback: invocationCustody.readbackReceipt,
      },
      sourceCustody: { artifact: custody.artifact, readback: custody.readbackReceipt },
      diagnosticsCustody: {
        artifact: diagnosticsCustody.artifact,
        readback: diagnosticsCustody.readbackReceipt,
      },
      egressExecutionCustody: null,
      egressExecutionReceipt: null,
      diagnostics,
      schemaFingerprint: createAflTradeFitzRoySchemaFingerprint(diagnostics),
      capturedAt: '2026-08-05T02:02:00.000Z',
      status: 'captured',
    });
    const snapshot = createAflTradeSourceSnapshotManifest({
      schemaVersion: 'afl-trade-source-snapshot/v3',
      sourceArtifact: custody.artifact,
      readbackReceipt: custody.readbackReceipt,
      capture: {
        kind: 'fitzroy',
        sourceRegisterId: governance.rights.content.registerId,
        upstreamProvider: governance.rights.content.provider,
        upstreamDataset: governance.rights.content.dataset,
        upstreamDatasetVersion: governance.rights.content.datasetVersion,
        capabilityId: 'official-afl-player-stats',
        packageVersion: '1.7.0',
        functionName: 'fetch_player_stats_afl',
        argumentsArtifact: invocationCustody.artifact,
        accessMechanism: 'provider_api',
        rateLimitContext: 'Ten fabricated requests per minute.',
        cacheContext: 'Cache fabricated responses for at most 300 seconds.',
      },
      sourceRightsProposal: governance.rights,
      gate0aProposal: governance.proposal,
      gate0aDecision: governance.decision,
      gate0aReceipt: governance.receipt,
      fitzRoyCaptureReceipt: captureReceipt,
      capturedFields: ['games', 'goals'],
      retrievedAt: '2026-08-05T02:02:00.000Z',
      effectiveAt: '2026-08-05T00:00:00.000Z',
      retention: { rawRetentionDays: 30, deleteOnWithdrawal: true },
      createdAt: '2026-08-05T02:02:00.000Z',
    });
    expect(snapshot.content.capture.kind).toBe('fitzroy');
    expect(snapshot.content.sourceArtifact.createdAt).not.toBe(snapshot.content.retrievedAt);
    if (snapshot.content.capture.kind !== 'fitzroy') {
      throw new Error('Expected a fitzRoy capture fixture.');
    }
    const fitzRoyCapture = snapshot.content.capture;
    for (const capture of [
      { ...fitzRoyCapture, sourceRegisterId: 'another-register' },
      { ...fitzRoyCapture, upstreamProvider: 'Another provider' },
      { ...fitzRoyCapture, upstreamDataset: 'Another dataset' },
      { ...fitzRoyCapture, upstreamDatasetVersion: 'another-version' },
      { ...fitzRoyCapture, capabilityId: 'afl-tables-player-stats' },
      { ...fitzRoyCapture, packageVersion: '1.6.0' },
      { ...fitzRoyCapture, functionName: 'fetch_player_stats' },
    ]) {
      expect(
        aflTradeSourceSnapshotManifestContentSchema.safeParse({
          ...snapshot.content,
          capture,
        }).success
      ).toBe(false);
    }
    expect(
      aflTradeSourceSnapshotManifestContentSchema.safeParse({
        ...snapshot.content,
        capture: {
          ...fitzRoyCapture,
          argumentsArtifact: {
            ...fitzRoyCapture.argumentsArtifact,
            createdAt: '2026-08-05T01:55:00.000Z',
          },
        },
      }).success
    ).toBe(false);
    expect(() =>
      createAflTradeSourceSnapshotManifest({
        ...snapshot.content,
        capture: {
          ...snapshot.content.capture,
          originalFilename: 'forbidden.xlsx',
        } as never,
      })
    ).toThrow();
  });
});
