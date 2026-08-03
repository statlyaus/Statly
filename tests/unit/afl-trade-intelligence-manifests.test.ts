import { describe, expect, it } from 'vitest';

import {
  aflTradeCorpusManifestSchema,
  aflTradeDatasetManifestSchema,
  aflTradeEvidenceItemSchema,
  aflTradeEvidenceManifestSchema,
} from '@/server/aflTradeIntelligence/artifacts/manifestContracts';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';

const digest = (character: string) => character.repeat(64);

function artifact(character: string, createdAt = '2026-08-01T00:00:00.000Z') {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 1024,
    createdAt,
  };
}

function evidenceItemContent() {
  return {
    schemaVersion: 'afl-trade-evidence-item/v1' as const,
    authorizationId: 'fixture-authorization',
    sourceRegisterId: 'fixture-source-v1',
    artifact: artifact('1'),
    capturedFields: ['player_name'],
    adapterVersion: 'fixture-adapter-v1',
    sourcePublishedAt: '2026-07-30T00:00:00.000Z',
    retrievedAt: '2026-08-01T00:00:00.000Z',
    effectiveFrom: '2021-01-01T00:00:00.000Z',
    effectiveTo: '2026-01-01T00:00:00.000Z',
    knownFrom: '2026-08-01T00:00:00.000Z',
    knownTo: null,
    recordCount: 1000,
  };
}

function evidenceItem(content = evidenceItemContent()) {
  return aflTradeEvidenceItemSchema.parse({
    evidenceItemId: createAflTradeContentAddress('evidence-item', content),
    content,
  });
}

function evidenceContent() {
  return {
    schemaVersion: 'afl-trade-evidence/v1' as const,
    environment: 'test_fixture' as const,
    createdAt: '2026-08-01T00:01:00.000Z',
    sourceAuthorizations: [
      {
        authorizationId: 'fixture-authorization',
        sourceRegisterId: 'fixture-source-v1',
        rightsArtifactId: `source-rights:${digest('2')}`,
        gate0aDecisionId: `gate-decision:${digest('3')}`,
        gate0aReceiptId: `gate0a-evaluation:${digest('4')}`,
      },
    ],
    items: [evidenceItem()],
    captureConfigurationArtifact: artifact('5'),
    adapterCodeArtifacts: [artifact('6')],
    sourceSchemaArtifacts: [artifact('7')],
  };
}

function evidence(content = evidenceContent()) {
  return aflTradeEvidenceManifestSchema.parse({
    manifestId: createAflTradeContentAddress('evidence', content),
    content,
  });
}

function corpusContent(parentEvidence = evidence()) {
  return {
    schemaVersion: 'afl-trade-corpus/v1' as const,
    environment: 'test_fixture' as const,
    createdAt: '2026-08-03T00:00:00.000Z',
    evidenceManifestId: parentEvidence.manifestId,
    dataSufficiencyProtocolId: `data-sufficiency-protocol:${digest('8')}`,
    coverageReportId: `coverage-report:${digest('9')}`,
    gate0bDecisionId: `gate-decision:${digest('a')}`,
    architectureCurrentStateId: `architecture-current-state:${digest('2')}`,
    architectureDecisionPackageId: `architecture-decision-package:${digest('3')}`,
    gate1DecisionId: `gate-decision:${digest('4')}`,
    sourceRegisterIds: ['fixture-source-v1'],
    knowledgeCutoffAt: '2026-08-02T00:00:00.000Z',
    effectiveFrom: '2021-01-01T00:00:00.000Z',
    effectiveTo: '2026-01-01T00:00:00.000Z',
    recordCounts: {
      trades: 10,
      parties: 20,
      assets: 30,
      custodySpells: 30,
      lineageTransformations: 12,
      quarantinedRecords: 1,
      unresolvedValueBearingAssets: 1,
    },
    identityResolutionArtifact: artifact('b'),
    custodyArtifact: artifact('c'),
    lineageArtifact: artifact('d'),
    reconciliationArtifact: artifact('e'),
    qualityReportArtifact: artifact('f'),
    quarantineArtifact: artifact('1'),
    unsupportedCohorts: ['unresolved-fixture-assets'],
  };
}

function corpus(content = corpusContent()) {
  return aflTradeCorpusManifestSchema.parse({
    corpusId: createAflTradeContentAddress('corpus', content),
    content,
  });
}

