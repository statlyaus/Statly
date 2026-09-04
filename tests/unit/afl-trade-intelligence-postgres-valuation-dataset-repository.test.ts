import { describe, expect, it, vi } from 'vitest';

const provenance = vi.hoisted(() => ({
  hasCurrent: vi.fn(async () => true),
}));

vi.mock('@/server/aflTradeIntelligence/artifacts/valuationDatasetAdmissionContracts', () => ({
  aflTradeConsumedFieldSetSchema: { parse: (value: unknown) => value },
  aflTradeDatasetOperationAuthorizationSchema: { parse: (value: unknown) => value },
  aflTradeValuationDatasetAdmissionReceiptSchema: { parse: (value: unknown) => value },
  aflTradeValuationDatasetCandidateSchema: { parse: (value: unknown) => value },
  listAflTradeValuationDatasetArtifactMemberships: (value: ReturnType<typeof candidate>) => {
    const content = value.content;
    return [
      { role: 'dataset', ordinal: 1, reference: content.datasetArtifact },
      { role: 'exclusion_report', ordinal: 1, reference: content.exclusionReport },
      { role: 'extractor_code', ordinal: 1, reference: content.extractor.codeArtifact },
      {
        role: 'extractor_configuration',
        ordinal: 1,
        reference: content.extractor.configurationArtifact,
      },
      ...content.specification.content.featureDefinitions.map((reference, index) => ({
        role: 'feature_definition',
        ordinal: index + 1,
        reference,
      })),
      ...[
        ['target_definition', content.specification.content.targetDefinition],
        ['value_unit_definition', content.specification.content.valueUnitDefinition],
        ['role_taxonomy', content.specification.content.roleTaxonomy],
        ['era_definition', content.specification.content.eraDefinition],
        ['censoring_definition', content.specification.content.censoringDefinition],
        ['inclusion_policy', content.specification.content.inclusionPolicy],
      ].map(([role, reference]) => ({ role, ordinal: 1, reference })),
    ];
  },
}));

vi.mock('@/server/aflTradeIntelligence/source/gate0aReceipt', () => ({
  aflTradeGate0AReceiptSchema: { parse: (value: unknown) => value },
}));

vi.mock(
  '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetFactualLineageRepository',
  () => ({
    hasCurrentAflTradeValuationDatasetDomainProvenance: provenance.hasCurrent,
  })
);

import { PostgresAflTradeValuationDatasetRepository } from '@/server/aflTradeIntelligence/modeling/postgresValuationDatasetRepository';

const digest = (character: string) => character.repeat(64);
const id = (prefix: string, character: string) => `${prefix}:${digest(character)}`;
const instant = '2026-08-09T00:00:00.000Z';

function artifact(character: string) {
  return {
    artifactId: id('artifact', character),
    contentSha256: digest(character),
    mediaType: 'application/json',
    byteLength: 2,
    createdAt: instant,
  };
}

function candidate() {
  const row = {
    rowId: id('valuation-dataset-row', '2'),
    content: {
      schemaVersion: 'afl-trade-valuation-dataset-row/v3',
      ordinal: 1,
      rowKey: '2025|player-1',
      splitRole: 'fit_train',
      seasonYear: 2025,
      identity: { playerId: 'player-1', clubId: 'club-1' },
      lineage: {
        eventId: 'event-1',
        eventVersionId: 'event-version-1',
        acquisitionSpellId: 'spell-1',
        acquisitionSpellVersionId: id('spell-version', '3'),
      },
    },
  };
  return {
    datasetId: id('dataset', '1'),
    content: {
      schemaVersion: 'afl-trade-valuation-dataset/v4',
      authorityBoundary:
        'private_factual_feature_dataset_no_model_fit_grade_publication_or_fantasy_ownership',
      publicationEligible: false,
      environment: 'test_fixture',
      scopeKey: 'public-afl-draft-trade-outcomes',
      competition: 'AFLM',
      createdAt: instant,
      knowledgeCutoffAt: instant,
      factualParent: {
        factualReleaseId: id('outcome-release', '4'),
        factualCandidateId: id('factual-release-candidate', '5'),
        corpusId: id('corpus', '6'),
        corpusToCandidateLineageId: id('corpus-factual-lineage', '7'),
        sourceMemberSetSha256: digest('8'),
      },
      rows: [row],
      rowCount: 1,
      rowSetSha256: digest('9'),
      datasetArtifact: artifact('a'),
      exclusionReport: artifact('b'),
      extractor: { codeArtifact: artifact('c'), configurationArtifact: artifact('d') },
      specification: {
        content: {
          featureDefinitions: [artifact('e')],
          targetDefinition: artifact('f'),
          valueUnitDefinition: artifact('0'),
          roleTaxonomy: artifact('1'),
          eraDefinition: artifact('2'),
          censoringDefinition: artifact('3'),
          inclusionPolicy: artifact('4'),
        },
      },
    },
  };
}

function authority(kind: 'analytical_authority' | 'operational_authorization', character: string) {
  return {
    receiptId: id('architecture-operation-receipt', character),
    content: {
      schemaVersion: 'afl-trade-architecture-operation-authorization/v1',
      operation: 'materialize_feature_dataset',
      authorityKind: kind,
      environment: 'test_fixture',
      scopeKey: 'public-afl-draft-trade-outcomes',
      datasetId: id('dataset', '1'),
      factualReleaseId: id('outcome-release', '4'),
      factualCandidateId: id('factual-release-candidate', '5'),
      authorizedAt: instant,
      validThrough: '2026-08-10T00:00:00.000Z',
      principalRef: `${kind}-fixture`,
    },
  };
}

