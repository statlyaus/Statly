import { describe, expect, it } from 'vitest';

import {
  aflTradeArtifactRefSchema,
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
  doesAflTradeArtifactRefMatchBytes,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
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
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';

const sha = (character: string) => character.repeat(64);
const evidenceId = `artifact:${sha('a')}`;

function governanceFixture(accessMechanism: 'provider_export' | 'provider_api') {
  const automated = accessMechanism === 'provider_api';
  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v1' as const,
    registerId: `fixture-${accessMechanism}`,
    provider: 'Fabricated provider',
    dataset: 'Fabricated AFL outcomes',
    datasetVersion: 'fixture-v1',
    intendedPurpose: 'Exercise immutable source custody with fabricated bytes.',
    scope: {
      competitions: ['AFL'],
      seasonRanges: [{ from: 2026, to: 2026 }],
      accessMechanism,
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
      { name: 'competition', values: ['AFL'] },
      { name: 'season', values: ['2026'] },
      { name: 'access_mechanism', values: [accessMechanism] },
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
    environment: 'test_fixture' as const,
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
    environment: 'test_fixture' as const,
    scope,
    state: 'approved' as const,
    authorityKind: 'fixture' as const,
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
      environment: 'test_fixture',
      rightsArtifactId: rights.rightsArtifactId,
      evaluatedAt: '2026-08-05T01:50:00.000Z',
      competition: 'AFL',
      season: 2026,
      accessMechanism,
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

async function custodyFixture(bytes: Uint8Array, mediaType: string) {
  const artifact = createAflTradeByteArtifactRef(bytes, mediaType, '2026-08-05T02:00:00.000Z');
  const repository = createAflTradeFixtureArtifactRepository();
  const stored = await repository.putIfAbsent(artifact, bytes);
  const readbackReceipt = await verifyAflTradeArtifactReadback(
    repository,
    stored.reference,
    '2026-08-05T02:01:00.000Z',
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
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const snapshot = createAflTradeSourceSnapshotManifest({
      schemaVersion: 'afl-trade-source-snapshot/v1',
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

  it('keeps fitzRoy upstream and canonical arguments distinct from workbook metadata', async () => {
    const governance = governanceFixture('provider_api');
    const custody = await custodyFixture(
      new TextEncoder().encode('{"fixture":true}'),
      'application/json'
    );
    const argumentsArtifact = createAflTradeCanonicalJsonArtifactRef(
      { season: 2026, comp: 'AFL' },
      '2026-08-05T01:30:00.000Z'
    );
    const snapshot = createAflTradeSourceSnapshotManifest({
      schemaVersion: 'afl-trade-source-snapshot/v1',
      sourceArtifact: custody.artifact,
      readbackReceipt: custody.readbackReceipt,
      capture: {
        kind: 'fitzroy',
        sourceRegisterId: governance.rights.content.registerId,
        upstreamProvider: governance.rights.content.provider,
        upstreamDataset: governance.rights.content.dataset,
        upstreamDatasetVersion: governance.rights.content.datasetVersion,
        packageVersion: '2.0.0',
        functionName: 'fetch_player_stats',
        argumentsArtifact,
        accessMechanism: 'provider_api',
        rateLimitContext: 'Ten fabricated requests per minute.',
        cacheContext: 'Cache fabricated responses for at most 300 seconds.',
      },
      sourceRightsProposal: governance.rights,
      gate0aProposal: governance.proposal,
      gate0aDecision: governance.decision,
      gate0aReceipt: governance.receipt,
      capturedFields: ['games', 'goals'],
      retrievedAt: '2026-08-05T02:00:00.000Z',
      effectiveAt: '2026-08-05T00:00:00.000Z',
      retention: { rawRetentionDays: 30, deleteOnWithdrawal: true },
      createdAt: '2026-08-05T02:02:00.000Z',
    });
    expect(snapshot.content.capture.kind).toBe('fitzroy');
    if (snapshot.content.capture.kind !== 'fitzroy') {
      throw new Error('Expected a fitzRoy capture fixture.');
    }
    const fitzRoyCapture = snapshot.content.capture;
    for (const capture of [
      { ...fitzRoyCapture, sourceRegisterId: 'another-register' },
      { ...fitzRoyCapture, upstreamProvider: 'Another provider' },
      { ...fitzRoyCapture, upstreamDataset: 'Another dataset' },
      { ...fitzRoyCapture, upstreamDatasetVersion: 'another-version' },
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