function datasetContent(parentCorpus = corpus()) {
  return {
    schemaVersion: 'afl-trade-dataset/v1' as const,
    environment: 'test_fixture' as const,
    createdAt: '2026-08-04T00:00:00.000Z',
    corpusId: parentCorpus.corpusId,
    gate2DecisionId: `gate-decision:${digest('2')}`,
    sourceRegisterIds: ['fixture-source-v1'],
    knowledgeCutoffAt: '2026-08-03T00:00:00.000Z',
    effectiveFrom: '2021-01-01T00:00:00.000Z',
    effectiveTo: '2026-01-01T00:00:00.000Z',
    rowCount: 1000,
    includedCohorts: ['resolved-fixture-assets'],
    excludedCohorts: ['unresolved-fixture-assets'],
    featureDefinitionArtifacts: [artifact('3')],
    featureSchemaArtifact: artifact('4'),
    targetDefinitionArtifact: artifact('5'),
    splitAssignmentArtifact: artifact('6'),
    datasetArtifact: artifact('7'),
  };
}

function dataset(content = datasetContent()) {
  return aflTradeDatasetManifestSchema.parse({
    datasetId: createAflTradeContentAddress('dataset', content),
    content,
  });
}

describe('AFL trade-intelligence evidence, corpus, and dataset manifests', () => {
  it('accepts the ordered raw-evidence, corpus, and feature-dataset boundaries', () => {
    const rawEvidence = evidence();
    const canonicalCorpus = corpus(corpusContent(rawEvidence));
    const featureDataset = dataset(datasetContent(canonicalCorpus));

    expect(canonicalCorpus.content.evidenceManifestId).toBe(rawEvidence.manifestId);
    expect(featureDataset.content.corpusId).toBe(canonicalCorpus.corpusId);
  });

  it('rejects evidence-item content altered after hashing', () => {
    const item = evidenceItem();
    expect(
      aflTradeEvidenceItemSchema.safeParse({
        ...item,
        content: { ...item.content, recordCount: 1001 },
      }).success
    ).toBe(false);
  });

  it('keeps identity and lineage artifacts out of the raw-evidence manifest', () => {
    const content = evidenceContent();
    const invalidContent = { ...content, lineageArtifact: artifact('8') };

    expect(
      aflTradeEvidenceManifestSchema.safeParse({
        manifestId: createAflTradeContentAddress('evidence', invalidContent),
        content: invalidContent,
      }).success
    ).toBe(false);
  });

  it('requires each evidence item to match one exact source authorization', () => {
    const content = evidenceContent();
    content.items = [
      evidenceItem({ ...evidenceItemContent(), authorizationId: 'missing-authorization' }),
    ];

    expect(
      aflTradeEvidenceManifestSchema.safeParse({
        manifestId: createAflTradeContentAddress('evidence', content),
        content,
      }).success
    ).toBe(false);
  });

  it('rejects evidence claimed as known before retrieval', () => {
    const content = evidenceItemContent();
    content.knownFrom = '2026-07-31T00:00:00.000Z';

    expect(
      aflTradeEvidenceItemSchema.safeParse({
        evidenceItemId: createAflTradeContentAddress('evidence-item', content),
        content,
      }).success
    ).toBe(false);
  });

  it('requires the corpus reconciliation and quarantine boundary', () => {
    const content = corpusContent();
    const { quarantineArtifact: _omitted, ...incomplete } = content;

    expect(
      aflTradeCorpusManifestSchema.safeParse({
        corpusId: createAflTradeContentAddress('corpus', incomplete),
        content: incomplete,
      }).success
    ).toBe(false);
  });

  it('rejects a cohort included and excluded by the same dataset', () => {
    const content = datasetContent();
    content.excludedCohorts = [...content.excludedCohorts, content.includedCohorts[0]];

    expect(
      aflTradeDatasetManifestSchema.safeParse({
        datasetId: createAflTradeContentAddress('dataset', content),
        content,
      }).success
    ).toBe(false);
  });

  it('rejects corpus and dataset content altered after hashing', () => {
    const canonicalCorpus = corpus();
    const featureDataset = dataset();

    expect(
      aflTradeCorpusManifestSchema.safeParse({
        ...canonicalCorpus,
        content: { ...canonicalCorpus.content, createdAt: '2026-08-04T00:00:00.000Z' },
      }).success
    ).toBe(false);
    expect(
      aflTradeDatasetManifestSchema.safeParse({
        ...featureDataset,
        content: { ...featureDataset.content, rowCount: 999 },
      }).success
    ).toBe(false);
  });
});