function admission() {
  return {
    admissionId: id('dataset-admission', 'b'),
    content: {
      schemaVersion: 'afl-trade-dataset-admission/v3',
      authorityBoundary:
        'dataset_admission_only_no_model_fit_grade_publication_or_fantasy_ownership',
      publicationEligible: false,
      environment: 'test_fixture',
      admittedAt: '2026-08-09T01:00:00.000Z',
      datasetId: id('dataset', '1'),
      gate2Decision: { decisionId: id('gate-decision', 'c') },
      sourceRightsEvaluations: [
        {
          captureId: 'capture-1',
          sourceSnapshotId: id('source-snapshot', 'd'),
          consumedFieldSetId: id('consumed-field-set', 'e'),
          proposalId: id('source-rights', 'f'),
          derivationDecisionId: id('gate-decision', '1'),
          derivationEvaluationReceiptId: id('gate0a-evaluation', '2'),
          admissionDecisionId: id('gate-decision', '3'),
          admissionEvaluationReceiptId: id('gate0a-evaluation', '4'),
        },
      ],
      analyticalAuthorityReceiptId: id('architecture-operation-receipt', '5'),
      operationalAuthorizationReceiptId: id('architecture-operation-receipt', '6'),
    },
  };
}

function persistenceEvidence() {
  const fieldSet = {
    fieldSetId: id('consumed-field-set', 'e'),
    content: {
      captureId: 'capture-1',
      sourceSnapshotId: id('source-snapshot', 'd'),
      createdAt: instant,
      fieldSetSha256: digest('7'),
      fields: [{ sourceField: 'games', uses: ['derived_feature', 'model_training'] }],
    },
  };
  const receipt = (receiptCharacter: string, decisionCharacter: string, evaluatedAt: string) => ({
    receiptId: id('gate0a-evaluation', receiptCharacter),
    content: {
      schemaVersion: 'afl-trade-gate0a-evaluation/v2',
      request: {
        rightsArtifactId: id('source-rights', 'f'),
        environment: 'test_fixture',
        evaluatedAt,
        operations: ['derived_feature_creation', 'model_training'],
      },
      result: {
        decisionId: id('gate-decision', decisionCharacter),
        status: 'mechanically_eligible',
      },
      recordedAt: evaluatedAt,
    },
  });
  return {
    gateLedgerRevision: 9,
    analyticalAuthority: authority('analytical_authority', '5'),
    operationalAuthorization: authority('operational_authorization', '6'),
    consumedFieldSets: [fieldSet],
    sourceRights: [
      {
        captureId: 'capture-1',
        sourceSnapshotId: id('source-snapshot', 'd'),
        consumedFieldSetId: fieldSet.fieldSetId,
        rightsArtifactId: id('source-rights', 'f'),
        derivationReceipt: receipt('2', '1', instant),
        admissionReceipt: receipt('4', '3', '2026-08-09T01:00:00.000Z'),
      },
    ],
  };
}

function sqlClient() {
  const statements: string[] = [];
  const transaction = {
    async query<Row>(sql: string) {
      statements.push(sql);
      return { rows: [] as Row[], rowCount: sql.includes('UPDATE') ? 1 : 1 };
    },
  };
  return {
    statements,
    client: {
      query: transaction.query,
      async transaction<T>(work: (value: typeof transaction) => Promise<T>) {
        return work(transaction);
      },
    },
  };
}

describe('PostgresAflTradeValuationDatasetRepository', () => {
  it('atomically stages exact rows and artifact roles before finalizing the candidate', async () => {
    const sql = sqlClient();
    const repository = new PostgresAflTradeValuationDatasetRepository(sql.client);

    const result = await repository.persistCandidate(candidate() as never);

    expect(result).toEqual({ datasetId: id('dataset', '1'), idempotentReplay: false });
    expect(sql.statements.join('\n')).toContain('INSERT INTO outcome_valuation_dataset_candidate');
    expect(sql.statements.join('\n')).toContain('INSERT INTO outcome_valuation_dataset_row');
    expect(sql.statements.join('\n')).toContain(
      'INSERT INTO outcome_valuation_dataset_artifact_member'
    );
    expect(sql.statements.at(-1)).toContain("SET status='finalized'");
  });

  it('persists typed source and operation evidence before finalizing admission', async () => {
    const sql = sqlClient();
    const repository = new PostgresAflTradeValuationDatasetRepository(sql.client);

    const result = await repository.persistAdmission({
      dataset: candidate() as never,
      receipt: admission() as never,
      evidence: persistenceEvidence() as never,
    });

    expect(result).toEqual({ admissionId: id('dataset-admission', 'b'), idempotentReplay: false });
    const statements = sql.statements.join('\n');
    expect(statements).toContain('INSERT INTO outcome_valuation_dataset_consumed_field_set');
    expect(statements).toContain('INSERT INTO outcome_valuation_dataset_gate0_evaluation');
    expect(statements).toContain('INSERT INTO outcome_valuation_dataset_operation_authority');
    expect(statements).toContain('INSERT INTO outcome_valuation_dataset_admission_source');
    expect(sql.statements.at(-1)).toContain("SET status='finalized'");
  });

  it('rejects admission when canonical-promotion provenance is no longer current', async () => {
    provenance.hasCurrent.mockResolvedValueOnce(false);
    const repository = new PostgresAflTradeValuationDatasetRepository(sqlClient().client);

    await expect(
      repository.persistAdmission({
        dataset: candidate() as never,
        receipt: admission() as never,
        evidence: persistenceEvidence() as never,
      })
    ).rejects.toThrow('Dataset admission requires current canonical-promotion provenance.');
  });
});
